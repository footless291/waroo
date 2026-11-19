/**
 * On-device storage: each group's metadata and its full event log, in
 * IndexedDB. For now nothing leaves the device; the encrypted relay sync will
 * read and write these same events.
 */
import { replay, type CurrencyCode, type LedgerEvent, type PersonId } from '@footless/ledger'
import { openDB, type DBSchema, type IDBPDatabase } from 'idb'

export interface GroupMeta {
  id: string
  name: string
  /** Default currency for new expenses. */
  currency: CurrencyCode
  /** Which member this device is. */
  meId: PersonId
  createdAt: string
}

/** An event payload before the store stamps id, author, clock and time on it. */
export type Draft = LedgerEvent extends infer E
  ? E extends LedgerEvent
    ? Omit<E, 'id' | 'author' | 'clock' | 'at'>
    : never
  : never

type StoredEvent = LedgerEvent & { groupId: string }

interface FootlessDB extends DBSchema {
  groups: { key: string; value: GroupMeta }
  events: { key: string; value: StoredEvent; indexes: { byGroup: string } }
}

let dbPromise: Promise<IDBPDatabase<FootlessDB>> | undefined

function db() {
  dbPromise ??= openDB<FootlessDB>('footless', 1, {
    upgrade(database) {
      database.createObjectStore('groups', { keyPath: 'id' })
      database.createObjectStore('events', { keyPath: 'id' }).createIndex('byGroup', 'groupId')
    },
  })
  return dbPromise
}

// A tiny change feed so screens re-read after any write.
const listeners = new Set<() => void>()
export function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
const notify = () => listeners.forEach((l) => l())

export const newId = () => crypto.randomUUID()

export async function listGroups(): Promise<GroupMeta[]> {
  const groups = await (await db()).getAll('groups')
  return groups.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export async function getGroup(id: string): Promise<GroupMeta | undefined> {
  return (await db()).get('groups', id)
}

export async function getEvents(groupId: string): Promise<LedgerEvent[]> {
  const stored = await (await db()).getAllFromIndex('events', 'byGroup', groupId)
  return stored.map(({ groupId: _, ...event }) => event as LedgerEvent)
}

/**
 * Appends events written by this device, in order. Clocks continue from the
 * highest clock in the group's log, so they sort after everything seen.
 */
export async function append(group: GroupMeta, drafts: Draft[]): Promise<LedgerEvent[]> {
  const database = await db()
  let clock = replay(await getEvents(group.id)).clock
  const now = new Date().toISOString()
  const events = drafts.map(
    (draft) => ({ ...draft, id: newId(), author: group.meId, clock: ++clock, at: now }) as LedgerEvent,
  )
  const tx = database.transaction('events', 'readwrite')
  await Promise.all([...events.map((e) => tx.store.add({ ...e, groupId: group.id })), tx.done])
  notify()
  return events
}

/** Creates a group with this device's person as founder, plus any others named. */
export async function createGroup(input: {
  name: string
  currency: CurrencyCode
  myName: string
  otherNames: string[]
}): Promise<GroupMeta> {
  const group: GroupMeta = {
    id: newId(),
    name: input.name,
    currency: input.currency,
    meId: newId(),
    createdAt: new Date().toISOString(),
  }
  await (await db()).put('groups', group)
  await append(group, [
    { type: 'member.added', member: { id: group.meId, name: input.myName } },
    ...input.otherNames.map(
      (name): Draft => ({ type: 'member.added', member: { id: newId(), name } }),
    ),
  ])
  return group
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
