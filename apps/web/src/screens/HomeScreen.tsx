import { groupBalances, replay } from '@waroo/ledger'
import { t } from '@lingui/core/macro'
import { Trans } from '@lingui/react/macro'
import { useEffect, useState } from 'react'
import { PageTitle } from '../components/Header.tsx'
import { replayGroup, type GroupMeta } from '../lib/db.ts'
import { money } from '../lib/format.ts'
import { groupTitle } from '../lib/title.ts'
import { useGroups, useLoad } from '../lib/hooks.ts'
import { pendingInvites } from '../lib/friends.ts'

/** The group's current name (from its shared log) and this person's position in it. */
function GroupSummary({ group }: { group: GroupMeta }) {
  const [name, setName] = useState(group.name)
  const [lines, setLines] = useState<{ amount: number; currency: string }[]>()
  useEffect(() => {
    replayGroup(group.id).then((state) => {
      setName(groupTitle(state, group))
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

/** The Groups page of the main tabs. */
export function HomePage() {
  // Friendships have their own tab.
  const groups = useGroups()?.filter((g) => !g.friend)
  return (
    <div className="screen with-tabbar">
      <PageTitle>{t`Groups`}</PageTitle>
      <FriendInvites />
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

/** Invites to groups that friends sent privately. */
function FriendInvites() {
  const invites = useLoad(pendingInvites, [])
  const [dismissed, setDismissed] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('waroo-dismissed-invites') ?? '[]') as string[]
    } catch {
      return []
    }
  })
  const shown = invites?.filter((i) => !dismissed.includes(i.eventId)) ?? []
  if (shown.length === 0) return null
  function dismiss(id: string) {
    const next = [...dismissed, id]
    setDismissed(next)
    try {
      localStorage.setItem('waroo-dismissed-invites', JSON.stringify(next))
    } catch {
      // Private browsing: it comes back next time.
    }
  }
  return (
    <ul className="cards friend-invites">
      {shown.map((i) => {
        const from = i.fromName
        const group = i.name
        return (
          <li key={i.eventId} className="invite-card">
            <h2>{t`${from} invited you to ${group}`}</h2>
            <div className="button-row">
              <a className="button primary" href={`#/join?i=${i.secret}`}>
                {t`Open the invite`}
              </a>
              <button className="button outline" onClick={() => dismiss(i.eventId)}>
                {t`Not now`}
              </button>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
