import { t } from '@lingui/core/macro'
import { Header } from '../components/Header.tsx'
import { replayGroup } from '../lib/db.ts'
import { groupTitle } from '../lib/title.ts'
import { useGroups, useLoad } from '../lib/hooks.ts'

/** "New expense" from Activity, with more than one group: which group is it for? */
export function PickGroupScreen() {
  const groups = useGroups()
  const names = useLoad(
    async () =>
      Object.fromEntries(
        await Promise.all((groups ?? []).map(async (g) => [g.id, groupTitle(await replayGroup(g.id), g)] as const)),
      ),
    [groups],
  )
  return (
    <main className="screen">
      <Header title={t`New expense`} back="/activity" />
      <p className="lead">{t`Which group or friend is it for?`}</p>
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
