import { groupBalances, replay } from '@footless/ledger'
import { useEffect, useState } from 'react'
import { Header } from '../components/Header.tsx'
import { PlusIcon } from '../components/icons.tsx'
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
      {lines && lines.length === 0 && <span className="muted">All square</span>}
      {lines && lines.length > 0 && (
        <span className="position">
          {lines.map(({ amount, currency }) => (
            <span key={currency} className={amount > 0 ? 'owed' : 'owes'}>
              {amount > 0 ? 'You get back ' : 'You owe '}
              {money(Math.abs(amount), currency)}
            </span>
          ))}
        </span>
      )}
    </span>
  )
}

export function HomeScreen() {
  const groups = useGroups()
  return (
    <main className="screen">
      <Header
        title="Footless"
        action={
          <>
          <a className="icon-button" href="#/scan" aria-label="Scan a code">
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" />
              <path d="M8 12h8" />
            </svg>
          </a>
          <a className="icon-button" href="#/you" aria-label="You: payment settings">
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="8" r="4" />
              <path d="M4 21a8 8 0 0 1 16 0" />
            </svg>
          </a>
          </>
        }
      />
      {groups && groups.length === 0 && (
        <section className="empty">
          <h2>Split anything with anyone</h2>
          <p>
            Start a group for a trip, a flat or a dinner, then invite the others from their own phones.
          </p>
          <div className="empty-actions">
            <a className="button primary" href="#/new">
              Start a group
            </a>
            <a className="button outline" href="#/scan">
              Join with a QR code
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
          <a className="fab" href="#/new">
            <PlusIcon />
            New group
          </a>
        </>
      )}
    </main>
  )
}
