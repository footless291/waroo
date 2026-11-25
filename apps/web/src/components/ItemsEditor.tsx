import { t } from '@lingui/core/macro'
/**
 * Line items for an itemized split: what each thing cost and who had it,
 * plus extras (tax, tip, service charge, or a discount) spread in proportion
 * to what each person had.
 */
export interface ItemDraft {
  key: string
  label: string
  amount: string
  among: string[]
}

export interface ExtraDraft {
  key: string
  label: string
  amount: string
}

const newKey = () => crypto.randomUUID()

export const newItem = (among: string[]): ItemDraft => ({ key: newKey(), label: '', amount: '', among })
export const newExtra = (): ExtraDraft => ({ key: newKey(), label: '', amount: '' })

export function ItemsEditor({
  items,
  extras,
  people,
  onItems,
  onExtras,
}: {
  items: ItemDraft[]
  extras: ExtraDraft[]
  /** Everyone who can be on an item, in order, with the name to show. */
  people: { id: string; name: string }[]
  onItems: (items: ItemDraft[]) => void
  onExtras: (extras: ExtraDraft[]) => void
}) {
  const setItem = (key: string, change: Partial<ItemDraft>) =>
    onItems(items.map((i) => (i.key === key ? { ...i, ...change } : i)))
  const setExtra = (key: string, change: Partial<ExtraDraft>) =>
    onExtras(extras.map((x) => (x.key === key ? { ...x, ...change } : x)))

  return (
    <div className="items">
      <ol className="item-list">
        {items.map((item, index) => {
          const n = index + 1
          return (
            <li key={item.key} className="item">
              <div className="item-top">
                <input
                  className="item-label"
                  value={item.label}
                  placeholder={t`Item ${n}`}
                  onChange={(e) => setItem(item.key, { label: e.target.value })}
                  aria-label={t`What item ${n} was`}
                />
                <input
                  className="item-amount"
                  inputMode="decimal"
                  value={item.amount}
                  placeholder="0"
                  onChange={(e) => setItem(item.key, { amount: e.target.value })}
                  aria-label={t`Price of item ${n}`}
                />
                <button
                  type="button"
                  className="icon-button item-remove"
                  aria-label={t`Remove item ${n}`}
                  disabled={items.length === 1}
                  onClick={() => onItems(items.filter((i) => i.key !== item.key))}
                >
                  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                    <path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
              <div className="item-people" role="group" aria-label={t`Who had item ${n}`}>
                {people.map((p) => {
                  const on = item.among.includes(p.id)
                  return (
                    <button
                      key={p.id}
                      type="button"
                      className={`person-chip${on ? ' on' : ''}`}
                      aria-pressed={on}
                      onClick={() =>
                        setItem(item.key, {
                          among: on ? item.among.filter((id) => id !== p.id) : [...item.among, p.id],
                        })
                      }
                    >
                      {p.name}
                    </button>
                  )
                })}
              </div>
            </li>
          )
        })}
      </ol>
      <button
        type="button"
        className="button small outline"
        onClick={() => onItems([...items, newItem(people.map((p) => p.id))])}
      >
        {t`Add item`}
      </button>

      {extras.length > 0 && (
        <ul className="item-list extras">
          {extras.map((extra, index) => (
            <li key={extra.key} className="item-top">
              <input
                className="item-label"
                value={extra.label}
                placeholder={t`Tax, tip or discount`}
                onChange={(e) => setExtra(extra.key, { label: e.target.value })}
                aria-label={t`What extra ${index + 1} is`}
              />
              <input
                className="item-amount"
                inputMode="decimal"
                value={extra.amount}
                placeholder="0"
                onChange={(e) => setExtra(extra.key, { amount: e.target.value })}
                aria-label={t`Amount of extra ${index + 1}`}
              />
              <button
                type="button"
                className="icon-button item-remove"
                aria-label={t`Remove extra ${index + 1}`}
                onClick={() => onExtras(extras.filter((x) => x.key !== extra.key))}
              >
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                  <path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="link add-extra" onClick={() => onExtras([...extras, newExtra()])}>
        {t`Add tax, tip or discount`}
      </button>
      {extras.length > 0 && (
        <p className="hint pad">{t`Shared by what each person had. Use a minus sign for a discount.`}</p>
      )}
    </div>
  )
}
