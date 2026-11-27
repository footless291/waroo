import { t } from '@lingui/core/macro'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { Banners } from './components/Banners.tsx'
import { go, useRoute } from './lib/hooks.ts'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'
import { ExpenseScreen } from './screens/ExpenseScreen.tsx'
import { GroupScreen } from './screens/GroupScreen.tsx'
import { InviteScreen } from './screens/InviteScreen.tsx'
import { MainTabs } from './screens/MainTabs.tsx'
import { JoinScreen } from './screens/JoinScreen.tsx'
import { MemberScreen } from './screens/MemberScreen.tsx'
import { MoveInScreen } from './screens/MoveInScreen.tsx'
import { MoveScreen } from './screens/MoveScreen.tsx'
import { NewGroupScreen } from './screens/NewGroupScreen.tsx'
import { GroupSettingsScreen } from './screens/GroupSettingsScreen.tsx'
import { PersonScreen } from './screens/PersonScreen.tsx'
import { RecoverScreen } from './screens/RecoverScreen.tsx'
import { PickGroupScreen } from './screens/PickGroupScreen.tsx'
import { ScanScreen } from './screens/ScanScreen.tsx'
import { SettleScreen } from './screens/SettleScreen.tsx'

function Router() {
  const route = useRoute()
  const [path = '/', query = ''] = route.split('?')
  const parts = path.split('/').filter(Boolean)
  const params = new URLSearchParams(query)

  // The main tabs are one screen, so swiping between them keeps each page alive.
  if (parts.length === 0) return <MainTabs current="/" query={query} />
  if (parts[0] === 'new') return <NewGroupScreen />
  if (parts[0] === 'join') return <JoinScreen params={params} />
  if (parts[0] === 'you' || parts[0] === 'settings') return <MainTabs current="/settings" query={query} />
  if (parts[0] === 'activity') return <MainTabs current="/activity" query={query} />
  if (parts[0] === 'add') return <PickGroupScreen />
  if (parts[0] === 'scan') return <ScanScreen />
  if (parts[0] === 'move') return <MoveScreen />
  if (parts[0] === 'move-in') return <MoveInScreen params={params} />
  if (parts[0] === 'g' && parts[1]) {
    const groupId = parts[1]
    if (parts[2] === 'add') return <ExpenseScreen groupId={groupId} />
    if (parts[2] === 'e' && parts[3]) return <ExpenseScreen groupId={groupId} expenseId={parts[3]} />
    if (parts[2] === 'settle') return <SettleScreen groupId={groupId} params={params} />
    if (parts[2] === 'invite') return <InviteScreen groupId={groupId} />
    if (parts[2] === 'pay') return <SettleScreen groupId={groupId} params={params} />
    if (parts[2] === 'me') return <MemberScreen groupId={groupId} />
    if (parts[2] === 'edit') return <GroupSettingsScreen groupId={groupId} />
    if (parts[2] === 'm' && parts[3] && parts[4] === 'recover') return <RecoverScreen groupId={groupId} memberId={parts[3]} />
    if (parts[2] === 'm' && parts[3]) return <PersonScreen groupId={groupId} memberId={parts[3]} />
    const tab = parts[2] === 'expenses' || parts[2] === 'payments' ? parts[2] : 'balances'
    return <GroupScreen key={groupId} groupId={groupId} tab={tab} joined={params.get('joined') === '1'} />
  }
  return <MainTabs current="/" query={query} />
}

function UpdatePrompt() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW()
  if (!needRefresh) return null
  return (
    <div className="toast" role="status">
      {t`A new version is ready.`}
      <button className="link" onClick={() => updateServiceWorker(true)}>
        {t`Reload`}
      </button>
    </div>
  )
}

// Tapping a notification while the app is open: the service worker asks us to go there.
navigator.serviceWorker?.addEventListener('message', (event) => {
  const data = event.data as { type?: string; route?: string } | null
  if (data?.type === 'open' && typeof data.route === 'string' && data.route.startsWith('/')) go(data.route)
})

export function App() {
  const route = useRoute()
  return (
    <>
      <ErrorBoundary key={route.split('?')[0]!.split('/').slice(0, 3).join('/').replace(/^\/(activity|settings)$/, '/')}>
        <Router />
      </ErrorBoundary>
      <ErrorBoundary>
        <Banners />
      </ErrorBoundary>
      <UpdatePrompt />
    </>
  )
}
