import { t } from '@lingui/core/macro'
import { Trans } from '@lingui/react/macro'
import { PageTitle } from '../components/Header.tsx'
import { recentActivity, type ActivityItem } from '../lib/activity.ts'
import { money, satsText } from '../lib/format.ts'
import { locale, useLoad } from '../lib/hooks.ts'

export function methodName(method: string | undefined): string {
  if (method === 'cash') return t`Cash`
  if (method === 'bank') return t`Bank transfer`
  if (method === 'bitcoin') return t`Bitcoin`
  return t`Other`
}

/** "Okinawa trip, Ana paid, your share ¥1,000" */
function expenseLine(item: ActivityItem): string {
  const group = item.groupName
  const count = item.payers ?? 1
  const who = item.from
  const base =
    count > 1 ? t`${group}, ${count} people paid` : who === null ? t`${group}, you paid` : t`${group}, ${who} paid`
  if (!item.myShare) return base
  const share = money(item.myShare, item.currency)
  return t`${base}, your share ${share}`
}

function paymentTitle(item: ActivityItem) {
  const from = item.from
  const to = item.to
  if (from === null) return <Trans><strong>You</strong> paid <strong>{to}</strong></Trans>
  if (to === null) return <Trans><strong>{from}</strong> paid <strong>you</strong></Trans>
  return <Trans><strong>{from}</strong> paid <strong>{to}</strong></Trans>
}

/** "Today", "Yesterday", or a date. */
function dayLabel(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  const yesterday = new Date(Date.now() - 86_400_000)
  if (d.toDateString() === today.toDateString()) return t`Today`
  if (d.toDateString() === yesterday.toDateString()) return t`Yesterday`
  return new Intl.DateTimeFormat(locale(), { month: 'short', day: 'numeric', weekday: 'short' }).format(d)
}

function Row({ item }: { item: ActivityItem }) {
  const href = `#/g/${item.groupId}/${item.kind === 'expense' ? 'expenses' : 'payments'}`
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
                {[item.groupName, methodName(item.method), item.sats ? satsText(item.sats) : '']
                  .filter(Boolean)
                  .join(t`, `)}
              </span>
            </>
          )}
        </span>
        <span className="amount">{money(item.amount, item.currency)}</span>
      </a>
    </li>
  )
}

/** Recent expenses and payments in every group. Tapping one opens it in its group. */
export function ActivityPage() {
  const items = useLoad(() => recentActivity(), [])

  // Grouped by day, newest first.
  const days: { label: string; items: ActivityItem[] }[] = []
  for (const item of items ?? []) {
    const label = item.at ? dayLabel(item.at) : t`Earlier`
    const last = days.at(-1)
    if (last?.label === label) last.items.push(item)
    else days.push({ label, items: [item] })
  }
  return (
    <div className="screen with-tabbar">
      <PageTitle>{t`Activity`}</PageTitle>
      {items && items.length === 0 && (
        <section className="empty">
          <h2>{t`Nothing yet`}</h2>
          <p>{t`Expenses and payments from all your groups show up here, newest first.`}</p>
        </section>
      )}
      {days.map((day) => (
        <section key={day.label} className="section">
          <h2 className="section-title">{day.label}</h2>
          <ul className="cards">
            {day.items.map((item) => (
              <Row key={item.key} item={item} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
