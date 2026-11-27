import { Trans } from '@lingui/react/macro'
import { plural, t } from '@lingui/core/macro'
import {
  computeShares,
  groupBalances,
  suggestTransfers,
  type GroupState,
  type Transfer,
} from '@waroo/ledger'
import { useEffect, useState } from 'react'
import { Avatar } from '../components/Avatar.tsx'
import { NotificationsNudge } from '../components/NotificationsCard.tsx'
import { Header } from '../components/Header.tsx'
import { PlusIcon } from '../components/icons.tsx'
import { FriendAcross, FriendStatus, RemoveFriend } from './FriendsScreen.tsx'
import { friendshipState } from '../lib/friends.ts'
import { SyncLine } from '../components/SyncLine.tsx'
import { groupTabs, TabBar } from '../components/TabBar.tsx'
import { Pager } from '../components/Pager.tsx'
import { deleteGroupLocally, type GroupMeta } from '../lib/db.ts'
import { formatDate, money, politeName, satsText } from '../lib/format.ts'
import { groupTitle } from '../lib/title.ts'
import { methodName } from './ActivityScreen.tsx'
import { go, locale, useGroup } from '../lib/hooks.ts'
import { syncHub } from '../lib/sync.ts'

export type Tab = 'balances' | 'expenses' | 'payments'

export function GroupScreen({ groupId, tab, joined }: { groupId: string; tab: Tab; joined?: boolean }) {
  const group = useGroup(groupId)
  const [toast, setToast] = useState(joined)
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(false), 5000)
    return () => clearTimeout(timer)
  }, [toast])
  if (group === undefined) return <main className="screen" />
  if (group === null) {
    return (
      <main className="screen">
        <Header title={t`Not found`} back="/" />
        <p className="empty">{t`This group isn’t on this device.`}</p>
      </main>
    )
  }
  const { meta, state } = group
  const base = `/g/${groupId}`
  const tabs = groupTabs(groupId)
  const currentTab = tab === 'balances' ? base : `${base}/${tab}`
  const name = groupTitle(state, meta)
  const friendship = state.kind === 'friends'
  const friendStatus = friendship ? friendshipState(state, meta.meId) : undefined
  // A friendship that ended (either way) can be read, not added to.
  const ended = friendStatus === 'removed' || friendStatus === 'disconnected'
  const myself = state.members.get(meta.meId)
  // Set when someone removed this phone: their name, or null if they're unknown.
  const removedBy =
    state.signed && myself?.removedBy && myself.key === undefined
      ? (state.members.get(myself.removedBy)?.name ?? null)
      : undefined
  // Set when someone vouched for a new phone in this person's place: this one is cut off.
  const replacedBy =
    state.signed && myself?.recoveredBy && meta.publicKey && myself.key !== meta.publicKey
      ? (state.members.get(myself.recoveredBy)?.name ?? t`Someone`)
      : undefined
  const cutOff = removedBy !== undefined || replacedBy !== undefined
  const remover = removedBy ?? t`Someone`
  const myName = state.members.get(meta.meId)?.name
  const current = [...state.members.values()].filter((m) => !m.left)
  const notJoined = current.filter((m) => !m.key && m.id !== meta.meId)
  const alone = current.every((m) => m.id === meta.meId || !m.key)
  const pages = [
    {
      path: base,
      content: (
        <div className="screen with-tabbar page-body">
          {friendship && <FriendStatus friendship={meta} state={state} />}
          {friendStatus === 'waiting' && (
            <section className="invite-card">
              <h2>{t`Your friend hasn’t joined yet`}</h2>
              <a className="button primary" href={`#/friends/add?g=${groupId}`}>
                {t`Show the friend code`}
              </a>
            </section>
          )}
          {alone && !friendship && (
            <section className="invite-card">
              <h2>{notJoined.length > 0 ? cantSeeYet(notJoined.map((m) => m.name)) : t`Splitting with friends?`}</h2>
              <p>{t`Invite them, and everyone can add expenses and settle up from their own phone.`}</p>
              <a className="button primary" href={`#${base}/invite`}>
                {t`Invite people`}
              </a>
            </section>
          )}
          {state.conflicts.length > 0 && (
            <p className="notice">{conflictsNotice(state.conflicts.length)}</p>
          )}
          {!alone && !ended && <NotificationsNudge />}
          <Balances meta={meta} state={state} />
          {friendship && <FriendAcross friendship={meta} state={state} />}
          {friendship && <RemoveFriend friendship={meta} state={state} />}
        </div>
      ),
    },
    {
      path: `${base}/expenses`,
      content: (
        <div className="screen with-tabbar page-body">
          <Expenses meta={meta} state={state} />
        </div>
      ),
    },
    {
      path: `${base}/payments`,
      content: (
        <div className="screen with-tabbar page-body">
          <Payments meta={meta} state={state} />
        </div>
      ),
    },
  ]
  return (
    <main className="tabs-shell">
      <div className="screen shell-top">
        <Header
          title={
            cutOff || friendship ? (
              name
            ) : (
              <a className="title-link" href={`#${base}/edit`} aria-label={t`${name}: group settings`}>
                {name}
                <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                  <path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                </svg>
              </a>
            )
          }
          back={friendship ? '/friends' : '/'}
          action={
            friendship ? undefined : (
              <a className="button small" href={`#${base}/invite`}>
                {t`Invite`}
              </a>
            )
          }
        />
        <SyncLine groupId={groupId} state={state} meId={meta.meId} />
        {cutOff && (
          <div className="removed-notice" role="status">
            {replacedBy !== undefined ? (
              <p>
                <Trans>
                  <strong>
                    {replacedBy} moved you to a new phone in {name}.
                  </strong>{' '}
                  This phone can’t add anything any more. If that wasn’t you, tell the group.
                </Trans>
              </p>
            ) : (
              <p>
                <Trans>
                  <strong>
                    {remover} removed you from {name}.
                  </strong>{' '}
                  This phone won’t get anything new from the group. To come back, ask for a new invite.
                </Trans>
              </p>
            )}
            <button
              className="button small outline"
              onClick={async () => {
                syncHub.drop(groupId)
                await deleteGroupLocally(groupId)
                go('/')
              }}
            >
              {t`Remove from this phone`}
            </button>
          </div>
        )}
      </div>
      <Pager pages={pages} current={currentTab} />
      {toast && (
        <div className="toast" role="status">
          {friendship ? (
            <Trans>You and {name} are friends on Waroo now</Trans>
          ) : (
            <Trans>
              You joined {name} as {myName}
            </Trans>
          )}
        </div>
      )}
      {cutOff || ended ? null : tab === 'payments' ? (
        <a className="fab" href={`#${base}/pay`}>
          <PlusIcon />
          {t`Add payment`}
        </a>
      ) : (
        <a className="fab" href={`#${base}/add`}>
          <PlusIcon />
          {t`Add expense`}
        </a>
      )}
      <TabBar tabs={tabs} current={currentTab} label={t`Group sections`} />
    </main>
  )
}

/** A member's name, or "You". */
const nameOf = (state: GroupState, id: string, meId?: string) =>
  id === meId ? t`You` : (state.members.get(id)?.name ?? t`Someone`)

/** "Bob", "Bob and Cai", "Bob, Cai and Dee", in the app's language. */
const listNames = (names: string[]) =>
  new Intl.ListFormat(locale(), { type: 'conjunction' }).format(names.map(politeName))

function cantSeeYet(names: string[]) {
  const who = listNames(names)
  return t`${who} can’t see this yet`
}

function conflictsNotice(count: number) {
  return plural(count, {
    one: 'One expense was edited by two people at once. The latest edit was kept.',
    other: '# expenses were edited by two people at once. The latest edit was kept.',
  })
}

/** "Bob pays Cai", "You pay Bob", "Bob pays you", with the names in bold. */
function Pays({ state, from, to, meId }: { state: GroupState; from: string; to: string; meId: string }) {
  const payer = nameOf(state, from, meId)
  const payee = nameOf(state, to, meId)
  if (from === meId) return <Trans><strong>You</strong> pay <strong>{payee}</strong></Trans>
  if (to === meId) return <Trans><strong>{payer}</strong> pays <strong>you</strong></Trans>
  return <Trans><strong>{payer}</strong> pays <strong>{payee}</strong></Trans>
}

const settleHref = (groupId: string, transfer: Transfer) =>
  `#/g/${groupId}/settle?${new URLSearchParams({
    from: transfer.from,
    to: transfer.to,
    amount: String(transfer.amount),
    currency: transfer.currency,
  })}`

function Balances({ meta, state }: { meta: GroupMeta; state: GroupState }) {
  const balances = groupBalances(state)
  const transfers = suggestTransfers(balances)
  if (balances.size === 0) {
    return (
      <>
        <section className="empty compact">
          <h2>{state.expenses.size === 0 ? t`Nothing to split yet` : t`All square`}</h2>
          <p>{state.expenses.size === 0 ? t`Add the first expense to get started.` : t`Nobody owes anybody.`}</p>
        </section>
        <Everyone meta={meta} state={state} />
      </>
    )
  }

  // The hero shows this person's own position, in the group's main currency
  // when they have one there, else the first currency they're in.
  const currencies = [...balances.keys()].sort((a, b) =>
    a === (state.currency ?? meta.currency) ? -1 : b === (state.currency ?? meta.currency) ? 1 : a.localeCompare(b),
  )
  const heroCurrency = currencies.find((c) => balances.get(c)?.get(meta.meId)) ?? currencies[0]!
  const mine = balances.get(heroCurrency)?.get(meta.meId) ?? 0
  const myPayments = transfers.filter((x) => x.from === meta.meId && x.currency === heroCurrency)
  const myIncoming = transfers.filter((x) => x.to === meta.meId && x.currency === heroCurrency)
  const heroTransfer = myPayments.length === 1 ? myPayments[0] : undefined
  const others = transfers.filter((x) => x !== heroTransfer)
  function heroLabel() {
    if (mine < 0) {
      const to = heroTransfer ? nameOf(state, heroTransfer.to) : ''
      return heroTransfer ? t`You owe ${to}` : t`You owe`
    }
    if (myIncoming.length === 0) return t`You get back`
    const from = listNames(myIncoming.map((x) => nameOf(state, x.from)))
    return t`You get back from ${from}`
  }

  return (
    <>
      <section className="hero" aria-label={t`Your balance`}>
        {mine === 0 ? (
          <p className="hero-amount" style={{ fontSize: '2rem' }}>
            {t`You’re all square`}
          </p>
        ) : (
          <>
            <div className="avatar-stack">
              <Avatar state={state} id={meta.meId} />
              {(mine < 0 ? myPayments.map((x) => x.to) : myIncoming.map((x) => x.from))
                .slice(0, 3)
                .map((id) => (
                  <Avatar key={id} state={state} id={id} />
                ))}
            </div>
            <p className="hero-label">{heroLabel()}</p>
            <p className="hero-amount">{money(Math.abs(mine), heroCurrency)}</p>
            {heroTransfer && (
              <a className="button primary" href={settleHref(meta.id, heroTransfer)}>
                {t`Settle up`}
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
          title={currencies.length > 1 ? t`Everyone, in ${currency}` : t`Everyone`}
        />
      ))}

      {others.length > 0 && (
        <section className="section">
          <h2 className="section-title">{t`Settle up`}</h2>
          <ul className="cards">
            {others.map((x) => (
              <li key={`${x.from}-${x.to}-${x.currency}`} className="card-row">
                <span className="row-main">
                  <span>
                    <Pays state={state} from={x.from} to={x.to} meId={meta.meId} />
                  </span>
                  <span className="amount">{money(x.amount, x.currency)}</span>
                </span>
                <a className="button small outline" href={settleHref(meta.id, x)}>
                  {t`Settle`}
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
  title,
}: {
  meta: GroupMeta
  state: GroupState
  currency?: string
  amounts?: Map<string, number>
  title?: string
}) {
  return (
    <section className="section">
      <h2 className="section-title">{title ?? t`Everyone`}</h2>
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
                  <span className="muted">{t`all square`}</span>
                ) : (
                  <span className={`amount ${amount > 0 ? 'owed' : 'owes'}`}>{standing(amount, currency, me)}</span>
                )}
                {me ? (
                  <a className="button small outline" href={`#/g/${meta.id}/me`} aria-label={t`Change your name, or leave the group`}>
                    {t`Edit`}
                  </a>
                ) : (
                  <a className="icon-button person-more" href={`#/g/${meta.id}/m/${person}`} aria-label={moreAbout(state.members.get(person)?.name ?? '')}>
                    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                      <path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
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
        <h2>{t`No expenses yet`}</h2>
        <p>{t`Add what someone paid for, and Waroo works out who owes what.`}</p>
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
                <span className="muted">{expenseLine(state, meta.meId, formatDate(e.date), payers, myShare, e.currency)}</span>
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
        <h2>{t`No payments yet`}</h2>
        <p>{t`When someone pays someone back, in bitcoin, cash or otherwise, it shows up here.`}</p>
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
            <span>{paidLine(state, s.from, s.to, meta.meId)}</span>
            <span className="muted">
              {[methodName(s.method), s.bitcoin ? satsText(s.bitcoin.sats) : '']
                .filter(Boolean)
                .join(t`, `)}
            </span>
          </span>
          <span className="amount">{money(s.amount, s.currency)}</span>
        </li>
      ))}
    </ul>
  )
}

/** "gets back ¥1,000", "owe ¥500": a row in Everyone. */
function standing(amount: number, currency: string, me: boolean): string {
  const sum = money(Math.abs(amount), currency)
  if (amount > 0) return me ? t`get back ${sum}` : t`gets back ${sum}`
  return me ? t`owe ${sum}` : t`owes ${sum}`
}

function moreAbout(name: string) {
  return t`More about ${name}`
}

/** "Nov 20, Ana paid, your share ¥1,000" */
function expenseLine(state: GroupState, meId: string, date: string, payers: string[], myShare: number | undefined, currency: string) {
  const count = payers.length
  const who = nameOf(state, payers[0]!, meId)
  const base =
    count > 1 ? t`${date}, ${count} people paid` : payers[0] === meId ? t`${date}, you paid` : t`${date}, ${who} paid`
  if (!myShare) return base
  const share = money(myShare, currency)
  return t`${base}, your share ${share}`
}

/** "Ana paid Bob", "You paid Bob", "Ana paid you" */
function paidLine(state: GroupState, from: string, to: string, meId: string) {
  const payer = nameOf(state, from, meId)
  const payee = nameOf(state, to, meId)
  if (from === meId) return t`You paid ${payee}`
  if (to === meId) return t`${payer} paid you`
  return t`${payer} paid ${payee}`
}
