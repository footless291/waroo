import { useRegisterSW } from 'virtual:pwa-register/react'
import { useRoute } from './lib/hooks.ts'
import { ExpenseScreen } from './screens/ExpenseScreen.tsx'
import { GroupScreen } from './screens/GroupScreen.tsx'
import { HomeScreen } from './screens/HomeScreen.tsx'
import { InviteScreen } from './screens/InviteScreen.tsx'
import { JoinScreen } from './screens/JoinScreen.tsx'
import { NewGroupScreen } from './screens/NewGroupScreen.tsx'
import { SettleScreen } from './screens/SettleScreen.tsx'

function Router() {
  const route = useRoute()
  const [path = '/', query = ''] = route.split('?')
  const parts = path.split('/').filter(Boolean)
  const params = new URLSearchParams(query)

  if (parts.length === 0) return <HomeScreen />
  if (parts[0] === 'new') return <NewGroupScreen />
  if (parts[0] === 'join') return <JoinScreen params={params} />
  if (parts[0] === 'g' && parts[1]) {
    const groupId = parts[1]
    if (parts[2] === 'add') return <ExpenseScreen groupId={groupId} />
    if (parts[2] === 'e' && parts[3]) return <ExpenseScreen groupId={groupId} expenseId={parts[3]} />
    if (parts[2] === 'settle') return <SettleScreen groupId={groupId} params={params} />
    if (parts[2] === 'invite') return <InviteScreen groupId={groupId} />
    const tab = parts[2] === 'expenses' || parts[2] === 'people' ? parts[2] : 'balances'
    return <GroupScreen key={groupId} groupId={groupId} tab={tab} joined={params.get('joined') === '1'} />
  }
  return <HomeScreen />
}

function UpdatePrompt() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW()
  if (!needRefresh) return null
  return (
    <div className="toast" role="status">
      A new version is ready.
      <button className="link" onClick={() => updateServiceWorker(true)}>
        Reload
      </button>
    </div>
  )
}

export function App() {
  return (
    <>
      <Router />
      <UpdatePrompt />
    </>
  )
}
