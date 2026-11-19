/**
 * A group's history is an append-only log of events. Every device holds the
 * whole log and rebuilds the same state from it, in the same order, whatever
 * order the events arrived in. The relay only ever sees these events
 * encrypted; signing and encryption happen in the transport layer, which
 * hands this module events whose author it has already verified.
 *
 * Nothing is ever edited in place: an edit is a new version of an expense, a
 * deletion is a tombstone, and a settlement can only be voided. That gives
 * every group a complete audit trail.
 */

import { computeBalances, type Balances, type Settlement } from './balances.ts'
import { minorDigits } from './money.ts'
import { validateExpense, type Expense, type PersonId } from './splits.ts'

function isKnownCurrency(code: string): boolean {
  try {
    minorDigits(code)
    return true
  } catch {
    return false
  }
}

export interface Member {
  id: PersonId
  name: string
}

interface EventBase {
  /** Globally unique, e.g. a random UUID. */
  id: string
  /** Member who wrote the event. Verified by the transport's signature check. */
  author: PersonId
  /**
   * Lamport clock: one more than the highest clock the author had seen.
   * Gives a total order that respects causality.
   */
  clock: number
  /** Author's wall-clock time, ISO. For display only, never for ordering. */
  at: string
}

export type LedgerEvent = EventBase &
  (
    | { type: 'member.added'; member: Member }
    | { type: 'member.renamed'; memberId: PersonId; name: string }
    /**
     * Creates or edits an expense. `basedOn` is the id of the event holding
     * the version this edit started from (absent for a new expense). If the
     * expense has moved on since, two people edited it concurrently.
     */
    | { type: 'expense.saved'; expense: Expense; basedOn?: string }
    | { type: 'expense.deleted'; expenseId: string; basedOn: string }
    | { type: 'settlement.recorded'; settlement: Settlement }
    | { type: 'settlement.voided'; settlementId: string; reason?: string }
  )

/** Two people changed the same expense without seeing each other's change. */
export interface Conflict {
  expenseId: string
  /** Event whose version is now current. */
  kept: string
  /** Event whose version was overwritten (or that tried to revive a deleted expense). */
  overwritten: string
}

/** An event that was well-formed but not allowed, with the reason. */
export interface Rejection {
  eventId: string
  reason: string
}

export interface GroupState {
  members: Map<PersonId, Member>
  expenses: Map<string, Expense>
  settlements: Map<string, Settlement>
  /** Expense id → event id of its current version (or its deletion). */
  heads: Map<string, string>
  deleted: Set<string>
  conflicts: Conflict[]
  rejected: Rejection[]
  /** Highest clock seen; a device's next event uses this + 1. */
  clock: number
}

/**
 * Total order: clock, then author, then event id. Every device sorts the same
 * events identically. Duplicate deliveries (same id) are dropped.
 */
export function orderEvents(events: Iterable<LedgerEvent>): LedgerEvent[] {
  const unique = new Map<string, LedgerEvent>()
  for (const e of events) if (!unique.has(e.id)) unique.set(e.id, e)
  return [...unique.values()].sort(
    (a, b) =>
      a.clock - b.clock ||
      (a.author < b.author ? -1 : a.author > b.author ? 1 : 0) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  )
}

export function emptyState(): GroupState {
  return {
    members: new Map(),
    expenses: new Map(),
    settlements: new Map(),
    heads: new Map(),
    deleted: new Set(),
    conflicts: [],
    rejected: [],
    clock: 0,
  }
}

/**
 * Rebuilds a group's state from its full log. Pure and deterministic: the same
 * set of events always produces the same state, on every device.
 *
 * Rules:
 * - Only members may write, except the very first `member.added`, which
 *   founds the group.
 * - Concurrent edits to one expense: the later event in the total order wins,
 *   and the overwritten one is reported in `conflicts` so the app can show it.
 * - A deletion beats a concurrent edit. The edit is reported as a conflict.
 * - Invalid expenses and settlements are rejected, never thrown.
 */
export function replay(events: Iterable<LedgerEvent>): GroupState {
  const state = emptyState()
  const reject = (e: LedgerEvent, reason: string) =>
    state.rejected.push({ eventId: e.id, reason })

  for (const e of orderEvents(events)) {
    state.clock = Math.max(state.clock, e.clock)

    const founding = state.members.size === 0 && e.type === 'member.added'
    if (!founding && !state.members.has(e.author)) {
      reject(e, 'Author is not a member of this group')
      continue
    }

    switch (e.type) {
      case 'member.added':
        if (state.members.has(e.member.id)) reject(e, 'Already a member')
        else if (founding && e.member.id !== e.author) reject(e, 'The founder must add themselves')
        else state.members.set(e.member.id, { ...e.member })
        break

      case 'member.renamed': {
        const member = state.members.get(e.memberId)
        if (!member) reject(e, 'No such member')
        else member.name = e.name
        break
      }

      case 'expense.saved': {
        const { expense } = e
        const problems = validateExpense(expense, new Set(state.members.keys()))
        if (problems.length > 0) {
          reject(e, problems.join('; '))
          break
        }
        const head = state.heads.get(expense.id)
        if (state.deleted.has(expense.id)) {
          state.conflicts.push({ expenseId: expense.id, kept: head!, overwritten: e.id })
          break
        }
        if (head !== undefined && e.basedOn !== head) {
          state.conflicts.push({ expenseId: expense.id, kept: e.id, overwritten: head })
        }
        state.expenses.set(expense.id, expense)
        state.heads.set(expense.id, e.id)
        break
      }

      case 'expense.deleted': {
        const head = state.heads.get(e.expenseId)
        if (head === undefined) {
          reject(e, 'No such expense')
          break
        }
        if (state.deleted.has(e.expenseId)) break // deleted twice: harmless
        if (e.basedOn !== head) {
          state.conflicts.push({ expenseId: e.expenseId, kept: e.id, overwritten: head })
        }
        state.expenses.delete(e.expenseId)
        state.deleted.add(e.expenseId)
        state.heads.set(e.expenseId, e.id)
        break
      }

      case 'settlement.recorded': {
        const s = e.settlement
        if (state.settlements.has(s.id)) reject(e, 'Settlement already recorded')
        else if (!state.members.has(s.from) || !state.members.has(s.to)) {
          reject(e, 'Settlement between unknown people')
        } else if (!Number.isSafeInteger(s.amount) || s.amount <= 0) {
          reject(e, 'Settlement amount must be a positive whole number of minor units')
        } else if (s.from === s.to) reject(e, 'Cannot settle with yourself')
        else if (!isKnownCurrency(s.currency)) reject(e, `Unknown currency code: ${s.currency}`)
        else state.settlements.set(s.id, s)
        break
      }

      case 'settlement.voided':
        if (!state.settlements.delete(e.settlementId)) reject(e, 'No such settlement')
        break
    }
  }
  return state
}

/** Balances for a replayed group. */
export function groupBalances(state: GroupState): Balances {
  return computeBalances(state.expenses.values(), state.settlements.values())
}
