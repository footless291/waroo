import { t } from '@lingui/core/macro'
import { replay } from '@footless/ledger'
import { Header } from '../components/Header.tsx'
import { getEvents } from '../lib/db.ts'
import { useGroups, useLoad } from '../lib/hooks.ts'

/** "New expense" from Activity, with more than one group: which group is it for? */
export function PickGroupScreen() {
  const groups = useGroups()
  const names = useLoad(
    async () =>
      Object.fromEntries(
        await Promise.all((groups ?? []).map(async (g) => [g.id, replay(await getEvents(g.id)).name ?? g.name] as const)),
      ),
    [groups],
  )
  return (
    <main className="screen">
      <Header title={t`New expense`} back="/activity" />
      <p className="lead">{t`Which group is it for?`}</p>
      <ul className="cards">
        {(groups ?? []).map((g) => (
          <li key={g.id}>
            <a className="card-row" href={`#/g/${g.id}/add`}>
              <span className="row-main">
                <strong>{names?.[g.id] ?? g.name}</strong>
              </span>
              <span className="chevron" aria-hidden="true">
                ›
              </span>
            </a>
          </li>
        ))}
      </ul>
    </main>
  )
}
