import { t } from '@lingui/core/macro'
import {
  computeShares,
  parseAmount,
  validateExpense,
  type Expense,
  type GroupState,
  type SplitMethod,
} from '@waroo/ledger'
import { useState, type FormEvent } from 'react'
import { Header } from '../components/Header.tsx'
import { DateField } from '../components/DateField.tsx'
import { ItemsEditor, newExtra, newItem, type ExtraDraft, type ItemDraft } from '../components/ItemsEditor.tsx'
import { Segmented } from '../components/Segmented.tsx'
import { append, newId, type GroupMeta } from '../lib/db.ts'
import { CURRENCIES, isRemoved, money, today, toInput } from '../lib/format.ts'
import { go, useGroup } from '../lib/hooks.ts'
import { ledgerText } from '../lib/ledgerText.ts'

type Mode = 'equal' | 'shares' | 'percent' | 'exact' | 'adjustment' | 'itemized'

const modes = (): { value: Mode; label: string }[] => [
  { value: 'equal', label: t`Equally` },
  { value: 'shares', label: t`Shares` },
  { value: 'percent', label: t`Percent` },
  { value: 'exact', label: t`Exact` },
  { value: 'adjustment', label: t`Adjust` },
  { value: 'itemized', label: t`Items` },
]

/** The "Paid by" choice that opens a list of amounts. */
const SEVERAL = '__several'

/** What each split mode means, under the buttons. */
const modeHint = (mode: Mode): string | undefined =>
  mode === 'adjustment'
    ? t`Add or take off an amount for anyone, and split the rest equally among the people ticked.`
    : mode === 'itemized'
      ? t`List what each person had. Shared things are split among whoever had them.`
      : undefined

/** "12.5" → 1250 hundredths of a percent; null if it isn't a percentage. */
function parsePercent(text: string): number | null {
  const m = /^\s*(\d{1,3})(?:[.,](\d{1,2}))?\s*%?\s*$/.exec(text)
  if (!m) return null
  const value = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'))
  return value <= 10_000 ? value : null
}

/** 1250 → "12.5" */
const percentText = (basisPoints: number) => String(basisPoints / 100)

export function ExpenseScreen({ groupId, expenseId }: { groupId: string; expenseId?: string }) {
  const group = useGroup(groupId)
  if (!group) return <main className="screen" />
  const existing = expenseId ? group.state.expenses.get(expenseId) : undefined
  if (expenseId && !existing) {
    return (
      <main className="screen">
        <Header title={t`Expense`} back={`/g/${groupId}/expenses`} />
        <p className="empty">{t`This expense was deleted.`}</p>
      </main>
    )
  }
  // Keyed so the form resets if the expense changes underneath it.
  return (
    <ExpenseForm
      key={existing ? group.state.heads.get(existing.id) : 'new'}
      meta={group.meta}
      state={group.state}
      existing={existing}
    />
  )
}

function ExpenseForm({
  meta,
  state,
  existing,
}: {
  meta: GroupMeta
  state: GroupState
  existing?: Expense
}) {
  // People who left or were removed only appear on expenses they were already part of.
  const involved = existing ? new Set([...Object.keys(existing.payers), ...computeShares(existing).keys()]) : new Set<string>()
  const members = [...state.members.values()].filter((m) => (!m.left && !isRemoved(state, m)) || involved.has(m.id))
  const allIds = members.map((m) => m.id)
  const initial = existing?.split

  const [title, setTitle] = useState(existing?.title ?? '')
  const [currency, setCurrency] = useState(existing?.currency ?? (state.currency ?? meta.currency))
  const [amountText, setAmountText] = useState(existing ? toInput(existing.total, existing.currency) : '')
  const [date, setDate] = useState(existing?.date ?? today())
  const existingPayers = existing ? Object.keys(existing.payers) : []
  const [payer, setPayer] = useState(
    existingPayers.length > 1 ? SEVERAL : (existingPayers[0] ?? meta.meId),
  )
  const [paidAmounts, setPaidAmounts] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      allIds.map((id) => [
        id,
        existing && existingPayers.length > 1 && existing.payers[id] ? toInput(existing.payers[id]!, existing.currency) : '',
      ]),
    ),
  )
  const [mode, setMode] = useState<Mode>(initial?.kind ?? 'equal')
  const [included, setIncluded] = useState<Set<string>>(
    new Set(initial?.kind === 'equal' || initial?.kind === 'adjustment' ? initial.among : allIds),
  )
  const [adjustments, setAdjustments] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      allIds.map((id) => [
        id,
        initial?.kind === 'adjustment' && initial.extras[id] ? toInput(initial.extras[id]!, existing!.currency) : '',
      ]),
    ),
  )
  const [items, setItems] = useState<ItemDraft[]>(() =>
    initial?.kind === 'itemized'
      ? initial.items.map((i) => ({
          key: crypto.randomUUID(),
          label: i.label ?? '',
          amount: toInput(i.amount, existing!.currency),
          among: i.among,
        }))
      : [newItem(allIds.filter((id) => !isRemoved(state, state.members.get(id)!) && !state.members.get(id)!.left))],
  )
  const [extras, setExtras] = useState<ExtraDraft[]>(() =>
    initial?.kind === 'itemized'
      ? (initial.extras ?? []).map((x) => ({ ...newExtra(), label: x.label ?? '', amount: toInput(x.amount, existing!.currency) }))
      : [],
  )
  const [weights, setWeights] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      allIds.map((id) => [id, initial?.kind === 'shares' ? String(initial.weights[id] ?? 0) : '1']),
    ),
  )
  const [exact, setExact] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      allIds.map((id) => [
        id,
        initial?.kind === 'exact' && initial.amounts[id] !== undefined
          ? toInput(initial.amounts[id]!, existing!.currency)
          : '',
      ]),
    ),
  )
  const [percents, setPercents] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      allIds.map((id) => [
        id,
        initial?.kind === 'percent' && initial.basisPoints[id] ? percentText(initial.basisPoints[id]!) : '',
      ]),
    ),
  )
  const [confirmDelete, setConfirmDelete] = useState(false)
  // Minted up front: the id seeds who gets a leftover yen, so the preview must
  // use the same id the expense is saved with.
  const [expenseId] = useState(() => existing?.id ?? newId())

  // Build the expense from the form; collect problems instead of throwing.
  const problems: string[] = []
  const parse = (text: string, what: string) => {
    if (!text.trim()) return 0
    try {
      return parseAmount(text, currency)
    } catch (e) {
      const message = ledgerText((e as Error).message)
      problems.push(t`${what}: ${message}`)
      return 0
    }
  }
  // Items: the parts, and what they come to.
  const parsedItems = items.map((item, i) => ({
    label: item.label.trim() || undefined,
    amount: parse(item.amount, item.label.trim() || itemName(i + 1)),
    among: item.among,
  }))
  const parsedExtras = extras.map((x, i) => ({
    label: x.label.trim() || undefined,
    amount: parse(x.amount, x.label.trim() || extraName(i + 1)),
  }))
  const itemsSum = [...parsedItems, ...parsedExtras].reduce((a, b) => a + b.amount, 0)
  // With items, a blank amount means "whatever the items come to".
  const total = mode === 'itemized' && !amountText.trim() ? itemsSum : parse(amountText, t`Amount`)
  let split: SplitMethod
  if (mode === 'equal') split = { kind: 'equal', among: [...included] }
  else if (mode === 'adjustment') {
    split = {
      kind: 'adjustment',
      among: [...included],
      extras: Object.fromEntries(
        allIds.flatMap((id) => {
          const text = adjustments[id]?.trim()
          if (!text) return []
          const amount = parse(text.replace(/^\+/, ''), state.members.get(id)!.name)
          return amount ? [[id, amount]] : []
        }),
      ),
    }
  } else if (mode === 'itemized') {
    split = {
      kind: 'itemized',
      items: parsedItems.map(({ label, amount, among }) => ({ ...(label ? { label } : {}), amount, among })),
      ...(parsedExtras.length
        ? { extras: parsedExtras.map(({ label, amount }) => ({ ...(label ? { label } : {}), amount })) }
        : {}),
    }
  }
  else if (mode === 'shares') {
    split = {
      kind: 'shares',
      weights: Object.fromEntries(allIds.map((id) => [id, Math.max(0, Math.floor(Number(weights[id]) || 0))])),
    }
  } else if (mode === 'percent') {
    split = {
      kind: 'percent',
      basisPoints: Object.fromEntries(
        allIds.flatMap((id) => {
          const text = percents[id]?.trim()
          if (!text) return []
          const bp = parsePercent(text)
          if (bp === null) {
            const who = state.members.get(id)!.name
            problems.push(t`${who}: use a percentage like 25 or 12.5`)
            return []
          }
          return bp > 0 ? [[id, bp]] : []
        }),
      ),
    }
  } else {
    split = {
      kind: 'exact',
      amounts: Object.fromEntries(
        allIds.flatMap((id) => {
          const name = state.members.get(id)!.name
          return exact[id]?.trim() ? [[id, parse(exact[id]!, name)]] : []
        }),
      ),
    }
  }
  const expense: Expense = {
    id: expenseId,
    title: title.trim(),
    total,
    currency,
    payers:
      payer === SEVERAL
        ? Object.fromEntries(
            allIds.flatMap((id) => {
              const text = paidAmounts[id]?.trim()
              if (!text) return []
              const who = state.members.get(id)!.name
              const amount = parse(text, t`Paid by ${who}`)
              return amount ? [[id, amount]] : []
            }),
          )
        : { [payer]: total },
    split,
    date,
  }
  if (!expense.title) problems.push(t`Give it a name`)
  if (total === 0) problems.push(mode === 'itemized' ? t`Enter what each item cost` : t`Enter an amount`)
  else {
    problems.push(
      ...validateExpense(expense, new Set(allIds)).filter(
        // The "left to assign" hint below already says this, in plain money.
        (p) =>
          !(mode === 'exact' && p.startsWith('Exact amounts total')) &&
          !(mode === 'percent' && p.startsWith('Percentages must total')) &&
          !(mode === 'itemized' && p.startsWith('Items (')) &&
          !(payer === SEVERAL && (p.startsWith('Payers paid') || p === 'Someone has to have paid')),
      ),
    )
    if (mode === 'itemized') {
      parsedItems.forEach((item, i) => {
        if (item.among.length === 0) {
          const what = item.label ?? itemName(i + 1)
          problems.push(t`Pick who had ${what}`)
        }
      })
    }
  }
  // These come from the ledger's wording; say them in the form's.
  for (let i = 0; i < problems.length; i++) {
    problems[i] = ledgerText(problems[i]!)
  }

  let shares: Map<string, number> | undefined
  try {
    shares = total !== 0 ? computeShares(expense) : undefined
  } catch {
    shares = undefined
  }

  const exactRemaining =
    mode === 'exact' && shares === undefined
      ? total - Object.values(split.kind === 'exact' ? split.amounts : {}).reduce((a, b) => a + b, 0)
      : 0

  const percentRemaining =
    mode === 'percent' && split.kind === 'percent'
      ? 10_000 - Object.values(split.basisPoints).reduce((a, b) => a + b, 0)
      : 0
  const itemsRemaining = mode === 'itemized' ? total - itemsSum : 0
  const paidRemaining =
    payer === SEVERAL ? total - Object.values(expense.payers).reduce((a, b) => a + b, 0) : 0
  const unassigned = exactRemaining !== 0 || percentRemaining !== 0 || itemsRemaining !== 0 || paidRemaining !== 0
  const leftOrOver = (amount: number, what: string) =>
    amount > 0 ? `${money(amount, currency)} ${what}` : `${money(-amount, currency)} too much`

  async function save(e: FormEvent) {
    e.preventDefault()
    if (problems.length > 0 || unassigned) return
    const basedOn = existing ? state.heads.get(existing.id) : undefined
    await append(meta, [{ type: 'expense.saved', expense, ...(basedOn ? { basedOn } : {}) }])
    go(`/g/${meta.id}/expenses`)
  }

  async function remove() {
    if (!existing) return
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    await append(meta, [
      { type: 'expense.deleted', expenseId: existing.id, basedOn: state.heads.get(existing.id)! },
    ])
    go(`/g/${meta.id}/expenses`)
  }

  const nameOf = (id: string) => {
    const name = state.members.get(id)?.name ?? ''
    return id === meta.meId ? t`${name} (you)` : name
  }

  return (
    <main className="screen">
      <Header title={existing ? t`Edit expense` : t`Add expense`} back={`/g/${meta.id}/expenses`} />
      <form className="form" onSubmit={save}>
        <label className="field">
          <span>{t`What for`}</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t`Izakaya dinner`} />
        </label>
        <div className="field-row">
          <label className="field grow">
            <span>{t`Amount`}</span>
            <input
              className="amount-input"
              value={amountText}
              onChange={(e) => setAmountText(e.target.value)}
              inputMode="decimal"
              placeholder={mode === 'itemized' && itemsSum !== 0 ? toInput(itemsSum, currency) : '0'}
            />
          </label>
          <label className="field">
            <span>{t`Currency`}</span>
            <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {[...new Set([(state.currency ?? meta.currency), ...CURRENCIES])].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="field-row">
          <label className="field grow">
            <span>{t`Paid by`}</span>
            <select value={payer} onChange={(e) => setPayer(e.target.value)}>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {nameOf(m.id)}
                </option>
              ))}
              <option value={SEVERAL}>{t`Several people`}</option>
            </select>
          </label>
          <DateField label={t`Date`} value={date} onChange={setDate} />
        </div>
        {payer === SEVERAL && (
          <fieldset className="field">
            <legend>{t`Who paid how much`}</legend>
            <ul className="split-list">
              {members.map((m) => (
                <li key={m.id}>
                  <label className="split-input">
                    <span>{nameOf(m.id)}</span>
                    <input
                      inputMode="decimal"
                      value={paidAmounts[m.id] ?? ''}
                      placeholder="0"
                      onChange={(e) => setPaidAmounts({ ...paidAmounts, [m.id]: e.target.value })}
                      aria-label={t`Paid by ${m.name}`}
                    />
                  </label>
                </li>
              ))}
            </ul>
            <p className="hint" aria-live="polite">
              {total !== 0 && paidRemaining !== 0 ? leftOrOver(paidRemaining, 'still to account for') : ''}
            </p>
          </fieldset>
        )}

        <fieldset className="field">
          <legend>{t`Split`}</legend>
          <Segmented label={t`Split method`} options={modes()} value={mode} onChange={setMode} className="grid3" />
          {modeHint(mode) && <p className="hint pad">{modeHint(mode)}</p>}
          {mode === 'itemized' && (
            <ItemsEditor
              items={items}
              extras={extras}
              people={members.map((m) => ({ id: m.id, name: nameOf(m.id) }))}
              onItems={setItems}
              onExtras={setExtras}
            />
          )}
          <ul className={`split-list${mode === 'itemized' ? ' totals' : ''}`}>
            {members.map((m) => (
              <li key={m.id}>
                {mode === 'itemized' ? (
                  <span className="split-input">{nameOf(m.id)}</span>
                ) : mode === 'adjustment' ? (
                  <label className="split-input adjust">
                    <input
                      type="checkbox"
                      checked={included.has(m.id)}
                      onChange={(e) => {
                        const next = new Set(included)
                        if (e.target.checked) next.add(m.id)
                        else next.delete(m.id)
                        setIncluded(next)
                      }}
                      aria-label={t`Split the rest with ${m.name}`}
                    />
                    <span>{nameOf(m.id)}</span>
                    <input
                      inputMode="decimal"
                      value={adjustments[m.id] ?? ''}
                      placeholder="+0"
                      onChange={(e) => setAdjustments({ ...adjustments, [m.id]: e.target.value })}
                      aria-label={t`Extra for ${m.name}`}
                    />
                  </label>
                ) : mode === 'equal' ? (
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={included.has(m.id)}
                      onChange={(e) => {
                        const next = new Set(included)
                        if (e.target.checked) next.add(m.id)
                        else next.delete(m.id)
                        setIncluded(next)
                      }}
                    />
                    {nameOf(m.id)}
                  </label>
                ) : (
                  <label className="split-input">
                    <span>{nameOf(m.id)}</span>
                    {mode === 'percent' ? (
                      <span className="percent-input">
                        <input
                          inputMode="decimal"
                          value={percents[m.id] ?? ''}
                          placeholder="0"
                          onChange={(e) => setPercents({ ...percents, [m.id]: e.target.value })}
                          aria-label={t`Percent for ${m.name}`}
                        />
                        <span aria-hidden="true">%</span>
                      </span>
                    ) : mode === 'shares' ? (
                      <span className="stepper">
                        <button
                          type="button"
                          aria-label={t`One share fewer for ${m.name}`}
                          disabled={(Number(weights[m.id]) || 0) <= 0}
                          onClick={() =>
                            setWeights({ ...weights, [m.id]: String(Math.max(0, (Number(weights[m.id]) || 0) - 1)) })
                          }
                        >
                          −
                        </button>
                        <input
                          inputMode="numeric"
                          value={weights[m.id] ?? ''}
                          onChange={(e) => setWeights({ ...weights, [m.id]: e.target.value.replace(/\D/g, '') })}
                          aria-label={t`Shares for ${m.name}`}
                        />
                        <button
                          type="button"
                          aria-label={t`One share more for ${m.name}`}
                          onClick={() => setWeights({ ...weights, [m.id]: String((Number(weights[m.id]) || 0) + 1) })}
                        >
                          +
                        </button>
                      </span>
                    ) : (
                      <input
                        inputMode="decimal"
                        value={exact[m.id] ?? ''}
                        placeholder="0"
                        onChange={(e) => setExact({ ...exact, [m.id]: e.target.value })}
                        aria-label={t`Amount for ${m.name}`}
                      />
                    )}
                  </label>
                )}
                <span className="share">{shares?.get(m.id) ? money(shares.get(m.id)!, currency) : '—'}</span>
              </li>
            ))}
          </ul>
          <p className="hint" aria-live="polite">
            {mode === 'exact' && total !== 0 && exactRemaining !== 0
              ? leftOrOver(exactRemaining, 'left to assign')
              : mode === 'itemized' && itemsRemaining !== 0
                ? leftOrOver(itemsRemaining, 'not on any item yet')
              : mode === 'percent' && percentRemaining !== 0
                ? percentRemaining > 0
                  ? `${percentText(percentRemaining)}% left to assign`
                  : `${percentText(-percentRemaining)}% too much`
                : ''}
          </p>
        </fieldset>

        <div aria-live="polite">
          {problems.length > 0 && (title || amountText) && (
            <ul className="problems">
              {[...new Set(problems)].map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
        </div>

        <button className="button primary" disabled={problems.length > 0 || unassigned}>
          {existing ? t`Save changes` : t`Add expense`}
        </button>
        {existing && (
          <button type="button" className="button danger" onClick={remove}>
            {confirmDelete ? t`Tap again to delete` : t`Delete expense`}
          </button>
        )}
      </form>
    </main>
  )
}

const itemName = (n: number) => t`Item ${n}`
const extraName = (n: number) => t`Extra ${n}`
