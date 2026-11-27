import { t } from '@lingui/core/macro'
/**
 * Moving to a new phone.
 *
 * Each phone's signing keys can't be copied, by design. So moving doesn't
 * copy them: the new phone makes its own key, and the old phone hands each
 * group over to it with a `member.rekeyed` event signed by the old key. After
 * that only the new phone can write as this person.
 *
 * The two phones talk through a one-off relay room named by a secret in the
 * QR code, with every message encrypted with that secret. The relay wipes
 * the room within the hour. The new phone says hello with its signing key
 * and a one-off box key. Both phones show a 4-digit code made from the
 * secret and those keys; the person checks they match before anything
 * moves. The groups then travel locked to that box key, so someone who
 * glimpsed the QR code (or read the link in a chat) sees only that a move
 * happened. Only the old phone's first hello counts: a second one stops
 * the move.
 */
import { ID, isCurrencyCode, isLightningAddress, isOffer, replay } from '@waroo/ledger'
import { decryptJson, encryptJson, isGroupKey, moveRoomId, newGroupKey, unwrapGroupKey, wrapGroupKey } from './crypto.ts'
import {
  append,
  deleteGroupLocally,
  getGroup,
  listGroups,
  makeShareable,
  myLightningAddresses,
  newId,
  pendingEvents,
  publishProfile,
  saveJoinedGroup,
  setSetting,
  type GroupMeta,
} from './db.ts'
import { fetchGroup, relayUrl, syncHub } from './sync.ts'
import { addReceiveNamed, addSend, receiveWallets, walletNames, saveSendWallets, sendWallets, type NewSendWallet } from './wallets.ts'

export interface MovedGroup {
  id: string
  name: string
  currency: string
  meId: string
  key: string
  createdAt: string
  /** The keys the old phone knows people joined with: see GroupMeta.pins. */
  pins?: Record<string, string>
}

/** What the old phone hands over, locked to the new phone's box key inside a `sealed` message. */
export type Handover = {
      from: 'old'
      type: 'groups'
      groups: MovedGroup[]
      lightningAddress: string
      lightningAddresses?: string[]
      /** Everywhere they receive, offers included, with ₿names. Newer phones only. */
      receiveWallets?: { address: string; name?: string }[]
      /** Wallet connections, in order. Only on a move: they're secrets, so never sent when someone else vouches. */
      sendWallets?: NewSendWallet[]
      /** The names you gave your wallets. */
      walletNames?: Record<string, string>
    }

export type MoveMessage =
  | { from: 'new'; type: 'hello'; key: string; box: string }
  /** A `Handover`, encrypted with a one-off key that's locked to the hello's box key. */
  | { from: 'old'; type: 'sealed'; ephemeral: string; wrapped: string; data: string }
  /** `proof` is `moved` encrypted with that one-off key: only the new phone can make it. */
  | { from: 'new'; type: 'done'; proof: string }
  | { from: 'old' | 'new'; type: 'cancel' }

/** A new secret for the QR code. Same shape as a group key: 32 random bytes. */
export const newMoveSecret = newGroupKey

export function moveLink(secret: string): string {
  return `${location.origin}/#/move-in?t=${secret}`
}

/** The encrypted line between the two phones. */
export class MoveChannel {
  private ws?: WebSocket
  private seen = new Set<string>()
  private readonly secret: string
  private readonly side: 'old' | 'new'
  private readonly onMessage: (msg: MoveMessage) => void
  private readonly onLost: () => void

  constructor(secret: string, side: 'old' | 'new', onMessage: (msg: MoveMessage) => void, onLost: () => void) {
    this.secret = secret
    this.side = side
    this.onMessage = onMessage
    this.onLost = onLost
  }

  async open(): Promise<void> {
    const ws = new WebSocket(relayUrl(await moveRoomId(this.secret)))
    this.ws = ws
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => {
        // The old phone opens the room, so it asks for it to be wiped soon.
        ws.send(JSON.stringify({ t: 'hello', since: 0, ...(this.side === 'old' ? { ephemeral: true } : {}) }))
        resolve()
      }
      ws.onerror = () => reject(new Error(t`Couldn’t reach Waroo. Check your connection.`))
    })
    ws.onclose = () => {
      if (this.ws === ws) this.onLost()
    }
    ws.onmessage = async (e) => {
      const msg = JSON.parse(e.data as string) as { t: string; items?: { id: string; data: string }[] }
      if (msg.t !== 'items') return
      for (const item of msg.items ?? []) {
        if (this.seen.has(item.id)) continue
        this.seen.add(item.id)
        const body = await decryptJson<MoveMessage>(this.secret, item.data)
        if (body && body.from !== this.side) this.onMessage(body)
      }
    }
  }

  async send(message: MoveMessage): Promise<void> {
    const id = newId()
    this.seen.add(id)
    this.ws?.send(JSON.stringify({ t: 'push', items: [{ id, data: await encryptJson(this.secret, message) }] }))
  }

  close() {
    const ws = this.ws
    this.ws = undefined
    ws?.close()
  }
}

/** What both phones turn into the 4-digit code: the new phone's keys. */
export const helloKeys = (msg: { key: string; box: string }) => `${msg.key}.${msg.box}`

/** Locks a hand-over to the new phone's box key. Returns the message and the one-off key, for checking 'done'. */
export async function sealHandover(handover: Handover, box: string): Promise<{ message: MoveMessage; sessionKey: string }> {
  const sessionKey = newGroupKey()
  const { ephemeral, wrapped } = await wrapGroupKey(sessionKey, [{ memberId: 'move', boxKey: box }])
  if (!wrapped.move) throw new Error(t`The new phone’s key didn’t look right. Start again.`)
  return { sessionKey, message: { from: 'old', type: 'sealed', ephemeral, wrapped: wrapped.move, data: await encryptJson(sessionKey, handover) } }
}

/** True if a 'done' really came from the phone the hand-over was locked to. */
export async function doneIsGenuine(msg: { proof?: unknown }, sessionKey: string | undefined): Promise<boolean> {
  if (!sessionKey || typeof msg.proof !== 'string') return false
  return Array.isArray(await decryptJson<string[]>(sessionKey, msg.proof))
}

/** Opens a sealed hand-over on the new phone, and checks every field before anything uses it. */
export async function openHandover(
  msg: Extract<MoveMessage, { type: 'sealed' }>,
  box: CryptoKey,
): Promise<{ handover: Handover; sessionKey: string } | null> {
  if (typeof msg.wrapped !== 'string' || typeof msg.ephemeral !== 'string' || typeof msg.data !== 'string') return null
  const sessionKey = await unwrapGroupKey(msg.wrapped, msg.ephemeral, box, 'move')
  if (!sessionKey) return null
  const h = await decryptJson<Handover>(sessionKey, msg.data)
  if (!h || h.type !== 'groups' || !Array.isArray(h.groups) || h.groups.length > 200) return null
  const groupOk = (g: MovedGroup) =>
    typeof g === 'object' && g !== null &&
    typeof g.id === 'string' && /^[0-9a-f-]{36}$/.test(g.id) &&
    typeof g.name === 'string' && g.name.length <= 80 &&
    isCurrencyCode(g.currency) &&
    typeof g.meId === 'string' && ID.test(g.meId) &&
    typeof g.key === 'string' && isGroupKey(g.key) &&
    typeof g.createdAt === 'string' && !Number.isNaN(Date.parse(g.createdAt)) &&
    (g.pins === undefined || (typeof g.pins === 'object' && g.pins !== null && Object.values(g.pins).every((v) => typeof v === 'string')))
  if (!h.groups.every(groupOk)) return null
  const target = (a: unknown) => typeof a === 'string' && (isLightningAddress(a) || isOffer(a))
  const list = (v: unknown, ok: (x: unknown) => boolean) => v === undefined || (Array.isArray(v) && v.length <= 5 && v.every(ok))
  if (!list(h.lightningAddresses, (a) => typeof a === 'string' && isLightningAddress(a))) return null
  if (typeof h.lightningAddress !== 'string' || (h.lightningAddress && !isLightningAddress(h.lightningAddress))) return null
  if (!list(h.receiveWallets, (w) => typeof w === 'object' && w !== null && target((w as { address: unknown }).address))) return null
  if (
    h.sendWallets !== undefined &&
    !(Array.isArray(h.sendWallets) && h.sendWallets.length <= 10 &&
      h.sendWallets.every((w) => w?.kind === 'nwc' && typeof w.url === 'string' && w.url.startsWith('nostr+walletconnect://') && typeof w.name === 'string'))
  ) return null
  if (h.walletNames !== undefined && !(typeof h.walletNames === 'object' && h.walletNames !== null && Object.values(h.walletNames).every((v) => typeof v === 'string' && v.length <= 80))) return null
  return { handover: h, sessionKey }
}

// ---- The old phone ----

/** Every group on this phone, made shareable so it has a room to move through. */
export async function groupsToMove(): Promise<GroupMeta[]> {
  const out: GroupMeta[] = []
  for (const group of await listGroups()) out.push(group.shared && group.key ? group : await makeShareable(group.id))
  return out
}

/**
 * Hands each group over to the new phone's key and waits until the relay has
 * every hand-over, so the new phone finds them when it loads the groups.
 */
export async function handOver(groups: GroupMeta[], newKey: string): Promise<MovedGroup[]> {
  for (const group of groups) {
    const current = (await getGroup(group.id))!
    await append(current, [{ type: 'member.rekeyed', memberId: current.meId, key: newKey }])
    await syncHub.ensure(group.id)
  }
  const deadline = Date.now() + 30_000
  for (const group of groups) {
    while ((await pendingEvents(group.id)).length > 0) {
      if (Date.now() > deadline) throw new Error(t`Couldn’t reach Waroo to hand over your groups. Check your connection and try again.`)
      await new Promise((r) => setTimeout(r, 300))
    }
  }
  return groups.map((g) => ({
    id: g.id,
    name: g.name,
    currency: g.currency,
    meId: g.meId,
    key: g.key!,
    createdAt: g.createdAt,
    ...(g.pins ? { pins: g.pins } : {}),
  }))
}

export async function lightningAddressesToMove(): Promise<string[]> {
  return myLightningAddresses()
}

export async function receiveWalletsToMove(): Promise<{ address: string; name?: string }[]> {
  return (await receiveWallets()).map(({ address, name }) => ({ address, ...(name ? { name } : {}) }))
}

/**
 * Wallet connections that can move: Nostr Wallet Connect, which is just a
 * secret. A browser wallet belongs to this browser, so it stays.
 */
export async function sendWalletsToMove(): Promise<NewSendWallet[]> {
  return (await sendWallets())
    .filter((w) => w.kind === 'nwc')
    .map(({ id: _id, ...w }) => w as NewSendWallet)
}

/** After a move, this phone shouldn't be able to spend any more: its connections go too. */
export async function forgetMovedWallets(): Promise<void> {
  await saveSendWallets((await sendWallets()).filter((w) => w.kind !== 'nwc'))
}

/** After the new phone has them: this phone can't write to them any more, so they go. */
export async function forgetMoved(groupIds: string[]): Promise<void> {
  for (const id of groupIds) {
    syncHub.drop(id)
    await deleteGroupLocally(id)
  }
}

// ---- The new phone ----

/**
 * Loads each moved group from the relay and stores it with this phone's key.
 * Waits for the hand-over to show up in each group first. Groups already on
 * this phone are left as they are.
 */
export async function receiveGroups(
  groups: MovedGroup[],
  keys: CryptoKeyPair,
  publicKey: string,
  lightningAddresses: string[],
  wallets: NewSendWallet[] = [],
  receive?: { address: string; name?: string }[],
  names?: Record<string, string>,
): Promise<string[]> {
  const moved: string[] = []
  // Wallets only come along to a phone that has none of its own yet. On a
  // phone already in use, a move-in link (perhaps from someone else) only
  // adds groups: it never changes where this person gets paid.
  const fresh = (await listGroups()).length === 0 && (await receiveWallets()).length === 0
  for (const g of groups) {
    if (await getGroup(g.id)) continue
    let loaded: Awaited<ReturnType<typeof fetchGroup>> | undefined
    for (let attempt = 0; attempt < 10; attempt++) {
      const result = await fetchGroup(g.key)
      if (replay(result.received.map((r) => r.event), { pins: g.pins }).members.get(g.meId)?.key === publicKey) {
        loaded = result
        break
      }
      await new Promise((r) => setTimeout(r, 1500))
    }
    if (!loaded) throw new Error(t`“${g.name}” didn’t arrive. Keep both phones open and try again.`)
    await saveJoinedGroup(
      { ...g, signing: keys, publicKey, shared: true, cursor: loaded.cursor },
      loaded.received,
    )
    await syncHub.ensure(g.id)
    // This phone's own box key, so it can be handed future group keys.
    await publishProfile(g.id)
    moved.push(g.id)
  }
  void import('./friends.ts').then((f) => f.publishFriendLinks())
  if (!fresh) return moved
  if (receive?.length) {
    await addReceiveNamed(
      receive.map((r) => r.address),
      Object.fromEntries(receive.flatMap((r) => (r.name ? [[r.address, r.name]] : []))),
    )
  } else if (lightningAddresses.length) await addReceiveNamed(lightningAddresses)
  for (const wallet of wallets) await addSend(wallet)
  if (names && Object.keys(names).length) await setSetting('walletNames', { ...(await walletNames()), ...names })
  return moved
}
