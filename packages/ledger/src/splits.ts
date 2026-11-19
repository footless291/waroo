import { apportion, hashString } from './apportion.ts'
import { assertMinor, LedgerError, minorDigits, type CurrencyCode } from './money.ts'

export type PersonId = string

/** How one expense is divided among people. All amounts are minor units. */
export type SplitMethod =
  /** Everyone listed pays the same. */
  | { kind: 'equal'; among: PersonId[] }
  /** In proportion to whole-number weights, e.g. 2:1:1. */
  | { kind: 'shares'; weights: Record<PersonId, number> }
  /** Percentages in basis points (100% = 10000), must total 10000. */
  | { kind: 'percent'; basisPoints: Record<PersonId, number> }
  /** Exact amounts that must total the expense. */
  | { kind: 'exact'; amounts: Record<PersonId, number> }
  /** Fixed extras for some people, the rest split equally among `among`. */
  | { kind: 'adjustment'; among: PersonId[]; extras: Record<PersonId, number> }
  /**
   * Line items, each split equally among whoever had it. `extras` (tax, tip,
   * service charge, or a negative discount) are spread in proportion to each
   * person's item subtotal. Items plus extras must total the expense.
   */
  | {
      kind: 'itemized'
      items: { label?: string; amount: number; among: PersonId[] }[]
      extras?: { label?: string; amount: number }[]
    }

export interface Expense {
  id: string
  title: string
  /** Total in minor units. Negative totals (refunds, income) are allowed. */
  total: number
  currency: CurrencyCode
  /** Who paid, and how much each. Must total `total`. */
  payers: Record<PersonId, number>
  split: SplitMethod
  /** ISO date the expense happened (YYYY-MM-DD). */
  date: string
}

const sum = (values: Iterable<number>) => {
  let s = 0
  for (const v of values) s += v
  return s
}

/** Sorted, de-duplicated ids, so results never depend on input order. */
const canonical = (ids: Iterable<PersonId>) => [...new Set(ids)].sort()

function equalSplit(amount: number, among: PersonId[], seed: string): Map<PersonId, number> {
  const people = canonical(among)
  if (people.length === 0) throw new LedgerError('A split needs at least one person')
  const parts = apportion(amount, people.map(() => 1), hashString(seed) % people.length)
  return new Map(people.map((p, i) => [p, parts[i] ?? 0]))
}

function weightedSplit(
  amount: number,
  weights: Record<PersonId, number>,
  seed: string,
): Map<PersonId, number> {
  const people = canonical(Object.keys(weights)).filter((p) => (weights[p] ?? 0) !== 0)
  if (people.length === 0) throw new LedgerError('A split needs at least one person')
  const parts = apportion(
    amount,
    people.map((p) => weights[p] ?? 0),
    hashString(seed) % people.length,
  )
  return new Map(people.map((p, i) => [p, parts[i] ?? 0]))
}

function addInto(target: Map<PersonId, number>, source: Map<PersonId, number>) {
  for (const [p, amount] of source) target.set(p, (target.get(p) ?? 0) + amount)
}

/**
 * The one definition of "what is each person's share of this expense".
 * Shares are whole minor units and always add up to exactly `expense.total`.
 * Throws a LedgerError if the expense is inconsistent; see validateExpense.
 */
export function computeShares(expense: Expense): Map<PersonId, number> {
  const { total, split, id } = expense
  assertMinor(total, 'total')

  switch (split.kind) {
    case 'equal':
      return equalSplit(total, split.among, id)

    case 'shares':
      return weightedSplit(total, split.weights, id)

    case 'percent': {
      const bp = sum(Object.values(split.basisPoints))
      if (bp !== 10_000) throw new LedgerError(`Percentages must total 100%, got ${bp / 100}%`)
      return weightedSplit(total, split.basisPoints, id)
    }

    case 'exact': {
      const amounts = new Map<PersonId, number>()
      for (const p of canonical(Object.keys(split.amounts))) {
        amounts.set(p, assertMinor(split.amounts[p] ?? 0))
      }
      const s = sum(amounts.values())
      if (s !== total) throw new LedgerError(`Exact amounts total ${s}, expected ${total}`)
      return amounts
    }

    case 'adjustment': {
      const extras = new Map<PersonId, number>()
      for (const p of canonical(Object.keys(split.extras))) {
        extras.set(p, assertMinor(split.extras[p] ?? 0))
      }
      const rest = total - sum(extras.values())
      const shares = equalSplit(rest, split.among, id)
      addInto(shares, extras)
      return shares
    }

    case 'itemized': {
      const shares = new Map<PersonId, number>()
      const extras = split.extras ?? []
      const itemsTotal = sum(split.items.map((i) => assertMinor(i.amount, 'item amount')))
      const extrasTotal = sum(extras.map((e) => assertMinor(e.amount, 'extra amount')))
      if (itemsTotal + extrasTotal !== total) {
        throw new LedgerError(
          `Items (${itemsTotal}) and extras (${extrasTotal}) must total ${total}`,
        )
      }
      split.items.forEach((item, index) => {
        addInto(shares, equalSplit(item.amount, item.among, `${id}#item${index}`))
      })
      if (extras.length > 0) {
        // Spread extras by item subtotal. Weights must be non-negative, so a
        // bill whose items net to zero or less can't carry proportional extras.
        const subtotals = Object.fromEntries(shares)
        if (Object.values(subtotals).some((v) => v < 0) || itemsTotal <= 0) {
          throw new LedgerError('Extras need items that total more than zero')
        }
        extras.forEach((extra, index) => {
          addInto(shares, weightedSplit(extra.amount, subtotals, `${id}#extra${index}`))
        })
      }
      return shares
    }
  }
}

/**
 * Returns human-readable problems with an expense, or [] if it is valid.
 * Checks everything computeShares needs, plus the payers and the currency.
 */
export function validateExpense(expense: Expense, members?: ReadonlySet<PersonId>): string[] {
  const problems: string[] = []
  try {
    minorDigits(expense.currency)
  } catch (e) {
    problems.push((e as Error).message)
    return problems
  }
  if (!Number.isSafeInteger(expense.total)) problems.push('Total must be whole minor units')

  const payerIds = Object.keys(expense.payers)
  if (payerIds.length === 0) problems.push('Someone has to have paid')
  const paid = Object.values(expense.payers)
  if (paid.some((v) => !Number.isSafeInteger(v))) {
    problems.push('Payer amounts must be whole minor units')
  } else if (sum(paid) !== expense.total) {
    problems.push(`Payers paid ${sum(paid)}, but the total is ${expense.total}`)
  }

  let shares: Map<PersonId, number> | undefined
  try {
    shares = computeShares(expense)
  } catch (e) {
    problems.push((e as Error).message)
  }

  if (members) {
    const people = new Set([...payerIds, ...(shares?.keys() ?? [])])
    for (const p of people) if (!members.has(p)) problems.push(`Unknown person: ${p}`)
  }
  return problems
}
