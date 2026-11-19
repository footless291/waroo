import { replay, type GroupState, type LedgerEvent } from '@footless/ledger'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { getEvents, getGroup, listGroups, subscribe, type GroupMeta } from './db.ts'

/** Re-runs `load` on mount and after every local write. */
function useLoad<T>(load: () => Promise<T>, deps: unknown[]): T | undefined {
  const [value, setValue] = useState<T>()
  const [version, setVersion] = useState(0)
  useEffect(() => subscribe(() => setVersion((v) => v + 1)), [])
  useEffect(() => {
    let live = true
    load().then((v) => live && setValue(v))
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, ...deps])
  return value
}

export function useGroups() {
  return useLoad(listGroups, [])
}

export interface LoadedGroup {
  meta: GroupMeta
  events: LedgerEvent[]
  state: GroupState
}

/** null: no such group on this device. undefined: still loading. */
export function useGroup(id: string): LoadedGroup | null | undefined {
  return useLoad(async () => {
    const meta = await getGroup(id)
    if (!meta) return null
    const events = await getEvents(id)
    return { meta, events, state: replay(events) }
  }, [id])
}

function readHash() {
  return window.location.hash.replace(/^#/, '') || '/'
}

/** Current hash route, e.g. "/g/abc". Hash routing works on any static host. */
export function useRoute(): string {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener('hashchange', cb)
      return () => window.removeEventListener('hashchange', cb)
    },
    readHash,
  )
}

export const go = (path: string) => {
  window.location.hash = path
}

export const locale = () => navigator.language || 'en'
