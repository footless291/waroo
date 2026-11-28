import { t } from '@lingui/core/macro'
import { Trans } from '@lingui/react/macro'
import { PageTitle } from '../components/Header.tsx'
import { recentActivity, type ActivityItem } from '../lib/activity.ts'
import { useState } from 'react'
import { byMonth, monthLabel, PAGE, ShowMore } from '../components/MonthList.tsx'
import { formatDate, money, satsText } from '../lib/format.ts'
import { useLoad } from '../lib/hooks.ts'

export function methodName(method: string | undefined): string {
  if (method === 'cash') return t`Cash`
  if (method === 'bank') return t`Bank transfer`
  if (method === 'bitcoin') return t`Bitcoin`
  return t`Other`
}

/** "Nov 20, Okinawa trip, Ana paid" */
function expenseLine(item: ActivityItem): string {
  const group = item.groupName
  const count = item.payers ?? 1
  const who = item.from
  const base = item.friend
    ? count > 1
      ? t`You both paid`
      : who === null
        ? t`You paid`
        : t`${who} paid`
    : count > 1
      ? t`${group}, ${count} people paid`
      : who === null
        ? t`${group}, you paid`
        : t`${group}, ${who} paid`
  return item.date ? `${formatDate(item.date)}${t`, `}${base}` : base
}

function paymentTitle(item: ActivityItem) {
  const from = item.from
  const to = item.to
  if (item.gift) {
    if (from === null) return <Trans><strong>You</strong> sent <strong>{to}</strong></Trans>
    if (to === null) return <Trans><strong>{from}</strong> sent <strong>you</strong></Trans>
    return <Trans><strong>{from}</strong> sent <strong>{to}</strong></Trans>
  }
  if (from === null) return <Trans><strong>You</strong> paid <strong>{to}</strong></Trans>
  if (to === null) return <Trans><strong>{from}</strong> paid <strong>you</strong></Trans>
  return <Trans><strong>{from}</strong> paid <strong>{to}</strong></Trans>
}

function Row({ item }: { item: ActivityItem }) {
  const href = `#/g/${item.groupId}/${item.kind === 'expense' ? 'expenses' : 'payments'}`
  const net = item.myNet ?? 0
  const sum = money(Math.abs(net), item.currency)
  return (
    <li>
      <a className="card-row" href={href}>
        <span className="row-main">
          {item.kind === 'expense' ? (
            <>
              <strong>{item.title}</strong>
              <span className="muted">{expenseLine(item)}</span>
            </>
          ) : (
            <>
              <span>{paymentTitle(item)}</span>
              <span className="muted">
                {[item.date ? formatDate(item.date) : '', item.friend ? '' : item.groupName, item.note ?? '', item.gift ? '' : methodName(item.method), item.sats ? satsText(item.sats) : '']
                  .filter(Boolean)
                  .join(t`, `)}
              </span>
            </>
          )}
        </span>
        {item.kind === 'expense' ? (
          <span className="row-end">
            <span className="amount">{money(item.amount, item.currency)}</span>
            {net > 0 && <span className="owed small">{t`you lent ${sum}`}</span>}
            {net < 0 && <span className="owes small">{t`you borrowed ${sum}`}</span>}
          </span>
        ) : (
          <span className={`amount${item.to === null ? ' owed' : item.from === null ? ' owes' : ''}`}>{money(item.amount, item.currency)}</span>
        )}
      </a>
    </li>
  )
}

/** Expenses and payments in every group and friendship, by month, newest first. Tapping one opens it where it belongs. */
export function ActivityPage() {
  const items = useLoad(() => recentActivity(), [])
  const [limit, setLimit] = useState(PAGE)
  const shown = (items ?? []).slice(0, limit)
  return (
    <div className="screen with-tabbar">
      <PageTitle>{t`Activity`}</PageTitle>
      {items && items.length === 0 && (
        <section className="empty">
          <h2>{t`Nothing yet`}</h2>
          <p>{t`Expenses and payments from all your groups show up here, newest first.`}</p>
        </section>
      )}
      {byMonth(shown, (i) => i.date).map(([month, monthItems]) => (
        <section key={month || 'undated'} className="section month">
          <h2 className="section-title">{month ? monthLabel(month) : t`Earlier`}</h2>
          <ul className="cards">
            {monthItems.map((item) => (
              <Row key={item.key} item={item} />
            ))}
          </ul>
        </section>
      ))}
      {items && <ShowMore shown={shown.length} total={items.length} onMore={() => setLimit(limit + PAGE)} />}
    </div>
  )
}
