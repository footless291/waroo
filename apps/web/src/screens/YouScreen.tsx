import { AppearanceCard } from '../components/AppearanceCard.tsx'
import { Header } from '../components/Header.tsx'
import { NotificationsCard } from '../components/NotificationsCard.tsx'
import { WalletSection } from '../components/WalletSection.tsx'

export function YouScreen() {
  return (
    <main className="screen">
      <Header title="You" back="/" />
      <div className="form">
        <WalletSection />

        <NotificationsCard />

        <AppearanceCard />

        <section className="settings-card">
          <h2>Moving to a new phone</h2>
          <p>
            Move your groups to another phone, so you can keep adding expenses and settling up there. Have both phones
            with you.
          </p>
          <a className="button outline" href="#/move">
            Move to a new phone
          </a>
        </section>
      </div>
    </main>
  )
}
