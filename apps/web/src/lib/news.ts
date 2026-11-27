/**
 * What's worth telling someone about, and how to say it. Shared by the in-app
 * banners and the service worker's notifications, so both say the same thing.
 *
 * Kept free of React and of the page (no window, no location): the service
 * worker imports it too.
 */
import { i18n } from '@lingui/core'
import { t } from '@lingui/core/macro'
import { computeShares, formatAmount, type GroupState, type LedgerEvent, type Settlement } from '@waroo/ledger'

export type NewsKind = 'paid-you' | 'you-paid' | 'others-paid' | 'joined' | 'left' | 'expense'

export interface News {
  id: string
  kind: NewsKind
  title: string
  detail: string
}

/** The app's language, in the phone's regional flavour when they match. Works in the service worker too. */
const lang = () => {
  const app = i18n.locale || 'en'
  const phone = (typeof navigator !== 'undefined' && navigator.language) || app
  return phone.toLowerCase().split('-')[0] === app ? phone : app
}
const money = (amount: number, currency: string) => formatAmount(amount, currency, lang())
const satsText = (n: number) => {
  const count = new Intl.NumberFormat(lang()).format(n)
  return t`${count} sats`
}

/**
 * Events that should wake the others' phones. The sender decides, since the
 * relay can't read anything. Edits, renames and the like stay quiet.
 */
export function isNotable(event: LedgerEvent): boolean {
  switch (event.type) {
    case 'settlement.recorded':
    case 'member.claimed':
    case 'member.left':
    case 'member.removed':
    case 'member.recovered':
    case 'friend.invited':
      return true
    case 'member.added':
      return event.member.id === event.author && event.member.key !== undefined
    case 'expense.saved':
      return !event.basedOn
    default:
      return false
  }
}

/**
 * Describes one event for the person `meId`, or null if it isn't news to
 * them. `state` is the group after the event, for names and shares.
 * `mine` is true when this phone wrote the event itself.
 */
export function describeEvent(
  event: LedgerEvent,
  state: GroupState,
  meId: string,
  groupName: string,
  mine: boolean,
): News | null {
  const name = (id: string) => state.members.get(id)?.name ?? t`Someone`
  const group = groupName
  // A friendship is named after the friend, so "in Ana" would read oddly: leave it out.
  const friendship = state.kind === 'friends'
  const inGroup = friendship ? '' : t`In ${group}`
  // Only what the group actually accepted is news: an event replay threw out
  // (wrong key, not a member, a forgery) says nothing about anyone.
  if (state.rejected.some((r) => r.eventId === event.id)) return null

  if (event.type === 'settlement.recorded') {
    const s: Settlement = event.settlement
    const amount = money(s.amount, s.currency)
    const sats = s.bitcoin ? satsText(s.bitcoin.sats) : ''
    const detail = !s.bitcoin
      ? inGroup
      : friendship
        ? t`${sats} over Lightning`
        : t`${sats} over Lightning, in ${group}`
    const base = { id: s.id }
    const from = name(s.from)
    const to = name(s.to)
    const by = name(event.author)
    if (mine) {
      // Only a bitcoin payment is news to the payer: a manual record is what they just did.
      return s.from === meId && s.bitcoin
        ? { ...base, kind: 'you-paid', title: t`Payment sent: ${amount} to ${to}`, detail }
        : null
    }
    if (s.to === meId) {
      return s.bitcoin
        ? { ...base, kind: 'paid-you', title: t`${from} paid you ${amount}`, detail }
        : event.author === s.from
          ? { ...base, kind: 'paid-you', title: t`${from} marked ${amount} as paid to you`, detail }
          : { ...base, kind: 'paid-you', title: t`${by} marked ${from}’s ${amount} to you as paid`, detail }
    }
    if (s.from === meId) {
      return event.author === s.to
        ? { ...base, kind: 'you-paid', title: t`${to} marked your ${amount} as paid`, detail }
        : { ...base, kind: 'you-paid', title: t`${by} marked your ${amount} to ${to} as paid`, detail }
    }
    return { ...base, kind: 'others-paid', title: t`${from} paid ${to} ${amount}`, detail }
  }

  if (mine) return null

  if (isNotable(event) && (event.type === 'member.added' || event.type === 'member.claimed')) {
    const who = name(event.type === 'member.added' ? event.member.id : event.memberId)
    if (friendship) {
      return { id: event.id, kind: 'joined', title: t`${who} accepted your friend request`, detail: t`You can split costs with each other now` }
    }
    return { id: event.id, kind: 'joined', title: t`${who} joined ${group}`, detail: t`They can see the group and add expenses now` }
  }

  if (event.type === 'friend.invited') {
    const from = name(event.author)
    const to = event.name
    return { id: event.id, kind: 'joined', title: t`${from} invited you to ${to}`, detail: t`It’s on your Groups page` }
  }

  if (event.type === 'member.recovered') {
    const by = name(event.author)
    if (event.memberId === meId) {
      return { id: event.id, kind: 'joined', title: t`${by} moved you to a new phone in ${group}`, detail: t`If that wasn’t you, tell the group` }
    }
    const who = name(event.memberId)
    return { id: event.id, kind: 'joined', title: t`${who} is back in ${group} on a new phone`, detail: t`${by} vouched for it` }
  }

  if (event.type === 'member.removed') {
    const by = name(event.author)
    if (event.memberId === meId) {
      return { id: event.id, kind: 'left', title: t`${by} removed you from ${group}`, detail: t`This phone won’t get anything new from the group` }
    }
    const who = name(event.memberId)
    return { id: event.id, kind: 'left', title: t`${by} removed ${who} from ${group}`, detail: t`Their expenses stay in the group` }
  }

  if (event.type === 'member.left') {
    if (friendship) return null
    const who = name(event.memberId)
    return { id: event.id, kind: 'left', title: t`${who} left ${group}`, detail: t`They were all square` }
  }

  if (event.type === 'expense.saved' && !event.basedOn) {
    // Say it as it is now: it may have been edited, or deleted, since.
    if (state.deleted.has(event.expense.id)) return null
    const e = state.expenses.get(event.expense.id)
    if (!e) return null
    let myShare: number | undefined
    try {
      myShare = computeShares(e).get(meId)
    } catch {
      myShare = undefined
    }
    const who = name(event.author)
    const title = e.title
    const total = money(e.total, e.currency)
    const share = myShare ? money(myShare, e.currency) : ''
    return {
      id: event.id,
      kind: 'expense',
      title: t`${who} added ${title}, ${total}`,
      detail: myShare ? (friendship ? t`Your share is ${share}` : t`Your share is ${share}, in ${group}`) : inGroup,
    }
  }
  return null
}

/** A notification for several things at once in one group. */
export function severalNews(groupName: string, count: number): string {
  const group = groupName
  return t`${group}: ${count} new things`
}
