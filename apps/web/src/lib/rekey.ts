import { t } from '@lingui/core/macro'
/**
 * Removing someone, and the new group key that makes it stick.
 *
 * The group key opens the relay room. A removed phone still has the old
 * key, so the group moves to a new one: the phone doing the removal makes a
 * new key, locks it to each remaining member's box key (`group.rekeyed`,
 * written in the old room), and moves to the new room, copying the history
 * there. Every other phone sees the hand-off, opens its copy, and moves too.
 * The removed phone can't open it, so nothing new reaches it.
 *
 * Phones that hadn't published a box key yet (not opened since this
 * feature) publish one in the old room when they next open. Phones that
 * moved keep reading old rooms for a while and hand those late phones the
 * current key there. If two people remove someone at once, every phone
 * settles on the same key: the hand-off that sorts last, followed from the
 * oldest room it knows.
 */
import { orderEvents, replay, type LedgerEvent } from '@waroo/ledger'
import { newGroupKey, roomId, unwrapGroupKey, wrapGroupKey } from './crypto.ts'
import { append, getGroup, replayGroup, getStoredEvents, markAllPending, pendingEvents, putGroup, type StoredEvent } from './db.ts'
import { invitesFor, inviteStatus, stopInvite } from './invites.ts'
import type { MovedGroup } from './move.ts'
import { setKeyFollower, syncHub } from './sync.ts'

type Rekeyed = Extract<LedgerEvent, { type: 'group.rekeyed' }>

/** Removes someone's phone from a group and moves the group to a new key. */
export async function removeMember(groupId: string, memberId: string): Promise<void> {
  const group = await getGroup(groupId)
  if (!group?.shared || !group.key || !group.box || !group.boxPublic) throw new Error(t`This group isn’t shared, so there’s no phone to remove.`)
  await append(group, [{ type: 'member.removed', memberId }])
  await rotate(groupId, memberId)
}

/**
 * Someone lost their phone: this phone vouches for their new one (whose
 * signing key is `newKey`), then moves the group to a new key so the lost
 * phone can't read on. Returns the group as the new phone should store it.
 */
export async function recoverMember(groupId: string, memberId: string, newKey: string): Promise<MovedGroup> {
  const group = await getGroup(groupId)
  if (!group?.shared || !group.key || !group.box || !group.boxPublic) throw new Error(t`This group isn’t shared yet.`)
  await append(group, [{ type: 'member.recovered', memberId, key: newKey }])
  const key = await rotate(groupId, memberId)
  const moved = (await getGroup(groupId))!
  return { id: moved.id, name: moved.name, currency: moved.currency, meId: memberId, key, createdAt: moved.createdAt }
}

/**
 * Makes a new group key, hands it to everyone still in the group except
 * `leaveOut` (their copy goes some other way, or not at all), and moves.
 */
async function rotate(groupId: string, leaveOut: string): Promise<string> {
  let group = (await getGroup(groupId))!
  const state = await replayGroup(groupId)
  const recipients = [...state.members.values()]
    .filter((m) => !m.left && m.key !== undefined && m.id !== leaveOut)
    .map((m) => ({ memberId: m.id, boxKey: m.id === group!.meId ? group!.boxPublic! : m.boxKey }))
    .filter((r): r is { memberId: string; boxKey: string } => !!r.boxKey)
  const newKey = newGroupKey()
  const { ephemeral, wrapped } = await wrapGroupKey(newKey, recipients)
  group = (await getGroup(groupId))!
  await append(group, [{ type: 'group.rekeyed', from: await roomId(group.key!), ephemeral, wrapped }])

  // The others can only follow once both are on the relay.
  await syncHub.ensure(groupId)
  const deadline = Date.now() + 20_000
  while ((await pendingEvents(groupId)).length > 0) {
    if (Date.now() > deadline) throw new Error(t`Couldn’t reach Waroo to tell the group. Check your connection and try again.`)
    await new Promise((r) => setTimeout(r, 300))
  }
  await moveToKey(groupId, newKey)
  return newKey
}

/** Switches this phone to a group's new key and room, copying the history across. */
async function moveToKey(groupId: string, newKey: string) {
  const group = (await getGroup(groupId))!
  if (!group.key || group.key === newKey) return
  // Who was in the group, on which key, as this phone left the old room. Only
  // they can be handed the new key there later: anyone who turns up in the
  // old room afterwards is someone holding the old key, which may well be
  // the person just removed.
  const state = await replayGroup(groupId)
  const keyed: Record<string, string> = {}
  for (const m of state.members.values()) if (!m.left && m.key) keyed[m.id] = m.key
  const previousKeys = [
    ...(group.previousKeys ?? []).filter((p) => p.key !== group.key && p.key !== newKey),
    { key: group.key, movedAt: new Date().toISOString(), cursor: group.cursor ?? 0, keyed },
  ].slice(-5)
  await putGroup({ ...group, key: newKey, cursor: 0, previousKeys })
  // Every phone copies what it has into the new room; the relay drops duplicates.
  await markAllPending(groupId)
  await stopOwnInvites(groupId)
  await syncHub.restart(groupId)
}

/** Invite links made on this phone hold the old key: turn them off. */
async function stopOwnInvites(groupId: string) {
  for (const invite of await invitesFor(groupId)) {
    if (invite.expiresAt < Date.now()) continue
    try {
      if ((await inviteStatus(invite)).state === 'open') await stopInvite(invite)
    } catch {
      // Offline: it expires on its own, and leads only to the old room.
    }
  }
}

const strip = ({ groupId: _g, sig: _s, pending: _p, ...event }: StoredEvent) => event as LedgerEvent

/** Valid hand-offs in this group's log, in the order every phone agrees on. */
function handOffs(events: StoredEvent[]): Rekeyed[] {
  const plain = events.map(strip)
  const rejected = new Set(replay(plain).rejected.map((r) => r.eventId))
  return orderEvents(plain).filter((e): e is Rekeyed => e.type === 'group.rekeyed' && !rejected.has(e.id))
}

/**
 * Follows the group's key changes: from the oldest room this phone knows,
 * through each hand-off it can open, to the latest key. Moves there if
 * that's not where this phone is.
 */
async function follow(groupId: string) {
  const group = await getGroup(groupId)
  if (!group?.shared || !group.key || !group.box) return
  const rekeys = handOffs(await getStoredEvents(groupId))
  if (rekeys.length === 0) return
  let chain = group.previousKeys?.[0]?.key ?? group.key
  const seen = new Set([chain])
  for (let step = 0; step < 20; step++) {
    const room = await roomId(chain)
    const next = rekeys.filter((r) => r.from === room && r.wrapped[group.meId]).at(-1)
    if (!next) break
    const key = await unwrapGroupKey(next.wrapped[group.meId]!, next.ephemeral, group.box.privateKey, group.meId)
    if (!key || seen.has(key)) break
    seen.add(key)
    chain = key
  }
  if (chain !== group.key) await moveToKey(groupId, chain)
}

/**
 * In each old room this phone still reads: anyone still in the group who
 * has a box key but wasn't handed the new key there (they hadn't published
 * one yet) gets the current key, written into that old room where their
 * phone will see it.
 */
async function handOverToLatePhones(groupId: string) {
  const group = await getGroup(groupId)
  if (!group?.key || !group.previousKeys?.length) return
  const events = await getStoredEvents(groupId)
  const state = await replayGroup(groupId, events.map(strip))
  const rekeys = handOffs(events)
  for (const previous of group.previousKeys) {
    const room = await roomId(previous.key)
    const fromRoom = rekeys.filter((r) => r.from === room)
    if (fromRoom.length === 0) continue
    const late = [...state.members.values()].filter(
      (m) =>
        !m.left &&
        m.key !== undefined &&
        previous.keyed?.[m.id] === m.key &&
        m.boxKey &&
        m.id !== group.meId &&
        !fromRoom.some((r) => r.wrapped[m.id]),
    )
    if (late.length === 0) continue
    const { ephemeral, wrapped } = await wrapGroupKey(
      group.key,
      late.map((m) => ({ memberId: m.id, boxKey: m.boxKey! })),
    )
    const [written] = await append(group, [{ type: 'group.rekeyed', from: room, ephemeral, wrapped }])
    const stored = (await getStoredEvents(groupId)).find((e) => e.id === written!.id)
    if (stored?.sig) await syncHub.sendToOldRoom(groupId, previous.key, written!, stored.sig)
  }
}

// One check at a time per group; a check asked for meanwhile runs after.
const running = new Map<string, Promise<void>>()
export function followKeys(groupId: string): Promise<void> {
  const previous = running.get(groupId) ?? Promise.resolve()
  const next = previous
    .then(async () => {
      await follow(groupId)
      await handOverToLatePhones(groupId)
    })
    .catch((err) => console.warn('key change', err))
  running.set(groupId, next)
  return next
}

setKeyFollower(followKeys)
