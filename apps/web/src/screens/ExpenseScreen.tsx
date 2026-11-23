import {
  computeShares,
  parseAmount,
  validateExpense,
  type Expense,
  type GroupState,
  type SplitMethod,
} from '@footless/ledger'
import { useState, type FormEvent } from 'react'
import { Header } from '../components/Header.tsx'
import { Segmented } from '../components/Segmented.tsx'
import { append, newId, type GroupMeta } from '../lib/db.ts'
import { CURRENCIES, money, today, toInput } from '../lib/format.ts'
import { go, useGroup } from '../lib/hooks.ts'

type Mode = 'equal' | 'shares' | 'percent' | 'exact'

const MODES: { value: Mode; label: string }[] = [
  { value: 'equal', label: 'Equally' },
  { value: 'shares', label: 'Shares' },
  { value: 'percent', label: 'Percent' },
  { value: 'exact', label: 'Exact' },
]

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
        <Header title="Expense" back={`/g/${groupId}/expenses`} />
        <p className="empty">This expense was deleted.</p>
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
  // People who left only appear on expenses they were already part of.
  const involved = existing ? new Set([...Object.keys(existing.payers), ...computeShares(existing).keys()]) : new Set<string>()
  const members = [...state.members.values()].filter((m) => !m.left || involved.has(m.id))
  const allIds = members.map((m) => m.id)
  const initial = existing?.split

  const [title, setTitle] = useState(existing?.title ?? '')
  const [currency, setCurrency] = useState(existing?.currency ?? meta.currency)
  const [amountText, setAmountText] = useState(existing ? toInput(existing.total, existing.currency) : '')
  const [date, setDate] = useState(existing?.date ?? today())
  const [payer, setPayer] = useState(existing ? Object.keys(existing.payers)[0]! : meta.meId)
  const [mode, setMode] = useState<Mode>(
    initial?.kind === 'shares' || initial?.kind === 'exact' || initial?.kind === 'percent' ? initial.kind : 'equal',
  )
  const [included, setIncluded] = useState<Set<string>>(
    new Set(initial?.kind === 'equal' ? initial.among : allIds),
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
      problems.push(`${what}: ${(e as Error).message}`)
      return 0
    }
  }
  const total = parse(amountText, 'Amount')
  let split: SplitMethod
  if (mode === 'equal') split = { kind: 'equal', among: [...included] }
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
            problems.push(`${state.members.get(id)!.name}: use a percentage like 25 or 12.5`)
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
    payers: { [payer]: total },
    split,
    date,
  }
  if (!expense.title) problems.push('Give it a name')
  if (total === 0) problems.push('Enter an amount')
  else {
    problems.push(
      ...validateExpense(expense, new Set(allIds)).filter(
        // The "left to assign" hint below already says this, in plain money.
        (p) =>
          !(mode === 'exact' && p.startsWith('Exact amounts total')) &&
          !(mode === 'percent' && p.startsWith('Percentages must total')),
      ),
    )
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
  const unassigned = exactRemaining !== 0 || percentRemaining !== 0

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

  const nameOf = (id: string) => (id === meta.meId ? `${state.members.get(id)?.name} (you)` : state.members.get(id)?.name)

  return (
    <main className="screen">
      <Header title={existing ? 'Edit expense' : 'Add expense'} back={`/g/${meta.id}/expenses`} />
      <form className="form" onSubmit={save}>
        <label className="field">
          <span>What for</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Izakaya dinner" />
        </label>
        <div className="field-row">
          <label className="field grow">
            <span>Amount</span>
            <input
              className="amount-input"
              value={amountText}
              onChange={(e) => setAmountText(e.target.value)}
              inputMode="decimal"
              placeholder="0"
            />
          </label>
          <label className="field">
            <span>Currency</span>
            <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {[...new Set([meta.currency, ...CURRENCIES])].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="field-row">
          <label className="field grow">
            <span>Paid by</span>
            <select value={payer} onChange={(e) => setPayer(e.target.value)}>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {nameOf(m.id)}
                </option>
              ))}
            </select>
          </label>
          <label className="field grow">
            <span>Date</span>
            <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
          </label>
        </div>

        <fieldset className="field">
          <legend>Split</legend>
          <Segmented label="Split method" options={MODES} value={mode} onChange={setMode} />
          <ul className="split-list">
            {members.map((m) => (
              <li key={m.id}>
                {mode === 'equal' ? (
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
                          aria-label={`Percent for ${m.name}`}
                        />
                        <span aria-hidden="true">%</span>
                      </span>
                    ) : mode === 'shares' ? (
                      <span className="stepper">
                        <button
                          type="button"
                          aria-label={`One share fewer for ${m.name}`}
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
                          aria-label={`Shares for ${m.name}`}
                        />
                        <button
                          type="button"
                          aria-label={`One share more for ${m.name}`}
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
                        aria-label={`Amount for ${m.name}`}
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
              ? exactRemaining > 0
                ? `${money(exactRemaining, currency)} left to assign`
                : `${money(-exactRemaining, currency)} too much`
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
          {existing ? 'Save changes' : 'Add expense'}
        </button>
        {existing && (
          <button type="button" className="button danger" onClick={remove}>
            {confirmDelete ? 'Tap again to delete' : 'Delete expense'}
          </button>
        )}
      </form>
    </main>
  )
}
