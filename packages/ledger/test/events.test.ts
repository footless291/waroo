import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { groupBalances, replay, type Expense, type LedgerEvent } from '../src/index.ts'

let n = 0
const meta = (author: string, clock: number) => ({
  id: `ev${++n}`,
  author,
  clock,
  at: '2026-11-19T12:00:00Z',
})

const lunch = (total: number): Expense => ({
  id: 'lunch',
  title: 'Lunch',
  total,
  currency: 'JPY',
  payers: { ana: total },
  split: { kind: 'equal', among: ['ana', 'bob'] },
  date: '2026-11-19',
})

function founded(): LedgerEvent[] {
  return [
    { ...meta('ana', 1), type: 'member.added', member: { id: 'ana', name: 'Ana' } },
    { ...meta('ana', 2), type: 'member.added', member: { id: 'bob', name: 'Bob' } },
  ]
}

function shuffled<T>(items: T[], seed: number): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    seed = (seed * 1103515245 + 12345) % 2 ** 31
    const j = seed % (i + 1)
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  return out
}

describe('replay', () => {
  it('reaches the same state whatever order events arrive in', () => {
    const events: LedgerEvent[] = [
      ...founded(),
      { ...meta('ana', 3), type: 'expense.saved', expense: lunch(2000) },
      {
        ...meta('bob', 4),
        type: 'settlement.recorded',
        settlement: { id: 's1', from: 'bob', to: 'ana', amount: 500, currency: 'JPY', method: 'cash' },
      },
    ]
    const expected = groupBalances(replay(events))
    for (let seed = 1; seed < 20; seed++) {
      assert.deepEqual(groupBalances(replay(shuffled(events, seed))), expected)
    }
    assert.deepEqual(Object.fromEntries(expected.get('JPY')!), { ana: 500, bob: -500 })
  })

  it('ignores duplicate deliveries', () => {
    const events = [...founded(), { ...meta('ana', 3), type: 'expense.saved', expense: lunch(2000) } as LedgerEvent]
    const state = replay([...events, ...events])
    assert.equal(state.expenses.size, 1)
    assert.deepEqual(state.rejected, [])
  })

  it('rejects writes from non-members', () => {
    const intruder: LedgerEvent = { ...meta('eve', 3), type: 'expense.saved', expense: lunch(1) }
    const state = replay([...founded(), intruder])
    assert.equal(state.expenses.size, 0)
    assert.match(state.rejected[0]!.reason, /not a member/)
  })

  it('applies a normal edit with no conflict', () => {
    const create: LedgerEvent = { ...meta('ana', 3), type: 'expense.saved', expense: lunch(2000) }
    const edit: LedgerEvent = {
      ...meta('bob', 4),
      type: 'expense.saved',
      expense: lunch(2400),
      basedOn: create.id,
    }
    const state = replay([...founded(), create, edit])
    assert.equal(state.expenses.get('lunch')!.total, 2400)
    assert.deepEqual(state.conflicts, [])
  })

  it('resolves concurrent edits deterministically and reports the conflict', () => {
    const create: LedgerEvent = { ...meta('ana', 3), type: 'expense.saved', expense: lunch(2000) }
    // Both edit version `create` without seeing each other's edit.
    const anaEdit: LedgerEvent = { ...meta('ana', 4), type: 'expense.saved', expense: lunch(2200), basedOn: create.id }
    const bobEdit: LedgerEvent = { ...meta('bob', 4), type: 'expense.saved', expense: lunch(2600), basedOn: create.id }
    for (const order of [[anaEdit, bobEdit], [bobEdit, anaEdit]]) {
      const state = replay([...founded(), create, ...order])
      // Same clock: author "bob" sorts after "ana", so Bob's version wins.
      assert.equal(state.expenses.get('lunch')!.total, 2600)
      assert.deepEqual(state.conflicts, [{ expenseId: 'lunch', kept: bobEdit.id, overwritten: anaEdit.id }])
    }
  })

  it('lets a deletion beat a concurrent edit', () => {
    const create: LedgerEvent = { ...meta('ana', 3), type: 'expense.saved', expense: lunch(2000) }
    const del: LedgerEvent = { ...meta('ana', 4), type: 'expense.deleted', expenseId: 'lunch', basedOn: create.id }
    const edit: LedgerEvent = { ...meta('bob', 5), type: 'expense.saved', expense: lunch(9999), basedOn: create.id }
    const state = replay([...founded(), create, del, edit])
    assert.equal(state.expenses.size, 0)
    assert.deepEqual(state.conflicts, [{ expenseId: 'lunch', kept: del.id, overwritten: edit.id }])
  })

  it('rejects invalid expenses instead of throwing', () => {
    const bad: LedgerEvent = {
      ...meta('ana', 3),
      type: 'expense.saved',
      expense: { ...lunch(2000), payers: { ana: 1 } },
    }
    const state = replay([...founded(), bad])
    assert.equal(state.expenses.size, 0)
    assert.match(state.rejected[0]!.reason, /Payers paid 1/)
  })

  it('voids settlements', () => {
    const settlement = { id: 's1', from: 'bob', to: 'ana', amount: 500, currency: 'JPY', method: 'bank' } as const
    const state = replay([
      ...founded(),
      { ...meta('ana', 3), type: 'expense.saved', expense: lunch(2000) },
      { ...meta('bob', 4), type: 'settlement.recorded', settlement },
      { ...meta('bob', 5), type: 'settlement.voided', settlementId: 's1', reason: 'Typo' },
    ])
    assert.deepEqual(Object.fromEntries(groupBalances(state).get('JPY')!), { ana: 1000, bob: -1000 })
  })

  it('rejects settlements in unknown currencies', () => {
    const state = replay([
      ...founded(),
      {
        ...meta('bob', 3),
        type: 'settlement.recorded',
        settlement: { id: 's1', from: 'bob', to: 'ana', amount: 5, currency: 'XX!', method: 'cash' },
      },
    ])
    assert.equal(state.settlements.size, 0)
    assert.match(state.rejected[0]!.reason, /Unknown currency/)
  })

  it('tracks the highest clock for the next event', () => {
    assert.equal(replay(founded()).clock, 2)
  })
})
