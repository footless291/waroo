import { Trans } from '@lingui/react/macro'
import { plural, t } from '@lingui/core/macro'
import { groupBalances, replay, type GroupState, type LedgerEvent } from '@waroo/ledger'
import { useMemo, useState } from 'react'
import { Header } from '../components/Header.tsx'
import { append, getEvents, listGroups, newId, replayGroup, type Draft, type GroupMeta } from '../lib/db.ts'
import { money } from '../lib/format.ts'
import { friendshipState } from '../lib/friends.ts'
import { go, locale, useLoad } from '../lib/hooks.ts'
import { convert, NotSplitwise, parseSplitwise, type Imported, type SplitwiseExport } from '../lib/splitwise.ts'
import { groupTitle } from '../lib/title.ts'

const NEW = '+new'

interface Destination {
  meta: GroupMeta
  state: GroupState
  title: string
  friend: boolean
}

/** Places this phone can add to: groups and friendships it's still part of. */
async function destinations(): Promise<Destination[]> {
  const out: Destination[] = []
  for (const meta of await listGroups()) {
    const state = await replayGroup(meta.id)
    const me = state.members.get(meta.meId)
    if (!me || me.left || (state.signed && me.key !== meta.publicKey)) continue
    if (meta.friend && friendshipState(state, meta.meId) !== 'connected') continue
    out.push({ meta, state, title: groupTitle(state, meta), friend: !!meta.friend })
  }
  return out
}

/** Settings → Import from Splitwise: a friend's or a group's export, into a friend or a group here. */
export function ImportScreen() {
  const places = useLoad(destinations, [])
  const [data, setData] = useState<SplitwiseExport>()
  const [fileName, setFileName] = useState('')
  const [problem, setProblem] = useState('')
  const [placeId, setPlaceId] = useState('')
  const [who, setWho] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  const place = places?.find((p) => p.meta.id === placeId)
  const members = place ? [...place.state.members.values()].filter((m) => !m.left) : []

  async function pick(file: File | undefined) {
    if (!file) return
    setProblem('')
    try {
      const parsed = parseSplitwise(await file.text())
      setData(parsed)
      setFileName(file.name)
      setWho({})
    } catch (err) {
      setData(undefined)
      setProblem(err instanceof NotSplitwise ? t`That isn’t a Splitwise export. In Splitwise, open the friend or group and choose Export as spreadsheet.` : (err as Error).message)
    }
  }

  function choosePlace(id: string) {
    setPlaceId(id)
    const p = places?.find((x) => x.meta.id === id)
    if (!p || !data) return setWho({})
    // Match by name where it's obvious; leave the rest to pick.
    const guess: Record<string, string> = {}
    const free = [...p.state.members.values()].filter((m) => !m.left)
    for (const person of data.people) {
      const m = free.find((x) => x.name.trim().toLowerCase() === person.trim().toLowerCase() && !Object.values(guess).includes(x.id))
      if (m) guess[person] = m.id
    }
    // A friendship has two people: if one's matched, the other is the other.
    if (p.friend && data.people.length === 2) {
      const [a, b] = data.people as [string, string]
      const other = (id: string) => free.find((m) => m.id !== id)?.id
      if (guess[a] && !guess[b]) guess[b] = other(guess[a])!
      if (guess[b] && !guess[a]) guess[a] = other(guess[b])!
    }
    setWho(guess)
  }

  const mapped = data && data.people.every((p) => who[p])
  const distinct = mapped && new Set(Object.values(who).filter((v) => v !== NEW)).size === Object.values(who).filter((v) => v !== NEW).length

  // The rows, converted with new people given ids, and what's new to this group.
  const preview = useLoad(async () => {
    if (!data || !place || !mapped || !distinct) return undefined
    const ids: Record<string, string> = {}
    const added: Draft[] = []
    for (const person of data.people) {
      if (who[person] === NEW) {
        const id = newId()
        ids[person] = id
        added.push({ type: 'member.added', member: { id, name: person.slice(0, 80) } })
      } else ids[person] = who[person]!
    }
    const all = await convert(data, ids)
    const have = new Set([...place.state.heads.keys(), ...place.state.settlements.keys()])
    const fresh = all.filter((i) => !have.has(i.kind === 'expense' ? i.expense.id : i.settlement.id))
    // What the balances will be afterwards, worked out the way every phone will.
    let clock = place.state.clock
    const fake = (d: Draft) => ({ ...d, id: newId(), author: place.meta.meId, clock: ++clock, at: '2000-01-01T00:00:00Z', signer: place.meta.publicKey }) as LedgerEvent
    const after = replay([...(await getEvents(place.meta.id)), ...added.map(fake), ...fresh.map((i) => fake(draftOf(i)))])
    return { added, fresh, skipped: all.length - fresh.length, after, rejected: after.rejected.length - place.state.rejected.length }
  }, [data, placeId, JSON.stringify(who)])

  async function run() {
    if (!place || !preview) return
    setBusy(true)
    const drafts = [...preview.added, ...preview.fresh.map(draftOf)]
    const dates = [...preview.added.map(() => new Date().toISOString()), ...preview.fresh.map((i) => `${i.row.date}T12:00:00.000Z`)]
    for (let start = 0; start < drafts.length; start += 50) {
      await append(place.meta, drafts.slice(start, start + 50), { at: (i) => dates[start + i]! })
    }
    go(`/g/${place.meta.id}/expenses`)
  }

  const expenses = preview?.fresh.filter((i) => i.kind === 'expense').length ?? 0
  const payments = preview?.fresh.filter((i) => i.kind === 'payment').length ?? 0
  const range = useMemo(() => {
    const dates = data?.rows.map((r) => r.date).sort() ?? []
    if (!dates.length) return ''
    const f = new Intl.DateTimeFormat(locale(), { year: 'numeric', month: 'short' })
    return f.formatRange(new Date(dates[0]!), new Date(dates.at(-1)!))
  }, [data])

  return (
    <main className="screen">
      <Header title={t`Import from Splitwise`} back="/settings" />
      <div className="form">
        <p className="lead">
          <Trans>In Splitwise, open a friend or a group, choose Export as spreadsheet, and pick the file here. Everything stays on this phone until you import it.</Trans>
        </p>
        <label className="button outline file-pick">
          {fileName ? t`Pick a different file` : t`Pick the export file`}
          <input type="file" accept=".csv,text/csv" className="visually-hidden" onChange={(e) => void pick(e.target.files?.[0])} />
        </label>
        {problem && <p className="notice" role="alert">{problem}</p>}

        {data && (
          <>
            <p className="muted">
              {fileName}: {plural(data.rows.length, { one: '# entry', other: '# entries' })}
              {range ? `, ${range}` : ''}
            </p>
            <label className="field">
              <span>{t`Import into`}</span>
              <select value={placeId} onChange={(e) => choosePlace(e.target.value)}>
                <option value="">{t`Choose a friend or group`}</option>
                {places?.map((p) => (
                  <option key={p.meta.id} value={p.meta.id}>
                    {p.friend ? t`Friend: ${p.title}` : p.title}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}

        {data && place && (
          <fieldset className="field">
            <legend>{t`Who’s who`}</legend>
            {data.people.map((person) => (
              <label key={person} className="field who-row">
                <span>{t`${person} in Splitwise is`}</span>
                <select value={who[person] ?? ''} onChange={(e) => setWho({ ...who, [person]: e.target.value })}>
                  <option value="">{t`Choose`}</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.id === place.meta.meId ? t`${m.name} (you)` : m.name}
                    </option>
                  ))}
                  {!place.friend && <option value={NEW}>{t`Add ${person} as someone new`}</option>}
                </select>
              </label>
            ))}
            {mapped && !distinct && <p className="hint">{t`Each person in Splitwise needs to be someone different here.`}</p>}
          </fieldset>
        )}

        {preview && (
          <section className="settings-card import-preview">
            <p>
              <strong>
                {expenses + payments === 0
                  ? t`Everything in this file is here already.`
                  : t`${plural(expenses, { one: '# expense', other: '# expenses' })} and ${plural(payments, { one: '# payment', other: '# payments' })} to import.`}
              </strong>
            </p>
            {preview.skipped > 0 && <p className="muted">{plural(preview.skipped, { one: '# is here already and will be skipped.', other: '# are here already and will be skipped.' })}</p>}
            <BalanceAfter state={preview.after} meId={place!.meta.meId} />
            {preview.rejected > 0 && <p className="notice">{plural(preview.rejected, { one: '# entry won’t fit and will be left out.', other: '# entries won’t fit and will be left out.' })}</p>}
            <p className="hint">{t`Imported entries keep their dates. Nobody gets notified about them.`}</p>
            <button className="button primary" disabled={busy || expenses + payments === 0} onClick={() => void run()}>
              {busy ? t`Importing…` : t`Import`}
            </button>
          </section>
        )}
      </div>
    </main>
  )
}

function BalanceAfter({ state, meId }: { state: GroupState; meId: string }) {
  const lines = [...groupBalances(state)].flatMap(([currency, byPerson]) => {
    const amount = byPerson.get(meId) ?? 0
    return amount ? [{ currency, amount }] : []
  })
  return (
    <p>
      {t`Your balance afterwards:`}{' '}
      {lines.length === 0
        ? t`all square`
        : lines.map(({ currency, amount }, i) => {
            const sum = money(Math.abs(amount), currency)
            return (
              <span key={currency} className={amount > 0 ? 'owed' : 'owes'}>
                {i > 0 ? ', ' : ''}
                {amount > 0 ? t`you get back ${sum}` : t`you owe ${sum}`}
              </span>
            )
          })}
    </p>
  )
}

function draftOf(i: Imported): Draft {
  return i.kind === 'expense' ? { type: 'expense.saved', expense: i.expense } : { type: 'settlement.recorded', settlement: i.settlement }
}
