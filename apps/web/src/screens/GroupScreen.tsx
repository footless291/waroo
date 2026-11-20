import {
  computeShares,
  groupBalances,
  suggestTransfers,
  type GroupState,
  type Transfer,
} from '@footless/ledger'
import { useEffect, useState } from 'react'
import { Avatar } from '../components/Avatar.tsx'
import { NotificationsNudge } from '../components/NotificationsCard.tsx'
import { Header } from '../components/Header.tsx'
import { PlusIcon } from '../components/icons.tsx'
import { SyncLine } from '../components/SyncLine.tsx'
import type { GroupMeta } from '../lib/db.ts'
import { formatDate, money } from '../lib/format.ts'
import { useGroup } from '../lib/hooks.ts'

export type Tab = 'balances' | 'expenses' | 'payments'

export function GroupScreen({ groupId, tab, joined }: { groupId: string; tab: Tab; joined?: boolean }) {
  const group = useGroup(groupId)
  const [toast, setToast] = useState(joined)
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(false), 5000)
    return () => clearTimeout(t)
  }, [toast])
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
  const name = state.name ?? meta.name
  const current = [...state.members.values()].filter((m) => !m.left)
  const notJoined = current.filter((m) => !m.key && m.id !== meta.meId)
  const alone = current.every((m) => m.id === meta.meId || !m.key)
  return (
    <main className="screen">
      <Header
        title={name}
        back="/"
        action={
          <a className="button small" href={`#${base}/invite`}>
            Invite
          </a>
        }
      />
      <SyncLine groupId={groupId} state={state} meId={meta.meId} />
      {alone && tab === 'balances' && (
        <section className="invite-card">
          <h2>
            {notJoined.length > 0
              ? `${listNames(notJoined.map((m) => m.name))} can’t see this yet`
              : 'Splitting with friends?'}
          </h2>
          <p>Invite them, and everyone can add expenses and settle up from their own phone.</p>
          <a className="button primary" href={`#${base}/invite`}>
            Invite people
          </a>
        </section>
      )}
      <nav className="tabs" aria-label="Group sections">
        {(['balances', 'expenses', 'payments'] as const).map((t) => (
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
      {!alone && tab === 'balances' && <NotificationsNudge />}
      {tab === 'balances' && <Balances meta={meta} state={state} />}
      {tab === 'expenses' && <Expenses meta={meta} state={state} />}
      {tab === 'payments' && <Payments meta={meta} state={state} />}
      {toast && (
        <div className="toast" role="status">
          You joined {name} as {state.members.get(meta.meId)?.name}
        </div>
      )}
      {tab === 'payments' ? (
        <a className="fab" href={`#${base}/pay`}>
          <PlusIcon />
          Add payment
        </a>
      ) : (
        <a className="fab" href={`#${base}/add`}>
          <PlusIcon />
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

/** "Bob", "Bob and Cai", "Bob, Cai and Dee". */
const listNames = (names: string[]) =>
  names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`

const settleHref = (groupId: string, t: Transfer) =>
  `#/g/${groupId}/settle?${new URLSearchParams({
    from: t.from,
    to: t.to,
    amount: String(t.amount),
    currency: t.currency,
  })}`

function Balances({ meta, state }: { meta: GroupMeta; state: GroupState }) {
  const balances = groupBalances(state)
  const transfers = suggestTransfers(balances)
  if (balances.size === 0) {
    return (
      <>
        <section className="empty compact">
          <h2>{state.expenses.size === 0 ? 'Nothing to split yet' : 'All square'}</h2>
          <p>{state.expenses.size === 0 ? 'Add the first expense to get started.' : 'Nobody owes anybody.'}</p>
        </section>
        <Everyone meta={meta} state={state} />
      </>
    )
  }

  // The hero shows this person's own position, in the group's main currency
  // when they have one there, else the first currency they're in.
  const currencies = [...balances.keys()].sort((a, b) =>
    a === meta.currency ? -1 : b === meta.currency ? 1 : a.localeCompare(b),
  )
  const heroCurrency = currencies.find((c) => balances.get(c)?.get(meta.meId)) ?? currencies[0]!
  const mine = balances.get(heroCurrency)?.get(meta.meId) ?? 0
  const myPayments = transfers.filter((t) => t.from === meta.meId && t.currency === heroCurrency)
  const myIncoming = transfers.filter((t) => t.to === meta.meId && t.currency === heroCurrency)
  const heroTransfer = myPayments.length === 1 ? myPayments[0] : undefined
  const others = transfers.filter((t) => t !== heroTransfer)

  return (
    <>
      <section className="hero" aria-label="Your balance">
        {mine === 0 ? (
          <p className="hero-amount" style={{ fontSize: '2rem' }}>
            You’re all square
          </p>
        ) : (
          <>
            <div className="avatar-stack">
              <Avatar state={state} id={meta.meId} />
              {(mine < 0 ? myPayments.map((t) => t.to) : myIncoming.map((t) => t.from))
                .slice(0, 3)
                .map((id) => (
                  <Avatar key={id} state={state} id={id} />
                ))}
            </div>
            <p className="hero-label">
              {mine < 0
                ? heroTransfer
                  ? `You owe ${nameOf(state, heroTransfer.to)}`
                  : 'You owe'
                : myIncoming.length > 0
                  ? `You get back from ${listNames(myIncoming.map((t) => nameOf(state, t.from)))}`
                  : 'You get back'}
            </p>
            <p className="hero-amount">{money(Math.abs(mine), heroCurrency)}</p>
            {heroTransfer && (
              <a className="button primary" href={settleHref(meta.id, heroTransfer)}>
                Settle up
              </a>
            )}
          </>
        )}
      </section>

      {currencies.map((currency) => (
        <Everyone
          key={currency}
          meta={meta}
          state={state}
          currency={currency}
          amounts={balances.get(currency)}
          title={currencies.length > 1 ? `Everyone, in ${currency}` : 'Everyone'}
        />
      ))}

      {others.length > 0 && (
        <section className="section">
          <h2 className="section-title">Settle up</h2>
          <ul className="cards">
            {others.map((t) => (
              <li key={`${t.from}-${t.to}-${t.currency}`} className="card-row">
                <span className="row-main">
                  <span>
                    <strong>{nameOf(state, t.from, meta.meId)}</strong>
                    {t.from === meta.meId ? ' pay ' : ' pays '}
                    <strong>{objectName(state, t.to, meta.meId)}</strong>
                  </span>
                  <span className="amount">{money(t.amount, t.currency)}</span>
                </span>
                <a className="button small outline" href={settleHref(meta.id, t)}>
                  Settle
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  )
}

/** The people in the group and where each stands. Your own row leads to your name and leaving. */
function Everyone({
  meta,
  state,
  currency,
  amounts,
  title = 'Everyone',
}: {
  meta: GroupMeta
  state: GroupState
  currency?: string
  amounts?: Map<string, number>
  title?: string
}) {
  return (
    <section className="section">
      <h2 className="section-title">{title}</h2>
      <ul className="people">
        {[...state.members.values()]
          .filter((m) => !m.left)
          .map(({ id: person }) => {
            const amount = amounts?.get(person) ?? 0
            const me = person === meta.meId
            return (
              <li key={person}>
                <Avatar state={state} id={person} />
                <span className="name">{nameOf(state, person, meta.meId)}</span>
                {amount === 0 || !currency ? (
                  <span className="muted">all square</span>
                ) : (
                  <span className={`amount ${amount > 0 ? 'owed' : 'owes'}`}>
                    {amount > 0 ? (me ? 'get back ' : 'gets back ') : me ? 'owe ' : 'owes '}
                    {money(Math.abs(amount), currency)}
                  </span>
                )}
                {me && (
                  <a className="button small outline" href={`#/g/${meta.id}/me`} aria-label="Change your name, or leave the group">
                    Edit
                  </a>
                )}
              </li>
            )
          })}
      </ul>
    </section>
  )
}

function Expenses({ meta, state }: { meta: GroupMeta; state: GroupState }) {
  if (state.expenses.size === 0) {
    return (
      <section className="empty">
        <h2>No expenses yet</h2>
        <p>Add what someone paid for, and Footless works out who owes what.</p>
      </section>
    )
  }
  // Newest first: by date, and among the same date, the last added first.
  const expenses = [...state.expenses.values()].reverse().sort((a, b) => b.date.localeCompare(a.date))
  return (
    <ul className="cards section">
      {expenses.map((e) => {
        const payers = Object.keys(e.payers)
        const myShare = computeShares(e).get(meta.meId)
        return (
          <li key={e.id}>
            <a className="card-row" href={`#/g/${meta.id}/e/${e.id}`}>
              <span className="row-main">
                <strong>{e.title}</strong>
                <span className="muted">
                  {formatDate(e.date)}, {payers.length === 1 ? nameOf(state, payers[0]!, meta.meId) : `${payers.length} people`} paid
                  {myShare ? `, your share ${money(myShare, e.currency)}` : ''}
                </span>
              </span>
              <span className="amount">{money(e.total, e.currency)}</span>
            </a>
          </li>
        )
      })}
    </ul>
  )
}

function Payments({ meta, state }: { meta: GroupMeta; state: GroupState }) {
  if (state.settlements.size === 0) {
    return (
      <section className="empty">
        <h2>No payments yet</h2>
        <p>When someone pays someone back, in bitcoin, cash or otherwise, it shows up here.</p>
      </section>
    )
  }
  // Newest first.
  const payments = [...state.settlements.values()].reverse()
  return (
    <ul className="cards section">
      {payments.map((s) => (
        <li key={s.id} className="card-row">
          <span className="row-main">
            <span>
              {nameOf(state, s.from, meta.meId)} paid {objectName(state, s.to, meta.meId)}
            </span>
            <span className="muted">
              {{ cash: 'Cash', bank: 'Bank transfer', other: 'Other', bitcoin: 'Bitcoin' }[s.method]}
              {s.bitcoin && `, ${new Intl.NumberFormat().format(s.bitcoin.sats)} sats${s.bitcoin.preimage ? ', verified' : ''}`}
            </span>
          </span>
          <span className="amount">{money(s.amount, s.currency)}</span>
        </li>
      ))}
    </ul>
  )
}
