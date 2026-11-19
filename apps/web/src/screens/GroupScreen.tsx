import { computeShares, groupBalances, suggestTransfers, type GroupState } from '@footless/ledger'
import { useState, type FormEvent } from 'react'
import { Header } from '../components/Header.tsx'
import { append, newId, type GroupMeta } from '../lib/db.ts'
import { formatDate, money } from '../lib/format.ts'
import { useGroup } from '../lib/hooks.ts'

type Tab = 'balances' | 'expenses' | 'people'

export function GroupScreen({ groupId, tab }: { groupId: string; tab: Tab }) {
  const group = useGroup(groupId)
  if (group === undefined) return <main className="screen" />
  if (group === null) {
    return (
      <main className="screen">
        <Header title="Not found" back="/" />
        <p className="empty">This group isn’t on this device.</p>
      </main>
    )
  }
  const { meta, state } = group
  const base = `/g/${groupId}`
  return (
    <main className="screen">
      <Header title={meta.name} back="/" />
      <nav className="tabs" aria-label="Group sections">
        {(['balances', 'expenses', 'people'] as const).map((t) => (
          <a
            key={t}
            href={`#${base}${t === 'balances' ? '' : `/${t}`}`}
            aria-current={tab === t ? 'page' : undefined}
          >
            {t[0]!.toUpperCase() + t.slice(1)}
          </a>
        ))}
      </nav>
      {state.conflicts.length > 0 && (
        <p className="notice">
          {state.conflicts.length === 1 ? 'One expense was' : `${state.conflicts.length} expenses were`} edited
          by two people at once. The latest edit was kept.
        </p>
      )}
      {tab === 'balances' && <Balances meta={meta} state={state} />}
      {tab === 'expenses' && <Expenses meta={meta} state={state} />}
      {tab === 'people' && <People meta={meta} state={state} />}
      {tab !== 'people' && (
        <a className="fab" href={`#${base}/add`}>
          Add expense
        </a>
      )}
    </main>
  )
}

const nameOf = (state: GroupState, id: string, meId?: string) =>
  id === meId ? 'You' : (state.members.get(id)?.name ?? 'Someone')

/** The same name in object position: "Bob pays you", not "Bob pays You". */
const objectName = (state: GroupState, id: string, meId?: string) =>
  id === meId ? 'you' : nameOf(state, id, meId)

function Balances({ meta, state }: { meta: GroupMeta; state: GroupState }) {
  const balances = groupBalances(state)
  const transfers = suggestTransfers(balances)
  if (balances.size === 0) {
    return (
      <section className="empty">
        <h2>{state.expenses.size === 0 ? 'Nothing to split yet' : 'All square'}</h2>
        <p>{state.expenses.size === 0 ? 'Add the first expense to get started.' : 'Nobody owes anybody.'}</p>
      </section>
    )
  }
  return (
    <>
      {[...balances].map(([currency, byPerson]) => (
        <section key={currency} className="card">
          {balances.size > 1 && <h2 className="card-title">{currency}</h2>}
          <ul className="balance-list">
            {[...byPerson]
              .sort((a, b) => b[1] - a[1])
              .map(([person, amount]) => (
                <li key={person}>
                  <span>{nameOf(state, person, meta.meId)}</span>
                  <span className={amount > 0 ? 'owed' : 'owes'}>
                    {person === meta.meId
                      ? amount > 0
                        ? 'get back '
                        : 'owe '
                      : amount > 0
                        ? 'gets back '
                        : 'owes '}
                    {money(Math.abs(amount), currency)}
                  </span>
                </li>
              ))}
          </ul>
        </section>
      ))}
      <section className="card">
        <h2 className="card-title">To settle up</h2>
        <ul className="list plain">
          {transfers.map((t) => {
            const params = new URLSearchParams({
              from: t.from,
              to: t.to,
              amount: String(t.amount),
              currency: t.currency,
            })
            return (
              <li key={`${t.from}-${t.to}-${t.currency}`} className="transfer">
                <span>
                  <strong>{nameOf(state, t.from, meta.meId)}</strong>
                  {t.from === meta.meId ? ' pay ' : ' pays '}
                  <strong>{objectName(state, t.to, meta.meId)}</strong>
                  <span className="amount">{money(t.amount, t.currency)}</span>
                </span>
                <a className="button small" href={`#/g/${meta.id}/settle?${params}`}>
                  Settle
                </a>
              </li>
            )
          })}
        </ul>
      </section>
    </>
  )
}

function Expenses({ meta, state }: { meta: GroupMeta; state: GroupState }) {
  if (state.expenses.size === 0 && state.settlements.size === 0) {
    return (
      <section className="empty">
        <h2>No expenses yet</h2>
        <p>Add what someone paid for, and Footless works out who owes what.</p>
      </section>
    )
  }
  const expenses = [...state.expenses.values()].sort((a, b) => b.date.localeCompare(a.date))
  return (
    <>
      <ul className="list">
        {expenses.map((e) => {
          const payers = Object.keys(e.payers)
          const myShare = computeShares(e).get(meta.meId)
          return (
            <li key={e.id}>
              <a className="row" href={`#/g/${meta.id}/e/${e.id}`}>
                <span className="date">{formatDate(e.date)}</span>
                <span className="row-main">
                  <strong>{e.title}</strong>
                  <span className="muted">
                    {payers.length === 1 ? nameOf(state, payers[0]!, meta.meId) : `${payers.length} people`} paid
                    {myShare ? ` · your share ${money(myShare, e.currency)}` : ''}
                  </span>
                </span>
                <span className="amount">{money(e.total, e.currency)}</span>
              </a>
            </li>
          )
        })}
      </ul>
      {state.settlements.size > 0 && (
        <section className="card">
          <h2 className="card-title">Payments</h2>
          <ul className="list plain">
            {[...state.settlements.values()].map((s) => (
              <li key={s.id} className="transfer">
                <span>
                  {nameOf(state, s.from, meta.meId)} paid {objectName(state, s.to, meta.meId)}
                  <span className="muted"> · {s.method}</span>
                </span>
                <span className="amount">{money(s.amount, s.currency)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  )
}

function People({ meta, state }: { meta: GroupMeta; state: GroupState }) {
  const [name, setName] = useState('')
  async function add(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    await append(meta, [{ type: 'member.added', member: { id: newId(), name: name.trim() } }])
    setName('')
  }
  return (
    <>
      <ul className="list">
        {[...state.members.values()].map((m) => (
          <li key={m.id} className="row static">
            <span className="avatar" aria-hidden="true">{m.name.slice(0, 1).toUpperCase()}</span>
            <span className="row-main">
              <strong>{m.name}</strong>
              {m.id === meta.meId && <span className="muted">You, on this device</span>}
            </span>
          </li>
        ))}
      </ul>
      <form className="inline-form" onSubmit={add}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Add a person" aria-label="Name" />
        <button className="button" disabled={!name.trim()}>
          Add
        </button>
      </form>
      <p className="hint pad">Sharing groups with other devices comes with encrypted sync.</p>
    </>
  )
}
