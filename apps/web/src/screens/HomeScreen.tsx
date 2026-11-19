import { groupBalances, replay } from '@footless/ledger'
import { useEffect, useState } from 'react'
import { Header } from '../components/Header.tsx'
import { getEvents, type GroupMeta } from '../lib/db.ts'
import { money } from '../lib/format.ts'
import { useGroups } from '../lib/hooks.ts'

function MyPosition({ group }: { group: GroupMeta }) {
  const [lines, setLines] = useState<{ amount: number; currency: string }[]>()
  useEffect(() => {
    getEvents(group.id).then((events) => {
      const balances = groupBalances(replay(events))
      setLines(
        [...balances].flatMap(([currency, byPerson]) => {
          const amount = byPerson.get(group.meId)
          return amount ? [{ amount, currency }] : []
        }),
      )
    })
  }, [group])
  if (!lines) return null
  if (lines.length === 0) return <span className="muted">All square</span>
  return (
    <span className="position">
      {lines.map(({ amount, currency }) => (
        <span key={currency} className={amount > 0 ? 'owed' : 'owes'}>
          {amount > 0 ? 'You’re owed ' : 'You owe '}
          {money(Math.abs(amount), currency)}
        </span>
      ))}
    </span>
  )
}

export function HomeScreen() {
  const groups = useGroups()
  return (
    <main className="screen">
      <Header title="Footless" />
      {groups && groups.length === 0 && (
        <section className="empty">
          <h2>Split anything with anyone</h2>
          <p>
            Start a group for a trip, a flat or a dinner. Everything stays on this device for now.
          </p>
          <a className="button primary" href="#/new">
            Start a group
          </a>
        </section>
      )}
      {groups && groups.length > 0 && (
        <>
          <ul className="list">
            {groups.map((g) => (
              <li key={g.id}>
                <a className="row" href={`#/g/${g.id}`}>
                  <span className="row-main">
                    <strong>{g.name}</strong>
                    <MyPosition group={g} />
                  </span>
                  <span className="chevron" aria-hidden="true">›</span>
                </a>
              </li>
            ))}
          </ul>
          <a className="fab" href="#/new">
            New group
          </a>
        </>
      )}
    </main>
  )
}
