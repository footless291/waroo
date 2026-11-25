import { locale } from '../lib/hooks.ts'
import { t } from '@lingui/core/macro'
import type { GroupState } from '@footless/ledger'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { syncHub, type SyncStatus } from '../lib/sync.ts'

function useSyncStatus(groupId: string): SyncStatus {
  return useSyncExternalStore(
    (cb) => syncHub.subscribe(cb),
    () => syncHub.status(groupId),
  )
}

/** "Ana and you", "Ana, Bob and you". */
function whoIsHere(state: GroupState, meId: string): string {
  const others = [...state.members.values()].filter((m) => m.key && !m.left && m.id !== meId).map((m) => m.name)
  if (others.length === 0) return t`only you so far`
  const names = new Intl.ListFormat(locale(), { style: 'narrow', type: 'unit' }).format(others)
  return t`${names} and you are here`
}

/** One quiet line under the group title. Never alarming: offline is normal. */
export function SyncLine({ groupId, state, meId }: { groupId: string; state: GroupState; meId: string }) {
  const status = useSyncStatus(groupId)
  // "Syncing" usually lasts a moment; only show it if it lingers.
  const [lingering, setLingering] = useState(false)
  useEffect(() => {
    setLingering(false)
    if (status !== 'syncing' && status !== 'connecting') return
    const t = setTimeout(() => setLingering(true), 700)
    return () => clearTimeout(t)
  }, [status])

  let icon: 'lock' | 'dot' | 'sync' | 'off' | 'clock' = 'dot'
  let text: string
  if (status === 'local') {
    icon = 'lock'
    text = t`Only on this phone so far`
  } else if (status === 'offline') {
    icon = 'off'
    text = t`Offline · changes will sync later`
  } else if (status === 'unreachable') {
    icon = 'clock'
    text = t`Can’t reach the group · retrying`
  } else if ((status === 'syncing' || status === 'connecting') && lingering) {
    icon = 'sync'
    text = t`Syncing…`
  } else {
    const who = whoIsHere(state, meId)
    text = t`Up to date · ${who}`
  }

  return (
    <p className="sync-line" role="status">
      {icon === 'dot' ? (
        <span className="sync-dot" aria-hidden="true" />
      ) : (
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          {icon === 'lock' && (
            <>
              <rect x="5" y="11" width="14" height="10" rx="2" />
              <path d="M8 11V7a4 4 0 0 1 8 0v4" />
            </>
          )}
          {icon === 'sync' && <path d="M21 12a9 9 0 0 1-15.5 6.2M3 12A9 9 0 0 1 18.5 5.8M18 2v4h-4M6 22v-4h4" />}
          {icon === 'off' && (
            <path d="M2 2l20 20M8.5 8.6A6 6 0 0 0 6 13H5a4 4 0 0 0 0 8h12M18.4 18.4A4 4 0 0 0 19 13h-1a6 6 0 0 0-7.5-5.8" />
          )}
          {icon === 'clock' && (
            <>
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v5l3 2" />
            </>
          )}
        </svg>
      )}
      {text}
    </p>
  )
}
