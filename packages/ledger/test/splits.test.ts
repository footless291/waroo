import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { apportion, computeShares, validateExpense, type Expense } from '../src/index.ts'

const total = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0)

function expense(overrides: Partial<Expense>): Expense {
  return {
    id: 'e1',
    title: 'Dinner',
    total: 10000,
    currency: 'JPY',
    payers: { ana: 10000 },
    split: { kind: 'equal', among: ['ana', 'bob', 'cai'] },
    date: '2026-11-19',
    ...overrides,
  }
}

describe('apportion', () => {
  it('always adds up exactly', () => {
    for (const amount of [1, 7, 100, 9999, -10, -1, 0]) {
      for (const weights of [[1, 1, 1], [2, 1, 1], [3, 7], [1]]) {
        const parts = apportion(amount, weights)
        assert.equal(parts.reduce((a, b) => a + b, 0), amount, `${amount} by ${weights}`)
      }
    }
  })
  it('gives the extra unit by largest remainder', () => {
    assert.deepEqual(apportion(10, [1, 1, 1]), [4, 3, 3])
    assert.deepEqual(apportion(10, [1, 1, 1], 1), [3, 4, 3])
  })
  it('handles amounts too big for float products', () => {
    const big = Number.MAX_SAFE_INTEGER - 1
    assert.equal(apportion(big, [3, 7]).reduce((a, b) => a + b, 0), big)
  })
  it('rejects nonsense weights', () => {
    assert.throws(() => apportion(10, [0, 0]))
    assert.throws(() => apportion(10, [-1, 2]))
    assert.throws(() => apportion(10, []))
  })
})

describe('computeShares', () => {
  it('splits equally, ¥10,000 three ways', () => {
    const shares = computeShares(expense({}))
    assert.equal(total(shares), 10000)
    assert.deepEqual([...shares.values()].sort(), [3333, 3333, 3334])
  })

  it('does not depend on the order people were listed in', () => {
    const a = computeShares(expense({ split: { kind: 'equal', among: ['ana', 'bob', 'cai'] } }))
    const b = computeShares(expense({ split: { kind: 'equal', among: ['cai', 'ana', 'bob'] } }))
    assert.deepEqual(a, b)
  })

  it('moves the extra yen around between expenses', () => {
    const winners = new Set<string>()
    for (let i = 0; i < 30; i++) {
      const shares = computeShares(expense({ id: `e${i}` }))
      for (const [p, v] of shares) if (v === 3334) winners.add(p)
    }
    assert.equal(winners.size, 3)
  })

  it('splits by shares', () => {
    const shares = computeShares(
      expense({ total: 8000, split: { kind: 'shares', weights: { ana: 2, bob: 1, cai: 1 } } }),
    )
    assert.deepEqual(Object.fromEntries(shares), { ana: 4000, bob: 2000, cai: 2000 })
  })

  it('splits by percent and requires 100%', () => {
    const shares = computeShares(
      expense({ split: { kind: 'percent', basisPoints: { ana: 5000, bob: 2500, cai: 2500 } } }),
    )
    assert.deepEqual(Object.fromEntries(shares), { ana: 5000, bob: 2500, cai: 2500 })
    assert.throws(
      () => computeShares(expense({ split: { kind: 'percent', basisPoints: { ana: 5000 } } })),
      /100%/,
    )
  })

  it('takes exact amounts and checks the total', () => {
    const split = { kind: 'exact', amounts: { ana: 6000, bob: 4000 } } as const
    assert.deepEqual(Object.fromEntries(computeShares(expense({ split }))), {
      ana: 6000,
      bob: 4000,
    })
    assert.throws(() =>
      computeShares(expense({ split: { kind: 'exact', amounts: { ana: 1 } } })),
    )
  })

  it('applies adjustments then splits the rest equally', () => {
    // Bob had an extra ¥1,000 drink; the remaining ¥9,000 splits three ways.
    const shares = computeShares(
      expense({ split: { kind: 'adjustment', among: ['ana', 'bob', 'cai'], extras: { bob: 1000 } } }),
    )
    assert.deepEqual(Object.fromEntries(shares), { ana: 3000, bob: 4000, cai: 3000 })
  })

  it('splits itemized receipts with tax spread by subtotal', () => {
    // Ramen ¥1,000 (ana), gyoza ¥600 shared by all, beer ¥1,400 (bob + cai),
    // then a ¥300 service charge spread in proportion.
    const shares = computeShares(
      expense({
        total: 3300,
        split: {
          kind: 'itemized',
          items: [
            { label: 'ramen', amount: 1000, among: ['ana'] },
            { label: 'gyoza', amount: 600, among: ['ana', 'bob', 'cai'] },
            { label: 'beer', amount: 1400, among: ['bob', 'cai'] },
          ],
          extras: [{ label: 'service', amount: 300 }],
        },
      }),
    )
    // Subtotals: ana 1200, bob 900, cai 900 → service 120 / 90 / 90
    assert.deepEqual(Object.fromEntries(shares), { ana: 1320, bob: 990, cai: 990 })
  })

  it('supports discounts as negative extras', () => {
    const shares = computeShares(
      expense({
        total: 900,
        split: {
          kind: 'itemized',
          items: [
            { amount: 500, among: ['ana'] },
            { amount: 500, among: ['bob'] },
          ],
          extras: [{ label: 'coupon', amount: -100 }],
        },
      }),
    )
    assert.deepEqual(Object.fromEntries(shares), { ana: 450, bob: 450 })
  })

  it('handles refunds (negative totals)', () => {
    const shares = computeShares(expense({ total: -100, payers: { ana: -100 } }))
    assert.equal(total(shares), -100)
  })
})

describe('validateExpense', () => {
  const members = new Set(['ana', 'bob', 'cai'])

  it('accepts a good expense with several payers', () => {
    assert.deepEqual(validateExpense(expense({ payers: { ana: 6000, bob: 4000 } }), members), [])
  })

  it('catches payers that do not add up', () => {
    const problems = validateExpense(expense({ payers: { ana: 9000 } }), members)
    assert.match(problems.join(), /Payers paid 9000/)
  })

  it('catches strangers', () => {
    const problems = validateExpense(
      expense({ split: { kind: 'equal', among: ['ana', 'zed'] } }),
      members,
    )
    assert.match(problems.join(), /Unknown person: zed/)
  })

  it('catches fractional amounts and bad currencies', () => {
    assert.notDeepEqual(validateExpense(expense({ total: 10.5 })), [])
    assert.notDeepEqual(validateExpense(expense({ currency: 'XX!' })), [])
  })
})
