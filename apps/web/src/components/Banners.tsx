import { t } from '@lingui/core/macro'
import { replay, type LedgerEvent } from '@footless/ledger'
import { useEffect, useRef, useState } from 'react'
import { getEvents, getGroup, onNewEvents } from '../lib/db.ts'
import { go } from '../lib/hooks.ts'
import { describeEvent, type News } from '../lib/news.ts'

interface Banner extends News {
  groupId: string
}

const SHOW_FOR_MS = 7000

/** In the app, banners cover new expenses, payments that involve you, and people coming and going. */
const BANNER_KINDS = new Set(['paid-you', 'you-paid', 'joined', 'left', 'expense'])

/**
 * Banners over any screen. The live region stays mounted so screen readers
 * hear each new one.
 */
export function Banners() {
  const [banners, setBanners] = useState<Banner[]>([])
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())

  function dismiss(id: string) {
    clearTimeout(timers.current.get(id))
    timers.current.delete(id)
    setBanners((list) => list.filter((b) => b.id !== id))
  }

  useEffect(
    () =>
      onNewEvents(async (groupId, events: LedgerEvent[], origin) => {
        const group = await getGroup(groupId)
        if (!group) return
        const state = replay(await getEvents(groupId))
        for (const event of events) {
          const news = describeEvent(event, state, group.meId, state.name ?? group.name, origin === 'local')
          if (!news || !BANNER_KINDS.has(news.kind)) continue
          const banner = { ...news, groupId }
          setBanners((list) => (list.some((b) => b.id === banner.id) ? list : [...list, banner].slice(-3)))
          timers.current.set(banner.id, setTimeout(() => dismiss(banner.id), SHOW_FOR_MS))
          if (banner.kind === 'paid-you') navigator.vibrate?.([30, 60, 30])
        }
      }),
    [],
  )

  return (
    <div className="banners" aria-live="polite">
      {banners.map((b) => (
        <div key={b.id} className={`banner ${b.kind}`}>
          <button
            className="banner-body"
            onClick={() => {
              dismiss(b.id)
              go(b.kind === 'expense' ? `/g/${b.groupId}/expenses` : `/g/${b.groupId}`)
            }}
          >
            <span className="banner-mark" aria-hidden="true">
              {b.kind === 'expense' ? (
                <svg viewBox="0 0 24 24" width="18" height="18">
                  <path
                    d="M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                </svg>
              ) : b.kind === 'paid-you' ? '↓' : b.kind === 'joined' ? '+' : b.kind === 'left' ? '−' : '↑'}
            </span>
            <span className="banner-text">
              <strong>{b.title}</strong>
              <span>{b.detail}</span>
            </span>
          </button>
          <button className="banner-close" aria-label={t`Dismiss`} onClick={() => dismiss(b.id)}>
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  )
}
