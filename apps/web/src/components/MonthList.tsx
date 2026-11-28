import { plural } from '@lingui/core/macro'
import { locale } from '../lib/hooks.ts'

/** How many rows a long list shows at first, and adds each time. */
export const PAGE = 30

/** "November 2026": the heading over a month of expenses or payments. */
export function monthLabel(key: string) {
  return new Intl.DateTimeFormat(locale(), { month: 'long', year: 'numeric' }).format(new Date(`${key}-01T00:00:00`))
}

/** Items (already newest first) in sections by month: [YYYY-MM, items][]. Undated items go last. */
export function byMonth<T>(items: T[], dateOf: (item: T) => string): [string, T[]][] {
  const out: [string, T[]][] = []
  for (const item of items) {
    const key = dateOf(item).slice(0, 7)
    const last = out.at(-1)
    if (last && last[0] === key) last[1].push(item)
    else out.push([key, [item]])
  }
  return out
}

export function ShowMore({ shown, total, onMore }: { shown: number; total: number; onMore: () => void }) {
  if (shown >= total) return null
  const left = total - shown
  return (
    <button className="button outline show-more" onClick={onMore}>
      {plural(left, { one: 'Show # more', other: 'Show more (# left)' })}
    </button>
  )
}

/** An ISO time as this phone's local date, YYYY-MM-DD; '' if there's none. */
export function localDay(iso: string | undefined): string {
  const d = new Date(iso ?? '')
  if (!iso || Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
