/**
 * A group's history is an append-only log of events. Every device holds the
 * whole log and rebuilds the same state from it, in the same order, whatever
 * order the events arrived in. The relay only ever sees these events
 * encrypted; signing and encryption happen in the transport layer, which
 * hands this module events whose author it has already verified.
 *
 * Nothing is ever edited in place: an edit is a new version of an expense, a
 * deletion is a tombstone, and a settlement can only be voided. That gives
 * every group a complete audit trail.
 *
 * Shared groups are "signed": each member writes from a phone holding a
 * signing key, the member's public key is recorded in the log, and every
 * event must come with the `signer` key its signature was verified against.
 * Groups that have never been shared may be unsigned; nothing else changes.
 */

import { computeBalances, type Balances, type BitcoinProof, type Settlement } from './balances.ts'
import { minorDigits } from './money.ts'
import { computeShares, validateExpense, type Expense, type PersonId } from './splits.ts'
import { isCurrencyCode, shapeProblem } from './shape.ts'

function isKnownCurrency(code: string): boolean {
  if (!isCurrencyCode(code)) return false
  try {
    minorDigits(code)
    return true
  } catch {
    return false
  }
}

export interface Member {
  id: PersonId
  name: string
  /**
   * Public signing key of the phone this member writes from, once they have
   * joined on one. Members added by someone else have none until they claim
   * their place.
   */
  key?: string
  /** Where this member receives bitcoin, e.g. "bob@walletofsatoshi.com". The first of `lightningAddresses`. */
  lightningAddress?: string
  /**
   * Every address they receive at, in the order to try them: if the first
   * can't take a payment, payers try the next.
   */
  lightningAddresses?: string[]
  /**
   * Everywhere they receive, in order: Lightning addresses and BOLT12
   * offers mixed. Set by newer phones; older ones only know
   * `lightningAddresses`. See `receiveTargets`.
   */
  receive?: string[]
  /**
   * True once they've left the group. They stay in the log, so past
   * expenses still show their name, but can't write or be added to anything.
   */
  left?: boolean
  /**
   * Public key their phone receives new group keys with (ECDH P-256): when
   * someone is removed, the group's next key is locked to each remaining
   * phone's box key.
   */
  boxKey?: string
  /** Who removed their phone from the group, if someone did. Cleared when a phone joins as them again. */
  removedBy?: PersonId
  /** Who vouched for their current phone after they lost the last one, if someone did. */
  recoveredBy?: PersonId
}

const MAX_ADDRESSES = 5
const MAX_CLOCK_JUMP = 1_000_000

/** Where to pay someone, in order. Members from before lists existed have one address at most. */
export function receiveAddresses(member: Member | undefined): string[] {
  if (!member) return []
  return member.lightningAddresses ?? (member.lightningAddress ? [member.lightningAddress] : [])
}

/**
 * Where to pay this member, in order: Lightning addresses and BOLT12 offers.
 * Falls back to the addresses alone, from phones that predate offers.
 */
export function receiveTargets(member: Member | undefined): string[] {
  if (!member) return []
  return member.receive ?? receiveAddresses(member)
}

/**
 * A BOLT12 offer: "lno1" and bech32 characters, no checksum. Offers can be
 * split with "+" and whitespace for display; `cleanOffer` joins them.
 */
export function isOffer(text: string): boolean {
  return /^lno1[02-9ac-hj-np-z]{20,2000}$/.test(text)
}

export function cleanOffer(text: string): string {
  return text.trim().toLowerCase().replace(/^(bitcoin:\?lno=|lightning:)/, '').replace(/\+\s*/g, '')
}

/** A Lightning address looks like an email address: name@domain.tld. */
export function isLightningAddress(text: string): boolean {
  return /^[a-z0-9._+-]{1,64}@(?=.{4,253}$)([a-z0-9-]{1,63}\.)+[a-z]{2,63}$/i.test(text)
}

interface EventBase {
  /** Globally unique, e.g. a random UUID. */
  id: string
  /** Member who wrote the event. Verified by the transport's signature check. */
  author: PersonId
  /**
   * Lamport clock: one more than the highest clock the author had seen.
   * Gives a total order that respects causality.
   */
  clock: number
  /** Author's wall-clock time, ISO. For display only, never for ordering. */
  at: string
  /**
   * Public key whose signature over this event the transport verified. Set by
   * the transport, never trusted from the event's own content.
   */
  signer?: string
}

export type LedgerEvent = EventBase &
  (
    /**
     * Adds a person. In a signed group, a phone joining as someone new adds
     * itself: author and member are the same, with the phone's key.
     */
    | { type: 'member.added'; member: Member }
    | { type: 'member.renamed'; memberId: PersonId; name: string }
    /**
     * A member updates their own details. Only they can: how someone gets
     * paid is never set by anyone else. An empty address removes it.
     */
    | {
        type: 'member.updated'
        memberId: PersonId
        lightningAddress?: string
        lightningAddresses?: string[]
        /** The full ordered list, offers included. Sent alongside `lightningAddresses` (addresses only) for older phones. */
        receive?: string[]
        boxKey?: string
      }
    /**
     * Removes someone's phone from the group: it can't write any more. Their
     * expenses and balance stay, and they can join again as themselves with
     * a new invite. Followed by `group.rekeyed`, so the phone can't read what
     * comes next either.
     */
    | { type: 'member.removed'; memberId: PersonId }
    /**
     * Someone lost their phone: another member vouches for their new one.
     * The new phone's key replaces the old one, so the lost phone can't write.
     */
    | { type: 'member.recovered'; memberId: PersonId; key: string }
    /**
     * The group moves to a new key (and so a new relay room). `from` is the
     * room it moves from; `wrapped` holds the new key locked to each
     * remaining member's box key, using the one-off `ephemeral` key.
     */
    | { type: 'group.rekeyed'; from: string; ephemeral: string; wrapped: Record<PersonId, string> }
    /** A phone takes the place of a member who hasn't joined on a phone yet. */
    | { type: 'member.claimed'; memberId: PersonId; key: string }
    /**
     * A member moves to a new phone: their current key hands over to the new
     * phone's key. Signed with the old key, so only the old phone can do it.
     * From here on, only the new key can write for them.
     */
    | { type: 'member.rekeyed'; memberId: PersonId; key: string }
    /** A member leaves. Only they can, and only when they owe and are owed nothing. */
    | { type: 'member.left'; memberId: PersonId }
    /**
     * Sets the group's name and/or main currency. `kind: 'friends'` marks a
     * friendship: a group of two, shown under Friends rather than Groups.
     */
    | { type: 'group.updated'; name?: string; currency?: string; kind?: 'friends' }
    /**
     * Creates or edits an expense. `basedOn` is the id of the event holding
     * the version this edit started from (absent for a new expense). If the
     * expense has moved on since, two people edited it concurrently.
     */
    | { type: 'expense.saved'; expense: Expense; basedOn?: string }
    | { type: 'expense.deleted'; expenseId: string; basedOn: string }
    | { type: 'settlement.recorded'; settlement: Settlement }
    | { type: 'settlement.voided'; settlementId: string; reason?: string }
    /**
     * Friendships only. Which members of other groups the author is, in a
     * form only someone in the same group can recognise: for each group, a
     * keyed hash of the friendship and their member id under that group's
     * key (`t`), signed with their key in that group (`s`). Replaces the
     * author's previous list.
     */
    | { type: 'friend.linked'; tokens: FriendToken[] }
    /**
     * Money sent that doesn't count towards anyone's balance: a gift, or
     * paying for something outside the app. Only the sender records it.
     */
    | { type: 'money.sent'; sent: Sent }
    /** Asking someone for money. Only the person asking can. */
    | { type: 'payment.requested'; request: PaymentRequest }
    /**
     * A request is done with: paid or declined (by whoever was asked), or
     * cancelled (by whoever asked).
     */
    | { type: 'request.closed'; requestId: string; outcome: 'paid' | 'declined' | 'cancelled' }
    /**
     * Friendships only. An invite to another group, sent privately: the
     * invite link's secret, and the group's id (`group`, not `groupId`, which
     * phones use for their own bookkeeping) and name.
     */
    | { type: 'friend.invited'; secret: string; group: string; name: string; expiresAt: number }
  )

/** Money sent outside any debt. Balances ignore it. */
export interface Sent {
  id: string
  from: PersonId
  to: PersonId
  amount: number
  currency: string
  note?: string
  bitcoin?: BitcoinProof
}

export interface PaymentRequest {
  id: string
  /** Who's asking (and gets paid). */
  from: PersonId
  /** Who's asked to pay. */
  to: PersonId
  amount: number
  currency: string
  note?: string
  /** Paying it settles what `to` owes `from`, rather than being money outside the balance. */
  settles?: boolean
}

export interface OpenRequest extends PaymentRequest {
  /** Undefined while open. */
  outcome?: 'paid' | 'declined' | 'cancelled'
}

export interface FriendToken {
  t: string
  s: string
}

export interface FriendInvite {
  eventId: string
  from: PersonId
  secret: string
  groupId: string
  name: string
  expiresAt: number
}

/** Two people changed the same expense without seeing each other's change. */
export interface Conflict {
  expenseId: string
  /** Event whose version is now current. */
  kept: string
  /** Event whose version was overwritten (or that tried to revive a deleted expense). */
  overwritten: string
}

/** An event that was well-formed but not allowed, with the reason. */
export interface Rejection {
  eventId: string
  reason: string
}

export interface GroupState {
  /** From the latest `group.updated`, if any. */
  name?: string
  /** 'friends' for a friendship: two people, no more. */
  kind?: 'friends'
  /** Money sent outside any debt, by id. */
  sent: Map<string, Sent>
  /** Requests for money, by id, open or closed. */
  requests: Map<string, OpenRequest>
  /** In a friendship: each person's latest `friend.linked` list. */
  friendTokens: Map<PersonId, FriendToken[]>
  /** In a friendship: invites to other groups, oldest first. */
  friendInvites: FriendInvite[]
  currency?: string
  /** True when the founder joined with a key: every event must then be signed. */
  signed: boolean
  members: Map<PersonId, Member>
  expenses: Map<string, Expense>
  settlements: Map<string, Settlement>
  /** Settlement id → who recorded it. */
  recordedBy: Map<string, PersonId>
  /** Expense id → event id of its current version (or its deletion). */
  heads: Map<string, string>
  deleted: Set<string>
  conflicts: Conflict[]
  rejected: Rejection[]
  /** Highest clock seen; a device's next event uses this + 1. */
  clock: number
}

/**
 * Total order: clock, then author, then event id. Every device sorts the same
 * events identically. Duplicate deliveries (same id) are dropped.
 */
export function orderEvents(events: Iterable<LedgerEvent>): LedgerEvent[] {
  const unique = new Map<string, LedgerEvent>()
  for (const e of events) if (!unique.has(e.id)) unique.set(e.id, e)
  return [...unique.values()].sort(
    (a, b) =>
      a.clock - b.clock ||
      (a.author < b.author ? -1 : a.author > b.author ? 1 : 0) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  )
}

export function emptyState(): GroupState {
  return {
    signed: false,
    members: new Map(),
    expenses: new Map(),
    settlements: new Map(),
    recordedBy: new Map(),
    sent: new Map(),
    requests: new Map(),
    friendTokens: new Map(),
    friendInvites: [],
    heads: new Map(),
    deleted: new Set(),
    conflicts: [],
    rejected: [],
    clock: 0,
  }
}

/**
 * Rebuilds a group's state from its full log. Pure and deterministic: the same
 * set of events always produces the same state, on every device.
 *
 * Rules:
 * - Only members may write, except the very first `member.added`, which
 *   founds the group, and (in a signed group) a phone adding itself.
 * - In a signed group, every event's `signer` must be its author's key.
 *   A member nobody has claimed yet can't write until a phone claims them.
 * - Concurrent edits to one expense: the later event in the total order wins,
 *   and the overwritten one is reported in `conflicts` so the app can show it.
 * - A deletion beats a concurrent edit. The edit is reported as a conflict.
 * - Invalid events are rejected and reported, never thrown.
 */
export interface ReplayOptions {
  /**
   * Keys this phone has already seen people join with (member id → key).
   * Clocks are chosen by whoever writes an event, so someone holding the
   * group key could write a join or claim dated before a person's real one
   * and take their place. A phone that already knows who joined with which
   * key rejects that. See `firstKeys`.
   */
  pins?: Readonly<Record<PersonId, string>>
}

export function replay(input: Iterable<LedgerEvent>, options: ReplayOptions = {}): GroupState {
  const state = emptyState()
  const reject = (e: { id?: unknown } | null, reason: string) =>
    state.rejected.push({ eventId: typeof e?.id === 'string' ? e.id : '?', reason })
  const pins = options.pins ?? {}
  const pinned = (id: PersonId, key: string | undefined) => pins[id] !== undefined && pins[id] !== key

  // Malformed events are set aside before anything else, so nothing below sees one.
  const events: LedgerEvent[] = []
  for (const e of input) {
    const problem = shapeProblem(e)
    if (problem) reject(e, problem)
    else events.push(e)
  }
  // A group that has ever been shared is signed from its first event; an
  // unsigned founding event in it is an attempt to switch the checks off.
  const shared = events.some((e) => e.signer !== undefined)

  for (const e of orderEvents(events)) {
    try {
      step(e)
    } catch {
      reject(e, 'Malformed event')
    }
  }
  return state

  function step(e: LedgerEvent): void {
    // Honest phones count up one at a time. A clock far ahead of everything
    // before it could only be meant to run the clock out.
    if (e.clock > state.clock + MAX_CLOCK_JUMP) {
      reject(e, 'Clock jumps too far ahead')
      return
    }
    state.clock = Math.max(state.clock, e.clock)

    const founding = state.members.size === 0 && e.type === 'member.added'
    const selfJoin =
      state.signed &&
      e.type === 'member.added' &&
      e.member.id === e.author &&
      !state.members.has(e.author)

    if (founding) {
      if (e.type === 'member.added' && e.member.key === undefined && shared) {
        reject(e, 'A shared group’s founder must sign')
        return
      }
      if (e.type === 'member.added' && pinned(e.member.id, e.member.key)) {
        reject(e, 'This phone knows them by another key')
        return
      }
      if (e.type === 'member.added' && e.member.key !== undefined) {
        if (e.signer !== e.member.key) {
          reject(e, 'The founder must sign with their own key')
          return
        }
        state.signed = true
      }
    } else if (selfJoin) {
      if (e.type !== 'member.added' || !e.member.key || e.signer !== e.member.key) {
        reject(e, 'A phone joining must sign with the key it joins with')
        return
      }
      if (pinned(e.member.id, e.member.key)) {
        reject(e, 'This phone knows them by another key')
        return
      }
    } else if (!state.members.has(e.author)) {
      reject(e, 'Author is not a member of this group')
      return
    } else if (state.members.get(e.author)!.left) {
      reject(e, 'Author has left the group')
      return
    } else if (state.signed) {
      const key = state.members.get(e.author)!.key
      if (e.type === 'member.claimed') {
        if (key !== undefined) {
          reject(e, 'That person has already joined on a phone')
          return
        }
        if (e.memberId !== e.author || e.signer !== e.key) {
          reject(e, 'A claim must be signed with the key it claims with')
          return
        }
        if (pinned(e.memberId, e.key) && !state.members.get(e.memberId)!.removedBy) {
          reject(e, 'This phone knows them by another key')
          return
        }
      } else if (key === undefined) {
        reject(e, 'Author has not joined on a phone yet')
        return
      } else if (e.signer !== key) {
        reject(e, 'Signed with the wrong key')
        return
      }
    } else if (e.type === 'member.claimed') {
      reject(e, 'Only shared groups can be joined')
      return
    } else if (e.type === 'member.rekeyed' || e.type === 'member.recovered') {
      reject(e, 'Only shared groups have keys to move')
      return
    }

    switch (e.type) {
      case 'member.added':
        if (state.members.has(e.member.id)) reject(e, 'Already a member')
        else if (state.kind === 'friends' && [...state.members.values()].filter((m) => !m.left).length >= 2) {
          reject(e, 'A friendship is between two people')
        }
        else if (founding && e.member.id !== e.author) reject(e, 'The founder must add themselves')
        else if (!founding && !selfJoin && e.member.key !== undefined) {
          reject(e, 'Only the person themselves can add their key')
        } else if (
          !founding &&
          !selfJoin &&
          (e.member.lightningAddress !== undefined || e.member.lightningAddresses !== undefined || e.member.receive !== undefined || e.member.boxKey !== undefined)
        ) {
          reject(e, 'Only people themselves can set how they get paid')
        } else if (e.member.lightningAddress !== undefined && !isLightningAddress(e.member.lightningAddress)) {
          reject(e, 'Not a Lightning address')
        } else if (e.member.lightningAddresses?.some((a) => !isLightningAddress(a))) reject(e, 'Not a Lightning address')
        else if (e.member.receive?.some((a) => !isLightningAddress(a) && !isOffer(a))) reject(e, 'Not a Lightning address or BOLT12 offer')
        else state.members.set(e.member.id, { ...e.member, name: e.member.name.trim() })
        break

      case 'member.claimed': {
        const member = state.members.get(e.memberId)!
        member.key = e.key
        delete member.removedBy
        break
      }

      case 'member.recovered': {
        const member = state.members.get(e.memberId)
        if (!member || member.left) reject(e, 'No such member')
        else if (e.memberId === e.author) reject(e, 'Someone else in the group has to vouch for your new phone')
        else if (typeof e.key !== 'string' || !e.key || e.key === member.key) reject(e, 'Needs a new key')
        else if ([...state.members.values()].some((m) => m.key === e.key)) reject(e, 'That key belongs to someone else')
        else {
          member.key = e.key
          delete member.boxKey
          delete member.removedBy
          member.recoveredBy = e.author
        }
        break
      }

      case 'member.removed': {
        const member = state.members.get(e.memberId)
        if (!state.signed) reject(e, 'Only shared groups have phones to remove')
        else if (!member || member.left) reject(e, 'No such member')
        else if (e.memberId === e.author) reject(e, 'To leave, leave the group instead')
        else if (member.key === undefined) reject(e, 'They haven’t joined on a phone')
        else {
          delete member.key
          delete member.boxKey
          member.removedBy = e.author
          // Someone who never took part (often a stranger with the link) disappears entirely.
          if (!owesOrIsOwed(state, member.id) && !tookPart(state, member.id)) member.left = true
        }
        break
      }

      case 'group.rekeyed': {
        const wrappedOk =
          e.wrapped !== null &&
          typeof e.wrapped === 'object' &&
          Object.entries(e.wrapped).every(([id, w]) => state.members.has(id) && typeof w === 'string' && w.length < 512)
        if (!state.signed) reject(e, 'Only shared groups have keys')
        else if (typeof e.from !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(e.from)) reject(e, 'Bad room')
        else if (typeof e.ephemeral !== 'string' || !/^[A-Za-z0-9_-]{80,100}$/.test(e.ephemeral)) reject(e, 'Bad key')
        else if (!wrappedOk) reject(e, 'Bad key hand-off')
        break
      }

      case 'member.rekeyed': {
        const member = state.members.get(e.memberId)
        if (!member || e.memberId !== e.author) reject(e, 'Only people themselves can move to a new phone')
        else if (typeof e.key !== 'string' || !e.key || e.key === member.key) reject(e, 'Needs a new key')
        else if ([...state.members.values()].some((m) => m.key === e.key)) reject(e, 'That key belongs to someone else')
        else member.key = e.key
        break
      }

      case 'member.updated': {
        const member = state.members.get(e.memberId)
        const hasAddresses = 'lightningAddress' in e || 'lightningAddresses' in e
        const hasReceive = Array.isArray(e.receive)
        // Newer phones send the whole ordered list; older ones a single address.
        const list = Array.isArray(e.lightningAddresses)
          ? e.lightningAddresses
          : e.lightningAddress
            ? [e.lightningAddress]
            : []
        if (!member) reject(e, 'No such member')
        else if (e.memberId !== e.author) reject(e, 'Only people themselves can change how they get paid')
        else if (e.boxKey !== undefined && (typeof e.boxKey !== 'string' || !/^[A-Za-z0-9_-]{80,100}$/.test(e.boxKey))) {
          reject(e, 'Bad box key')
        } else if (hasAddresses && list.length > MAX_ADDRESSES) reject(e, `At most ${MAX_ADDRESSES} Lightning addresses`)
        else if (hasAddresses && !list.every((a) => typeof a === 'string' && isLightningAddress(a))) {
          reject(e, 'Not a Lightning address')
        } else if (hasReceive && e.receive!.length > MAX_ADDRESSES) reject(e, `At most ${MAX_ADDRESSES} places to receive`)
        else if (
          hasReceive &&
          !e.receive!.every((a) => typeof a === 'string' && (isLightningAddress(a) || isOffer(a)))
        ) {
          reject(e, 'Not a Lightning address or BOLT12 offer')
        } else {
          if (e.boxKey !== undefined) member.boxKey = e.boxKey
          if (hasAddresses) {
            const clean = [...new Set(list.map((a) => a.toLowerCase()))]
            if (clean.length === 0) {
              delete member.lightningAddress
              delete member.lightningAddresses
            } else {
              member.lightningAddresses = clean
              member.lightningAddress = clean[0]!
            }
            // An older phone sent addresses alone: its list is the whole truth now.
            if (!hasReceive) delete member.receive
          }
          if (hasReceive) {
            const clean = [...new Set(e.receive!.map((a) => a.toLowerCase()))]
            if (clean.length === 0) delete member.receive
            else member.receive = clean
          }
        }
        break
      }

      case 'group.updated':
        if (e.name !== undefined && (typeof e.name !== 'string' || !e.name.trim() || e.name.length > 80)) {
          reject(e, 'A group needs a name of up to 80 characters')
          break
        }
        if (e.currency !== undefined && !isKnownCurrency(e.currency)) {
          reject(e, `Unknown currency code: ${e.currency}`)
          break
        }
        if (e.kind !== undefined && e.kind !== 'friends') {
          reject(e, 'Unknown kind of group')
          break
        }
        if (e.name !== undefined) state.name = e.name.trim()
        if (e.kind !== undefined) state.kind = e.kind
        if (e.currency !== undefined) state.currency = e.currency
        break

      case 'member.renamed': {
        const member = state.members.get(e.memberId)
        if (!member || member.left) reject(e, 'No such member')
        else if ((member.key !== undefined || member.removedBy !== undefined) && e.memberId !== e.author) {
          reject(e, 'Only people themselves can change their name once they’ve joined')
        } else if (typeof e.name !== 'string' || !e.name.trim()) reject(e, 'A person needs a name')
        else member.name = e.name.trim()
        break
      }

      case 'member.left': {
        const member = state.members.get(e.memberId)
        if (!member || e.memberId !== e.author) reject(e, 'Only people themselves can leave')
        else if (owesOrIsOwed(state, e.memberId)) reject(e, 'Settle up before leaving')
        else member.left = true
        break
      }

      case 'expense.saved': {
        const { expense } = e
        const problems = validateExpense(expense, new Set(state.members.keys()))
        if (problems.length > 0) {
          reject(e, problems.join('; '))
          break
        }
        const head = state.heads.get(expense.id)
        const leaver = changesSomeoneWhoLeft(state, state.expenses.get(expense.id), expense)
        if (leaver) {
          reject(e, `${leaver} has left the group, so what they paid or owe can’t change`)
          break
        }
        if (state.deleted.has(expense.id)) {
          state.conflicts.push({ expenseId: expense.id, kept: head!, overwritten: e.id })
          break
        }
        if (head !== undefined && e.basedOn !== head) {
          state.conflicts.push({ expenseId: expense.id, kept: e.id, overwritten: head })
        }
        state.expenses.set(expense.id, expense)
        state.heads.set(expense.id, e.id)
        break
      }

      case 'expense.deleted': {
        const head = state.heads.get(e.expenseId)
        if (head === undefined) {
          reject(e, 'No such expense')
          break
        }
        if (state.deleted.has(e.expenseId)) break // deleted twice: harmless
        const leaver = changesSomeoneWhoLeft(state, state.expenses.get(e.expenseId), undefined)
        if (leaver) {
          reject(e, `${leaver} has left the group, so what they paid or owe can’t change`)
          break
        }
        if (e.basedOn !== head) {
          state.conflicts.push({ expenseId: e.expenseId, kept: e.id, overwritten: head })
        }
        state.expenses.delete(e.expenseId)
        state.deleted.add(e.expenseId)
        state.heads.set(e.expenseId, e.id)
        break
      }

      case 'settlement.recorded': {
        const s = e.settlement
        if (state.settlements.has(s.id)) reject(e, 'Settlement already recorded')
        else if (!state.members.has(s.from) || !state.members.has(s.to)) {
          reject(e, 'Settlement between unknown people')
        } else if (!Number.isSafeInteger(s.amount) || s.amount <= 0) {
          reject(e, 'Settlement amount must be a positive whole number of minor units')
        } else if (s.from === s.to) reject(e, 'Cannot settle with yourself')
        else if (state.members.get(s.from)!.left || state.members.get(s.to)!.left) {
          reject(e, 'Someone in this payment has left the group')
        }
        else if (!isKnownCurrency(s.currency)) reject(e, `Unknown currency code: ${s.currency}`)
        else if ((s.method === 'bitcoin' || s.bitcoin) && e.author !== s.from) {
          reject(e, 'Only the person who paid can record a bitcoin payment')
        } else {
          state.settlements.set(s.id, s)
          state.recordedBy.set(s.id, e.author)
        }
        break
      }

      case 'money.sent': {
        const x = e.sent
        if (state.sent.has(x.id)) reject(e, 'Already recorded')
        else if (x.from !== e.author) reject(e, 'Only the person who sent it can record it')
        else if (!state.members.has(x.to) || x.to === x.from || state.members.get(x.to)!.left) reject(e, 'Sent to someone not here')
        else if (!Number.isSafeInteger(x.amount) || x.amount <= 0) reject(e, 'Amount must be a positive whole number of minor units')
        else if (!isKnownCurrency(x.currency)) reject(e, `Unknown currency code: ${x.currency}`)
        else state.sent.set(x.id, x)
        break
      }

      case 'payment.requested': {
        const r = e.request
        if (state.requests.has(r.id)) reject(e, 'Already asked')
        else if (r.from !== e.author) reject(e, 'Only the person asking can ask')
        else if (!state.members.has(r.to) || r.to === r.from || state.members.get(r.to)!.left) reject(e, 'Asking someone not here')
        else if (!Number.isSafeInteger(r.amount) || r.amount <= 0) reject(e, 'Amount must be a positive whole number of minor units')
        else if (!isKnownCurrency(r.currency)) reject(e, `Unknown currency code: ${r.currency}`)
        else state.requests.set(r.id, { ...r })
        break
      }

      case 'request.closed': {
        const r = state.requests.get(e.requestId)
        if (!r) reject(e, 'No such request')
        else if (r.outcome) reject(e, 'Already closed')
        else if (e.outcome === 'cancelled' ? e.author !== r.from : e.author !== r.to) reject(e, 'Not yours to close')
        else r.outcome = e.outcome
        break
      }

      case 'friend.linked':
        if (state.kind !== 'friends') reject(e, 'Only friends share this')
        else state.friendTokens.set(e.author, e.tokens)
        break

      case 'friend.invited':
        if (state.kind !== 'friends') reject(e, 'Only friends share this')
        else state.friendInvites.push({ eventId: e.id, from: e.author, secret: e.secret, groupId: e.group, name: e.name, expiresAt: e.expiresAt })
        break

      case 'settlement.voided': {
        const s = state.settlements.get(e.settlementId)
        if (!s) reject(e, 'No such settlement')
        else if (![s.from, s.to, state.recordedBy.get(e.settlementId)].includes(e.author)) {
          reject(e, 'Only the people in a payment, or whoever recorded it, can undo it')
        } else if (state.members.get(s.from)?.left || state.members.get(s.to)?.left) {
          reject(e, 'Someone in this payment has left the group')
        } else state.settlements.delete(e.settlementId)
        break
      }
    }
  }
}

/** True if the person paid for, shared in, or was part of a payment in anything still in the group. */
function tookPart(state: GroupState, person: PersonId): boolean {
  for (const expense of state.expenses.values()) if ((effect(expense).get(person) ?? 0) !== 0 || person in expense.payers) return true
  for (const s of state.settlements.values()) if (s.from === person || s.to === person) return true
  return false
}

/** True if the person is owed or owes anything, in any currency. */
function owesOrIsOwed(state: GroupState, person: PersonId): boolean {
  for (const byPerson of groupBalances(state).values()) if (byPerson.get(person)) return true
  return false
}

/** What one expense does to each person's balance: paid minus share. */
function effect(expense: Expense | undefined): Map<PersonId, number> {
  const out = new Map<PersonId, number>()
  if (!expense) return out
  for (const [p, paid] of Object.entries(expense.payers)) out.set(p, (out.get(p) ?? 0) + paid)
  for (const [p, share] of computeShares(expense)) out.set(p, (out.get(p) ?? 0) - share)
  return out
}

/**
 * The name of someone who has left and whose balance this change would
 * move, or undefined. Edits that leave them untouched (a new title, shares
 * moved between others) are fine.
 */
function changesSomeoneWhoLeft(state: GroupState, before: Expense | undefined, after: Expense | undefined) {
  const was = effect(before)
  const now = effect(after)
  for (const member of state.members.values()) {
    if (member.left && (was.get(member.id) ?? 0) !== (now.get(member.id) ?? 0)) return member.name
  }
  return undefined
}

/** Balances for a replayed group. */
export function groupBalances(state: GroupState): Balances {
  return computeBalances(state.expenses.values(), state.settlements.values())
}

/**
 * The key each person first joined with, as this log shows it: the founder's,
 * each self-join's and each claim's. A phone keeps these and passes them back
 * to `replay` as `pins`; invites and moves to a new phone carry them along.
 */
export function firstKeys(events: Iterable<LedgerEvent>, state: GroupState): Record<PersonId, string> {
  const rejected = new Set(state.rejected.map((r) => r.eventId))
  const out: Record<PersonId, string> = {}
  for (const e of orderEvents(events)) {
    if (rejected.has(e.id)) continue
    if (e.type === 'member.added' && e.member?.key && e.member.id === e.author && out[e.author] === undefined) out[e.author] = e.member.key
    if (e.type === 'member.claimed' && out[e.memberId] === undefined) out[e.memberId] = e.key
  }
  return out
}
