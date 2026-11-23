import { useMemo } from 'react'
import { AppHeader } from '../components/Header.tsx'
import { PlusIcon } from '../components/icons.tsx'
import { Pager } from '../components/Pager.tsx'
import { MAIN_TABS, TabBar } from '../components/TabBar.tsx'
import { useGroups } from '../lib/hooks.ts'
import { ActivityPage } from './ActivityScreen.tsx'
import { HomePage } from './HomeScreen.tsx'
import { SettingsPage } from './YouScreen.tsx'

/** Groups, Activity and Settings, side by side: swipe or tap between them. */
export function MainTabs({ current, query }: { current: string; query: string }) {
  const groups = useGroups()
  const pages = useMemo(
    () => [
      { path: '/', content: <HomePage /> },
      { path: '/activity', content: <ActivityPage /> },
      // A link like #/settings?open=wallet opens that section.
      { path: '/settings', content: <SettingsPage key={query} params={new URLSearchParams(query)} /> },
    ],
    [query],
  )
  const hasGroups = !!groups && groups.length > 0
  return (
    <main className="tabs-shell">
      <div className="screen shell-top">
        <AppHeader />
      </div>
      <Pager pages={pages} current={current} />
      {current === '/' && hasGroups && (
        <a className="fab" href="#/new">
          <PlusIcon />
          New group
        </a>
      )}
      {current === '/activity' && hasGroups && (
        <a className="fab" href={groups.length === 1 ? `#/g/${groups[0]!.id}/add` : '#/add'}>
          <PlusIcon />
          New expense
        </a>
      )}
      <TabBar tabs={MAIN_TABS} current={current} label="Main" />
    </main>
  )
}
