import { useRef, type TouchEvent } from 'react'
import { go } from './hooks.ts'
import type { Tab } from '../components/TabBar.tsx'

/**
 * Swiping left or right moves to the next or previous tab. Ignored near the
 * screen's edges (the phone's own back gesture lives there), on things that
 * take their own drags (fields, switches, wallet cards), and for anything
 * more up-and-down than sideways.
 */
export function useSwipeTabs(tabs: Tab[], current: string) {
  const start = useRef<{ x: number; y: number; at: number } | null>(null)
  const index = tabs.findIndex((t) => t.path === current)
  return {
    onTouchStart(e: TouchEvent) {
      const touch = e.touches[0]
      const target = e.target as HTMLElement
      const edge = 28
      if (
        !touch ||
        e.touches.length > 1 ||
        touch.clientX < edge ||
        touch.clientX > window.innerWidth - edge ||
        target.closest('input, textarea, select, .segmented, .ranked-row, .qr-box, [data-no-swipe]')
      ) {
        start.current = null
        return
      }
      start.current = { x: touch.clientX, y: touch.clientY, at: Date.now() }
    },
    onTouchEnd(e: TouchEvent) {
      const s = start.current
      start.current = null
      const touch = e.changedTouches[0]
      if (!s || !touch || index === -1) return
      const dx = touch.clientX - s.x
      const dy = touch.clientY - s.y
      if (Date.now() - s.at > 700 || Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 2) return
      const next = tabs[index + (dx < 0 ? 1 : -1)]
      if (next) go(next.path)
    },
  }
}
