/**
 * On-device storage: each group's details, keys and full event log, in
 * IndexedDB. Sync reads and writes these same events; nothing here talks to
 * the network.
 */
import { replay, type CurrencyCode, type LedgerEvent, type PersonId } from '@footless/ledger'
import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import { newGroupKey, newSigningKeys, sign } from './crypto.ts'

export interface GroupMeta {
  id: string
  /** Name when created or joined; the log's `group.updated` takes precedence. */
  name: string
  currency: CurrencyCode
  /** Which member this phone is. */
  meId: PersonId
  createdAt: string
  /** The group's encryption key. Absent only for groups made before sharing existed. */
  key?: string
  /** This phone's signing keys for this group. The private key can't be exported. */
  signing?: CryptoKeyPair
  publicKey?: string
  /** True once the group has been shared: then it syncs with the relay. */
  shared?: boolean
  /** Last relay position this phone has received. */
  cursor?: number
}

/** An event payload before the store stamps id, author, clock and time on it. */
export type Draft = LedgerEvent extends infer E
  ? E extends LedgerEvent
    ? Omit<E, 'id' | 'author' | 'clock' | 'at' | 'signer'>
    : never
  : never

export type StoredEvent = LedgerEvent & {
  groupId: string
  /** Signature over the event, for signed groups. */
  sig?: string
  /** 1 while it still has to be sent to the relay. */
  pending?: 1
}

interface FootlessDB extends DBSchema {
  groups: { key: string; value: GroupMeta }
  events: { key: string; value: StoredEvent; indexes: { byGroup: string } }
  /** Things that stay on this phone: the wallet connection, your profile. */
  settings: { key: string; value: unknown }
}

let dbPromise: Promise<IDBPDatabase<FootlessDB>> | undefined

function db() {
  dbPromise ??= openDB<FootlessDB>('footless', 3, {
    upgrade(database, oldVersion) {
      if (oldVersion < 1) {
        database.createObjectStore('groups', { keyPath: 'id' })
        database.createObjectStore('events', { keyPath: 'id' }).createIndex('byGroup', 'groupId')
      }
      // Version 2 only added optional fields; existing records stay valid.
      if (oldVersion < 3) database.createObjectStore('settings')
    },
  })
  return dbPromise
}

// A tiny change feed so screens and sync re-read after any write.
const listeners = new Set<(groupId?: string) => void>()
export function subscribe(listener: (groupId?: string) => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
export const notify = (groupId?: string) => listeners.forEach((l) => l(groupId))

export const newId = () => crypto.randomUUID()

export async function getSetting(key: string): Promise<unknown> {
  return (await db()).get('settings', key)
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  const database = await db()
  if (value === undefined) await database.delete('settings', key)
  else await database.put('settings', value, key)
  notify()
}

/** This person's Lightning address, as they set it on this phone. */
export async function myLightningAddress(): Promise<string> {
  return ((await getSetting('lightningAddress')) as string | undefined) ?? ''
}

/**
 * Saves this person's Lightning address and tells every group they're in, so
 * the others can pay them. Only groups where it differs get an update.
 */
export async function setMyLightningAddress(address: string): Promise<void> {
  const clean = address.trim().toLowerCase()
  await setSetting('lightningAddress', clean || undefined)
  await publishProfile()
}

/** Brings every group up to date with this phone's profile. */
export async function publishProfile(onlyGroupId?: string): Promise<void> {
  const address = await myLightningAddress()
  for (const group of await listGroups()) {
    if (onlyGroupId && group.id !== onlyGroupId) continue
    const me = replay(await getEvents(group.id)).members.get(group.meId)
    if (!me || (me.lightningAddress ?? '') === address) continue
    await append(group, [{ type: 'member.updated', memberId: group.meId, lightningAddress: address }])
  }
}

export async function listGroups(): Promise<GroupMeta[]> {
  const groups = await (await db()).getAll('groups')
  return groups.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export async function getGroup(id: string): Promise<GroupMeta | undefined> {
  return (await db()).get('groups', id)
}

export async function putGroup(group: GroupMeta): Promise<void> {
  await (await db()).put('groups', group)
  notify(group.id)
}

export async function getStoredEvents(groupId: string): Promise<StoredEvent[]> {
  return (await db()).getAllFromIndex('events', 'byGroup', groupId)
}

export async function getEvents(groupId: string): Promise<LedgerEvent[]> {
  return (await getStoredEvents(groupId)).map(strip)
}

function strip({ groupId: _g, sig: _s, pending: _p, ...event }: StoredEvent): LedgerEvent {
  return event as LedgerEvent
}

/**
 * Appends events written by this phone, in order. Clocks continue from the
 * highest clock in the group's log, so they sort after everything seen. In a
 * signed group each event is signed and queued for the relay.
 */
export async function append(group: GroupMeta, drafts: Draft[]): Promise<LedgerEvent[]> {
  const database = await db()
  let clock = replay(await getEvents(group.id)).clock
  const now = new Date().toISOString()
  const stored: StoredEvent[] = []
  for (const draft of drafts) {
    const event = { ...draft, id: newId(), author: group.meId, clock: ++clock, at: now } as LedgerEvent
    stored.push(await stamp(group, event))
  }
  const tx = database.transaction('events', 'readwrite')
  await Promise.all([...stored.map((e) => tx.store.add(e)), tx.done])
  notify(group.id)
  return stored.map(strip)
}

/** Signs an event for a signed group and marks it to be sent. */
async function stamp(group: GroupMeta, event: LedgerEvent): Promise<StoredEvent> {
  if (!group.signing || !group.publicKey) return { ...event, groupId: group.id }
  const signed = { ...event, signer: group.publicKey } as LedgerEvent
  return {
    ...signed,
    groupId: group.id,
    sig: await sign(event, group.signing.privateKey),
    ...(group.shared ? { pending: 1 as const } : {}),
  }
}

/** Saves events received from the relay (already verified). Returns how many were new. */
export async function saveReceived(
  groupId: string,
  received: { event: LedgerEvent; signature: string }[],
): Promise<number> {
  if (received.length === 0) return 0
  const tx = (await db()).transaction('events', 'readwrite')
  let added = 0
  for (const { event, signature } of received) {
    if (await tx.store.get(event.id)) continue
    await tx.store.add({ ...event, groupId, sig: signature })
    added++
  }
  await tx.done
  if (added > 0) notify(groupId)
  return added
}

export async function pendingEvents(groupId: string): Promise<StoredEvent[]> {
  return (await getStoredEvents(groupId)).filter((e) => e.pending)
}

export async function markSent(ids: string[]): Promise<void> {
  const tx = (await db()).transaction('events', 'readwrite')
  for (const id of ids) {
    const e = await tx.store.get(id)
    if (e?.pending) {
      delete e.pending
      await tx.store.put(e)
    }
  }
  await tx.done
}

/** Creates a group with this phone's person as founder, plus any others named. */
export async function createGroup(input: {
  name: string
  currency: CurrencyCode
  myName: string
  otherNames: string[]
}): Promise<GroupMeta> {
  const { keys, publicKey } = await newSigningKeys()
  const group: GroupMeta = {
    id: newId(),
    name: input.name,
    currency: input.currency,
    meId: newId(),
    createdAt: new Date().toISOString(),
    key: newGroupKey(),
    signing: keys,
    publicKey,
    shared: false,
  }
  await (await db()).put('groups', group)
  await append(group, [
    { type: 'member.added', member: { id: group.meId, name: input.myName, key: publicKey } },
    { type: 'group.updated', name: input.name, currency: input.currency },
    ...input.otherNames.map(
      (name): Draft => ({ type: 'member.added', member: { id: newId(), name } }),
    ),
  ])
  await publishProfile(group.id)
  return group
}

/**
 * Gets a group ready to share. Groups made before sharing existed have no
 * keys and unsigned events, all written by this phone: give them keys and
 * sign their history, as if they had been signed all along. Then mark the
 * group shared and queue everything for the relay.
 */
export async function makeShareable(groupId: string): Promise<GroupMeta> {
  const database = await db()
  let group = (await getGroup(groupId))!
  if (group.shared) return group

  if (!group.signing || !group.publicKey || !group.key) {
    const { keys, publicKey } = await newSigningKeys()
    group = { ...group, key: newGroupKey(), signing: keys, publicKey }
    const events = (await getStoredEvents(groupId)).map(strip)
    const rewritten = await Promise.all(
      events.map(async (e) => {
        const withKey =
          e.type === 'member.added' && e.member.id === group.meId
            ? ({ ...e, member: { ...e.member, key: publicKey } } as LedgerEvent)
            : e
        return stamp({ ...group, shared: false }, withKey)
      }),
    )
    const tx = database.transaction('events', 'readwrite')
    await Promise.all([...rewritten.map((e) => tx.store.put(e)), tx.done])
    group = { ...group, shared: false }
    await database.put('groups', group)
    await append(group, [{ type: 'group.updated', name: group.name, currency: group.currency }])
  }

  // Queue the whole history for the relay.
  group = { ...group, shared: true }
  const tx = database.transaction(['groups', 'events'], 'readwrite')
  await tx.objectStore('groups').put(group)
  const events = await tx.objectStore('events').index('byGroup').getAll(groupId)
  for (const e of events) await tx.objectStore('events').put({ ...e, pending: 1 })
  await tx.done
  notify(groupId)
  return group
}

/** Stores a group joined from an invite, with the history fetched from the relay. */
export async function saveJoinedGroup(
  group: GroupMeta,
  received: { event: LedgerEvent; signature: string }[],
): Promise<void> {
  await (await db()).put('groups', group)
  await saveReceived(group.id, received)
}

export async function deleteGroupLocally(groupId: string) {
  const database = await db()
  const tx = database.transaction(['groups', 'events'], 'readwrite')
  const keys = await tx.objectStore('events').index('byGroup').getAllKeys(groupId)
  await Promise.all([
    ...keys.map((k) => tx.objectStore('events').delete(k)),
    tx.objectStore('groups').delete(groupId),
    tx.done,
  ])
  notify()
}
