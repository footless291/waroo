import { t } from '@lingui/core/macro'
import type { ReactNode } from 'react'

export interface Tab {
  /** In-app path, e.g. "/activity". */
  path: string
  label: string
  icon: ReactNode
}

/** The menu along the bottom of the screen. */
export function TabBar({ tabs, current, label }: { tabs: Tab[]; current: string; label: string }) {
  return (
    <nav className="tabbar" aria-label={label}>
      {tabs.map((tab) => (
        <a key={tab.path} href={`#${tab.path}`} aria-current={tab.path === current ? 'page' : undefined}>
          <span className="tabbar-icon" aria-hidden="true">
            {tab.icon}
          </span>
          {tab.label}
        </a>
      ))}
    </nav>
  )
}

const svg = (d: string) => (
  <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
)

export const ICONS = {
  groups: svg('M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M22 19v-1a4 4 0 0 0-3-3.87M16 3.13a3.5 3.5 0 0 1 0 6.75'),
  friends: svg('M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1'),
  activity: svg('M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01'),
  settings: svg('M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1'),
  balances: svg('M12 3v18M5 7h14M5 7l-3 7a3.5 3.5 0 0 0 6 0L5 7M19 7l-3 7a3.5 3.5 0 0 0 6 0l-3-7M8 21h8'),
  expenses: svg('M6 2h12v20l-3-2-3 2-3-2-3 2V2M9 7h6M9 11h6M9 15h4'),
  payments: svg('M7 7h13l-4-4M17 17H4l4 4'),
}

/** The main pages. */
export const mainTabs = (): Tab[] => [
  { path: '/friends', label: t`Friends`, icon: ICONS.friends },
  { path: '/', label: t`Groups`, icon: ICONS.groups },
  { path: '/activity', label: t`Activity`, icon: ICONS.activity },
  { path: '/settings', label: t`Settings`, icon: ICONS.settings },
]

export const groupTabs = (groupId: string): Tab[] => [
  { path: `/g/${groupId}`, label: t`Balances`, icon: ICONS.balances },
  { path: `/g/${groupId}/expenses`, label: t`Expenses`, icon: ICONS.expenses },
  { path: `/g/${groupId}/payments`, label: t`Payments`, icon: ICONS.payments },
]
