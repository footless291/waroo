/**
 * Friends, across groups. A friendship is a private group of two. Each side
 * tells the other, in that private log, which members of other groups they
 * are (as friend tokens: see crypto.ts). A friend's phone recognises only
 * groups it's in too, so nobody learns about groups they aren't in, and the
 * groups themselves never see any of this.
 */
import { groupBalances, suggestTransfers, type FriendInvite, type GroupState } from '@waroo/ledger'
import { friendToken, signText, verifyText } from './crypto.ts'
import { append, listGroups, replayGroup, type GroupMeta } from './db.ts'
import { groupTitle } from './title.ts'

/** Groups (not friendships) this phone can speak for. */
async function myGroups(): Promise<{ meta: GroupMeta; state: GroupState }[]> {
  const out = []
  for (const meta of await listGroups()) {
    if (meta.friend || !meta.shared || !meta.key) continue
    out.push({ meta, state: await replayGroup(meta.id) })
  }
  return out
}

/** The other person in a friendship, if they've joined. */
export function friendIn(state: GroupState, meId: string) {
  return [...state.members.values()].find((m) => m.id !== meId && !m.left)
}

/**
 * Brings every friendship up to date with which groups this phone is in.
 * Only writes when something changed: a group joined or left, or a new key
 * after moving phones.
 */
let running: Promise<void> = Promise.resolve()
export function publishFriendLinks(): Promise<void> {
  // One at a time: two at once would both write the same list.
  running = running.then(publishNow).catch((err) => console.warn('friend links', err))
  return running
}

async function publishNow(): Promise<void> {
  const groups = (await myGroups()).filter(({ meta, state }) => {
    const me = state.members.get(meta.meId)
    return me && !me.left && me.key && me.key === meta.publicKey && meta.signing
  })
  for (const friendship of await listGroups()) {
    if (!friendship.friend || !friendship.shared) continue
    const state = await replayGroup(friendship.id)
    const me = state.members.get(friendship.meId)
    if (!me || me.left || !me.key) continue
    const wanted = await Promise.all(groups.map(async ({ meta }) => ({ meta, t: await friendToken(meta.key!, friendship.id, meta.meId) })))
    const posted = state.friendTokens.get(friendship.meId) ?? []
    const byToken = new Map(posted.map((p) => [p.t, p.s]))
    const same =
      posted.length === wanted.length &&
      (await Promise.all(wanted.map(async (w) => {
        const s = byToken.get(w.t)
        return !!s && (await verifyText(w.t, s, w.meta.publicKey!))
      }))).every(Boolean)
    if (same) continue
    const tokens = await Promise.all(wanted.map(async (w) => ({ t: w.t, s: await signText(w.t, w.meta.signing!.privateKey) })))
    await append(friendship, [{ type: 'friend.linked', tokens }])
  }
}

export interface FriendGroup {
  groupId: string
  name: string
  /** Who they are in that group. */
  memberId: string
  /** What's owed between you there, per currency: positive means they owe you. */
  owed: Map<string, number>
}

/** Groups you share with this friend, and what's owed between you two in each. */
export async function sharedGroups(friendship: GroupMeta, state: GroupState): Promise<FriendGroup[]> {
  const friend = friendIn(state, friendship.meId)
  const tokens = friend ? state.friendTokens.get(friend.id) : undefined
  if (!tokens?.length) return []
  const signatures = new Map(tokens.map((x) => [x.t, x.s]))
  const out: FriendGroup[] = []
  for (const { meta, state: g } of await myGroups()) {
    for (const m of g.members.values()) {
      if (m.id === meta.meId || m.left || !m.key) continue
      const t = await friendToken(meta.key!, friendship.id, m.id)
      const s = signatures.get(t)
      if (!s || !(await verifyText(t, s, m.key))) continue
      out.push({ groupId: meta.id, name: groupTitle(g, meta), memberId: m.id, owed: owedBetween(g, meta.meId, m.id) })
      break
    }
  }
  return out
}

/** What `them` owes `me` in a group, per currency, by the group's own suggested payments. */
export function owedBetween(state: GroupState, me: string, them: string): Map<string, number> {
  const owed = new Map<string, number>()
  for (const x of suggestTransfers(groupBalances(state))) {
    const amount = x.from === them && x.to === me ? x.amount : x.from === me && x.to === them ? -x.amount : 0
    if (amount) owed.set(x.currency, (owed.get(x.currency) ?? 0) + amount)
  }
  return owed
}

/** Invites friends sent this phone to groups it isn't in yet, still usable. */
export async function pendingInvites(): Promise<(FriendInvite & { friendshipId: string; fromName: string })[]> {
  const groups = await listGroups()
  const have = new Set(groups.map((g) => g.id))
  const out = []
  for (const friendship of groups) {
    if (!friendship.friend) continue
    const state = await replayGroup(friendship.id)
    for (const invite of state.friendInvites) {
      if (invite.from === friendship.meId || have.has(invite.groupId) || invite.expiresAt < Date.now()) continue
      out.push({ ...invite, friendshipId: friendship.id, fromName: state.members.get(invite.from)?.name ?? '' })
    }
  }
  return out
}

/** Sends a friend a private invite to a group: a one-person invite link, through the friendship. */
export async function inviteFriend(friendship: GroupMeta, group: { id: string; name: string }, secret: string, expiresAt: number) {
  await append(friendship, [{ type: 'friend.invited', secret, group: group.id, name: group.name, expiresAt }])
}
