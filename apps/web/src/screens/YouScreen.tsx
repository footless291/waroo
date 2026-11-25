import { Trans } from '@lingui/react/macro'
import { t } from '@lingui/core/macro'
import { AppearanceCard, LanguageCard } from '../components/AppearanceCard.tsx'
import { Collapsible } from '../components/Collapsible.tsx'
import { FeedbackCard } from '../components/FeedbackCard.tsx'
import { PageTitle } from '../components/Header.tsx'
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
      <PageTitle>{t`Settings`}</PageTitle>
      <div className="form settings">
        <Collapsible title={t`Wallet`} className="wallet-card-section" defaultOpen={opened('wallet')}>
          <WalletSection />
        </Collapsible>
        <Collapsible title={t`Notifications`} defaultOpen={opened('notifications')}>
          <NotificationsCard />
        </Collapsible>
        <Collapsible title={t`Appearance`} defaultOpen={opened('appearance')}>
          <AppearanceCard />
        </Collapsible>
        <Collapsible title={t`Language`} defaultOpen={opened('language')}>
          <LanguageCard />
        </Collapsible>
        <Collapsible title={t`Send feedback`} defaultOpen={opened('feedback')}>
          <FeedbackCard />
        </Collapsible>
        <Collapsible title={t`Moving to a new phone`} defaultOpen={opened('move')}>
          <p>
            <Trans>
              Move your groups to another phone, so you can keep adding expenses and settling up there. Have both phones
              with you.
            </Trans>
          </p>
          <a className="button outline" href="#/move">
            {t`Move to a new phone`}
          </a>
        </Collapsible>
      </div>
    </div>
  )
}
