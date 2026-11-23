import { Header } from '../components/Header.tsx'
import { recentActivity, type ActivityItem } from '../lib/activity.ts'
import { money } from '../lib/format.ts'
import { locale, useLoad } from '../lib/hooks.ts'

const METHOD: Record<string, string> = { cash: 'Cash', bank: 'Bank transfer', other: 'Other', bitcoin: 'Bitcoin' }

/** "Today", "Yesterday", or a date. */
function dayLabel(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  const yesterday = new Date(Date.now() - 86_400_000)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
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
              <span className="muted">
                {item.groupName}, {item.from === 'You' ? 'you' : item.from} paid
                {item.myShare ? `, your share ${money(item.myShare, item.currency)}` : ''}
              </span>
            </>
          ) : (
            <>
              <span>
                <strong>{item.from}</strong> paid <strong>{item.to}</strong>
              </span>
              <span className="muted">
                {item.groupName}, {METHOD[item.method ?? 'other']}
                {item.sats ? `, ${new Intl.NumberFormat(locale()).format(item.sats)} sats` : ''}
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
    const label = item.at ? dayLabel(item.at) : 'Earlier'
    const last = days.at(-1)
    if (last?.label === label) last.items.push(item)
    else days.push({ label, items: [item] })
  }
  return (
    <div className="screen with-tabbar">
      <Header inPager title="Activity" />
      {items && items.length === 0 && (
        <section className="empty">
          <h2>Nothing yet</h2>
          <p>Expenses and payments from all your groups show up here, newest first.</p>
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
