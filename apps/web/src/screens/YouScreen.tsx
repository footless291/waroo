import { AppearanceCard } from '../components/AppearanceCard.tsx'
import { Collapsible } from '../components/Collapsible.tsx'
import { Header } from '../components/Header.tsx'
import { NotificationsCard } from '../components/NotificationsCard.tsx'
import { WalletSection } from '../components/WalletSection.tsx'

/**
 * Settings. Every section starts closed; a link can open one, e.g.
 * #/settings?open=wallet from the payment screen.
 */
export function SettingsPage({ params }: { params: URLSearchParams }) {
  const opened = (name: string) => params.get('open') === name
  return (
    <div className="screen with-tabbar">
      <Header inPager title="Settings" />
      <div className="form settings">
        <Collapsible title="Wallet" className="wallet-card-section" defaultOpen={opened('wallet')}>
          <WalletSection />
        </Collapsible>
        <Collapsible title="Notifications" defaultOpen={opened('notifications')}>
          <NotificationsCard />
        </Collapsible>
        <Collapsible title="Appearance" defaultOpen={opened('appearance')}>
          <AppearanceCard />
        </Collapsible>
        <Collapsible title="Moving to a new phone" defaultOpen={opened('move')}>
          <p>
            Move your groups to another phone, so you can keep adding expenses and settling up there. Have both phones
            with you.
          </p>
          <a className="button outline" href="#/move">
            Move to a new phone
          </a>
        </Collapsible>
      </div>
    </div>
  )
}
