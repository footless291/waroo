/**
 * Keeps shared groups in step with the relay while the app is open.
 *
 * Per group: connect, ask for everything after our cursor, verify and store
 * what arrives, then send anything written here that the relay hasn't
 * acknowledged. Live updates stream in while connected. Drops reconnect with
 * backoff, and immediately when the phone comes back online.
 */
import type { LedgerEvent } from '@footless/ledger'
import { roomId, seal, unseal } from './crypto.ts'
import {
  getGroup,
  getSetting,
  listGroups,
  markSent,
  pendingEvents,
  putGroup,
  saveReceived,
  subscribe,
  type GroupMeta,
} from './db.ts'
import { isNotable } from './news.ts'

export type SyncStatus =
  | 'local' // not shared: lives only on this phone
  | 'connecting'
  | 'synced' // connected, nothing waiting
  | 'syncing' // connected, sending or catching up
  | 'offline' // the phone has no connection
  | 'unreachable' // online, but the relay isn't answering

type Item = { seq: number; id: string; data: string }
type RelayMessage =
  | { t: 'items'; items: Item[]; upTo?: number; done?: boolean; live?: boolean }
  | { t: 'ack'; ids: string[] }
  | { t: 'error'; message: string }

/** Where the relay lives: the same site as the app, unless configured otherwise. */
export function relayUrl(room: string): string {
  const base =
    (import.meta.env.VITE_RELAY_URL as string | undefined) ??
    location.origin.replace(/^http/, 'ws')
  return `${base}/relay/rooms/${room}`
}

/** The relay over plain HTTP, for reads that don't need a live connection. */
export function relayHttpUrl(path: string): string {
  const base = (import.meta.env.VITE_RELAY_URL as string | undefined)?.replace(/^ws/, 'http') ?? location.origin
  return `${base}/relay/${path}`
}

/**
 * Called when events arrive that may change the group's key. Set by
 * lib/rekey.ts (kept apart to avoid an import loop).
 */
let keyFollower: (groupId: string) => Promise<void> = async () => {}
export function setKeyFollower(follow: (groupId: string) => Promise<void>) {
  keyFollower = follow
}

/** This phone's push subscription, if notifications are on. Kept in settings. */
export async function pushEndpoint(): Promise<string | undefined> {
  return (await getSetting('pushEndpoint')) as string | undefined
}

/** Decrypts and verifies relay items, dropping anything that doesn't check out. */
export async function openItems(items: Item[], key: string) {
  const out: { event: LedgerEvent; signature: string }[] = []
  for (const item of items) {
    const opened = await unseal(item.data, key)
    if (opened && opened.event.id === item.id) out.push(opened)
  }
  return out
}

class GroupSync {
  status: SyncStatus = 'connecting'
  private ws?: WebSocket
  private retry = 0
  private timer?: ReturnType<typeof setTimeout>
  private caughtUp = false
  private inFlight = new Set<string>()
  private stopped = false
  /** The key this connection's room belongs to; if the group moves on, this connection stops writing. */
  private key?: string

  readonly groupId: string
  private onStatus: () => void

  constructor(groupId: string, onStatus: () => void) {
    this.groupId = groupId
    this.onStatus = onStatus
  }

  async start() {
    this.stopped = false
    await this.connect()
  }

  stop() {
    this.stopped = true
    clearTimeout(this.timer)
    this.ws?.close()
  }

  /** Something was written here: send it now if we can. */
  poke() {
    if (this.ws?.readyState === WebSocket.OPEN && this.caughtUp) void this.flush()
  }

  /** Notifications were turned on or off on this phone. */
  push(message: { t: 'subscribe' | 'unsubscribe'; endpoint: string }) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message))
  }

  /** The phone lost its connection: say so now rather than when the socket notices. */
  offline() {
    this.set('offline')
    this.ws?.close()
  }

  /** Back online: skip the backoff. */
  online() {
    if (!this.ws || this.ws.readyState === WebSocket.CLOSED) {
      clearTimeout(this.timer)
      this.retry = 0
      void this.connect()
    }
  }

  private set(status: SyncStatus) {
    if (this.status !== status) {
      this.status = status
      this.onStatus()
    }
  }

  private async connect() {
    if (this.stopped) return
    const group = await getGroup(this.groupId)
    if (!group?.shared || !group.key) return this.set('local')
    if (!navigator.onLine) return this.set('offline')
    this.set('connecting')
    this.caughtUp = false
    this.inFlight.clear()
    this.key = group.key

    const ws = new WebSocket(relayUrl(await roomId(group.key)))
    this.ws = ws
    ws.onopen = async () => {
      this.retry = 0
      ws.send(JSON.stringify({ t: 'hello', since: group.cursor ?? 0 }))
      // Telling the room on every connect also marks this connection as
      // this phone, so the relay doesn't wake it while it's connected.
      const endpoint = await pushEndpoint()
      if (endpoint && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'subscribe', endpoint }))
    }
    ws.onmessage = (e) => void this.receive(JSON.parse(e.data as string) as RelayMessage)
    ws.onclose = () => {
      if (this.ws !== ws || this.stopped) return
      this.set(navigator.onLine ? 'unreachable' : 'offline')
      const delay = Math.min(30_000, 1000 * 2 ** this.retry++)
      this.timer = setTimeout(() => void this.connect(), delay)
    }
  }

  private queue = Promise.resolve()

  /** Messages are handled one at a time, in order. */
  private receive(msg: RelayMessage) {
    this.queue = this.queue.then(() => this.handle(msg)).catch((err) => console.error('sync', err))
  }

  private async handle(msg: RelayMessage) {
    const group = await getGroup(this.groupId)
    if (!group?.key || group.key !== this.key) return
    if (msg.t === 'items') {
      if (!msg.live && !this.caughtUp) this.set('syncing')
      const opened = await openItems(msg.items, group.key)
      await saveReceived(this.groupId, opened)
      if (opened.some((o) => o.event.type === 'group.rekeyed' || o.event.type === 'member.updated')) {
        await keyFollower(this.groupId)
      }
      const top = Math.max(group.cursor ?? 0, msg.upTo ?? 0, ...msg.items.map((i) => i.seq))
      if (top !== (group.cursor ?? 0)) {
        // Read again: it may have changed meanwhile, or left this phone.
        const latest = await getGroup(this.groupId)
        if (latest && latest.key === this.key) await putGroup({ ...latest, cursor: top })
      }
      if (msg.done) {
        this.caughtUp = true
        await this.flush()
      }
    } else if (msg.t === 'ack') {
      await markSent(msg.ids)
      for (const id of msg.ids) this.inFlight.delete(id)
      if (this.inFlight.size === 0) await this.flush()
    } else if (msg.t === 'error') {
      console.warn('relay:', msg.message)
    }
  }

  /** Sends whatever is still pending, in batches. */
  private async flush() {
    const ws = this.ws
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    const group = await getGroup(this.groupId)
    // Moved to a new key: what's pending belongs in the new room, not this one.
    if (!group?.key || group.key !== this.key) return
    const pending = (await pendingEvents(this.groupId)).filter((e) => !this.inFlight.has(e.id))
    if (pending.length === 0) {
      if (this.inFlight.size === 0) this.set('synced')
      return
    }
    this.set('syncing')
    const batch = pending.slice(0, 100)
    const notify = batch.some(({ groupId: _g, pending: _p, sig: _s, ...event }) => isNotable(event as LedgerEvent))
    const items = await Promise.all(
      batch.map(async ({ groupId: _g, pending: _p, sig, ...event }) => ({
        id: event.id,
        data: await seal(event as LedgerEvent, sig!, group.key!),
      })),
    )
    for (const i of items) this.inFlight.add(i.id)
    ws.send(JSON.stringify({ t: 'push', items, ...(notify ? { notify: true } : {}) }))
  }
}

/**
 * Reads a room the group has moved away from, for a while after moving.
 * Phones that missed the move publish their box key there and are handed
 * the new key there; concurrent moves settle there. Saves what it reads;
 * sends only what it's asked to (a hand-off for a late phone).
 */
class OldRoomWatch {
  private ws?: WebSocket
  private stopped = false
  private timer?: ReturnType<typeof setTimeout>
  private retry = 0
  readonly groupId: string
  readonly key: string

  constructor(groupId: string, key: string) {
    this.groupId = groupId
    this.key = key
  }

  async start() {
    if (this.stopped || !navigator.onLine) return
    const group = await getGroup(this.groupId)
    const since = group?.previousKeys?.find((p) => p.key === this.key)?.cursor ?? 0
    const ws = new WebSocket(relayUrl(await roomId(this.key)))
    this.ws = ws
    ws.onopen = async () => {
      this.retry = 0
      ws.send(JSON.stringify({ t: 'hello', since }))
      // Don't wake this phone for the old room any more.
      const endpoint = await pushEndpoint()
      if (endpoint && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'unsubscribe', endpoint }))
    }
    ws.onmessage = (e) => void this.receive(JSON.parse(e.data as string) as RelayMessage)
    ws.onclose = () => {
      if (this.ws !== ws || this.stopped) return
      this.timer = setTimeout(() => void this.start(), Math.min(60_000, 2000 * 2 ** this.retry++))
    }
  }

  private queue = Promise.resolve()
  private receive(msg: RelayMessage) {
    this.queue = this.queue.then(() => this.handle(msg)).catch((err) => console.error('old room', err))
  }

  private async handle(msg: RelayMessage) {
    if (msg.t !== 'items') return
    const opened = await openItems(msg.items, this.key)
    await saveReceived(this.groupId, opened, { quiet: true })
    const top = Math.max(msg.upTo ?? 0, ...msg.items.map((i) => i.seq))
    const group = await getGroup(this.groupId)
    if (group?.previousKeys) {
      const previousKeys = group.previousKeys.map((p) => (p.key === this.key && top > (p.cursor ?? 0) ? { ...p, cursor: top } : p))
      await putGroup({ ...group, previousKeys })
    }
    if (opened.length > 0) await keyFollower(this.groupId)
  }

  /** Sends one already-signed event into this old room. */
  async send(event: LedgerEvent, signature: string) {
    if (this.ws?.readyState !== WebSocket.OPEN) return false
    this.ws.send(JSON.stringify({ t: 'push', items: [{ id: event.id, data: await seal(event, signature, this.key) }] }))
    return true
  }

  stop() {
    this.stopped = true
    clearTimeout(this.timer)
    this.ws?.close()
  }
}

/** How long a group keeps reading a room it moved away from. */
const WATCH_OLD_ROOMS_MS = 60 * 24 * 60 * 60 * 1000

/** All shared groups' sync, plus a status feed for the screens. */
class SyncHub {
  private groups = new Map<string, GroupSync>()
  private watches = new Map<string, OldRoomWatch[]>()
  private listeners = new Set<() => void>()
  private started = false

  start() {
    if (this.started) return
    this.started = true
    subscribe((groupId) => {
      if (groupId) void this.ensure(groupId).then((g) => g?.poke())
    })
    addEventListener('online', () => this.groups.forEach((g) => g.online()))
    addEventListener('offline', () => this.groups.forEach((g) => g.offline()))
    void listGroups().then((all) => all.filter((g) => g.shared).forEach((g) => void this.ensure(g.id)))
  }

  /** Starts syncing a group if it's shared and not already syncing. */
  async ensure(groupId: string): Promise<GroupSync | undefined> {
    const existing = this.groups.get(groupId)
    if (existing) return existing
    const group: GroupMeta | undefined = await getGroup(groupId)
    if (!group?.shared) return undefined
    if (this.groups.has(groupId)) return this.groups.get(groupId)
    const sync = new GroupSync(groupId, () => this.emit())
    this.groups.set(groupId, sync)
    void sync.start()
    this.watchOldRooms(group)
    void keyFollower(groupId)
    return sync
  }

  private watchOldRooms(group: GroupMeta) {
    for (const w of this.watches.get(group.id) ?? []) w.stop()
    const recent = (group.previousKeys ?? []).filter((p) => Date.now() - Date.parse(p.movedAt) < WATCH_OLD_ROOMS_MS)
    const watches = recent.map((p) => new OldRoomWatch(group.id, p.key))
    this.watches.set(group.id, watches)
    for (const w of watches) void w.start()
  }

  /** The group moved to a new key: reconnect to its new room and watch the old one. */
  async restart(groupId: string) {
    this.groups.get(groupId)?.stop()
    this.groups.delete(groupId)
    await this.ensure(groupId)
  }

  /** Sends a signed event into one of the group's old rooms, if it's being watched. */
  async sendToOldRoom(groupId: string, key: string, event: LedgerEvent, signature: string): Promise<boolean> {
    const watch = this.watches.get(groupId)?.find((w) => w.key === key)
    return watch ? watch.send(event, signature) : false
  }

  /** Tells every connected group about a change to this phone's notifications. */
  push(message: { t: 'subscribe' | 'unsubscribe'; endpoint: string }) {
    this.groups.forEach((g) => g.push(message))
  }

  /** Stops and forgets a group's sync, after it leaves this phone. */
  drop(groupId: string) {
    this.groups.get(groupId)?.stop()
    this.groups.delete(groupId)
    for (const w of this.watches.get(groupId) ?? []) w.stop()
    this.watches.delete(groupId)
    this.emit()
  }

  status(groupId: string): SyncStatus {
    return this.groups.get(groupId)?.status ?? 'local'
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private emit() {
    this.listeners.forEach((l) => l())
  }
}

export const syncHub = new SyncHub()

/**
 * Downloads a group's whole history from the relay without joining it, for
 * the join screen. Resolves once the relay has sent everything.
 */
export async function fetchGroup(key: string): Promise<{
  received: { event: LedgerEvent; signature: string }[]
  cursor: number
}> {
  const ws = new WebSocket(relayUrl(await roomId(key)))
  const items: Item[] = []
  let cursor = 0
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.close()
      reject(new Error('The group took too long to load'))
    }, 20_000)
    ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', since: 0 }))
    ws.onerror = () => {
      clearTimeout(timeout)
      reject(new Error('Couldn’t reach the group'))
    }
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data as string) as RelayMessage
      if (msg.t !== 'items' || msg.live) return
      items.push(...msg.items)
      cursor = Math.max(cursor, msg.upTo ?? 0)
      if (msg.done) {
        clearTimeout(timeout)
        ws.close()
        resolve()
      }
    }
  })
  return { received: await openItems(items, key), cursor }
}
