import { groupBalances, replay } from '@footless/ledger'
import { t } from '@lingui/core/macro'
import { Trans } from '@lingui/react/macro'
import { useEffect, useState } from 'react'
import { PageTitle } from '../components/Header.tsx'
import { getEvents, type GroupMeta } from '../lib/db.ts'
import { money } from '../lib/format.ts'
import { useGroups } from '../lib/hooks.ts'

/** The group's current name (from its shared log) and this person's position in it. */
function GroupSummary({ group }: { group: GroupMeta }) {
  const [name, setName] = useState(group.name)
  const [lines, setLines] = useState<{ amount: number; currency: string }[]>()
  useEffect(() => {
    getEvents(group.id).then((events) => {
      const state = replay(events)
      setName(state.name ?? group.name)
      const balances = groupBalances(state)
      setLines(
        [...balances].flatMap(([currency, byPerson]) => {
          const amount = byPerson.get(group.meId)
          return amount ? [{ amount, currency }] : []
        }),
      )
    })
  }, [group])
  return (
    <span className="row-main">
      <strong>{name}</strong>
      {lines && lines.length === 0 && <span className="muted">{t`All square`}</span>}
      {lines && lines.length > 0 && (
        <span className="position">
          {lines.map(({ amount, currency }) => (
            <span key={currency} className={amount > 0 ? 'owed' : 'owes'}>
              {amount > 0 ? t`You get back ${money(amount, currency)}` : t`You owe ${money(-amount, currency)}`}
            </span>
          ))}
        </span>
      )}
    </span>
  )
}

/** The app's first address, before it was called Waroo. */
const OLD_ADDRESS = location.hostname.endsWith('.workers.dev')

/** The Groups page of the main tabs. */
export function HomePage() {
  const groups = useGroups()
  return (
    <div className="screen with-tabbar">
      <PageTitle>{t`Groups`}</PageTitle>
      {OLD_ADDRESS && groups && groups.length > 0 && (
        <section className="notice-card new-address">
          <h2>{t`Waroo has a new address`}</h2>
          <p>
            {t`Footless is now Waroo, at getwaroo.app. This app keeps working, but new features arrive there. To move your groups: open getwaroo.app and add it to your Home Screen, then here, go to Settings → Moving to a new phone, and copy the link into the new app’s scanner.`}
          </p>
          <a className="button primary" href="https://getwaroo.app/" target="_blank" rel="noopener noreferrer">
            {t`Open getwaroo.app`}
          </a>
        </section>
      )}
      {groups && groups.length === 0 && (
        <section className="empty">
          <h2>{t`Split anything with anyone`}</h2>
          <p>
            <Trans>Start a group for a trip, a flat or a dinner, then invite the others from their own phones.</Trans>
          </p>
          <div className="empty-actions">
            <a className="button primary" href="#/new">
              {t`Start a group`}
            </a>
            <a className="button outline" href="#/scan">
              {t`Join with a QR code`}
            </a>
          </div>
        </section>
      )}
      {groups && groups.length > 0 && (
        <>
          <ul className="cards">
            {groups.map((g) => (
              <li key={g.id}>
                <a className="card-row" href={`#/g/${g.id}`}>
                  <GroupSummary group={g} />
                  <span className="chevron" aria-hidden="true">›</span>
                </a>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
