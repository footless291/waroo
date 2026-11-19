import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { describe, it } from 'node:test'
import {
  computeBalances,
  suggestTransfers,
  verifyPreimage,
  type Expense,
  type Settlement,
} from '../src/index.ts'

const dinner: Expense = {
  id: 'dinner',
  title: 'Dinner',
  total: 9000,
  currency: 'JPY',
  payers: { ana: 9000 },
  split: { kind: 'equal', among: ['ana', 'bob', 'cai'] },
  date: '2026-11-19',
}

const taxi: Expense = {
  id: 'taxi',
  title: 'Taxi',
  total: 3000,
  currency: 'JPY',
  payers: { bob: 3000 },
  split: { kind: 'equal', among: ['ana', 'bob', 'cai'] },
  date: '2026-11-19',
}

const coffee: Expense = {
  id: 'coffee',
  title: 'Coffee in Seoul',
  total: 12000,
  currency: 'KRW',
  payers: { cai: 12000 },
  split: { kind: 'equal', among: ['ana', 'cai'] },
  date: '2026-11-20',
}

describe('computeBalances', () => {
  it('nets payments against shares', () => {
    const b = computeBalances([dinner, taxi]).get('JPY')!
    assert.deepEqual(Object.fromEntries(b), { ana: 5000, bob: -1000, cai: -4000 })
  })

  it('keeps each currency separate and every currency sums to zero', () => {
    const balances = computeBalances([dinner, taxi, coffee])
    assert.deepEqual(Object.fromEntries(balances.get('KRW')!), { ana: -6000, cai: 6000 })
    for (const byPerson of balances.values()) {
      assert.equal([...byPerson.values()].reduce((a, b) => a + b, 0), 0)
    }
  })

  it('applies settlements and drops people who are square', () => {
    const settlement: Settlement = {
      id: 's1',
      from: 'cai',
      to: 'ana',
      amount: 4000,
      currency: 'JPY',
      method: 'cash',
    }
    const b = computeBalances([dinner, taxi], [settlement]).get('JPY')!
    assert.deepEqual(Object.fromEntries(b), { ana: 1000, bob: -1000 })
  })

  it('rejects bad settlements', () => {
    const bad = { id: 's', from: 'a', to: 'a', amount: 1, currency: 'JPY', method: 'cash' } as const
    assert.throws(() => computeBalances([], [bad]))
    assert.throws(() => computeBalances([], [{ ...bad, to: 'b', amount: 0 }]))
  })
})

describe('suggestTransfers', () => {
  it('clears every balance', () => {
    const balances = computeBalances([dinner, taxi, coffee])
    const transfers = suggestTransfers(balances)
    const settlements = transfers.map((t, i) => ({ ...t, id: `t${i}`, method: 'cash' as const }))
    assert.equal(computeBalances([dinner, taxi, coffee], settlements).size, 0)
  })

  it('needs at most n - 1 transfers per currency', () => {
    const transfers = suggestTransfers(computeBalances([dinner, taxi]))
    assert.deepEqual(transfers, [
      { from: 'cai', to: 'ana', amount: 4000, currency: 'JPY' },
      { from: 'bob', to: 'ana', amount: 1000, currency: 'JPY' },
    ])
  })
})

describe('verifyPreimage', () => {
  it('accepts the real preimage and rejects others', async () => {
    const preimage = 'ab'.repeat(32)
    const hash = createHash('sha256').update(Buffer.from(preimage, 'hex')).digest('hex')
    assert.equal(await verifyPreimage(hash, preimage), true)
    assert.equal(await verifyPreimage(hash, 'cd'.repeat(32)), false)
    await assert.rejects(verifyPreimage(hash, 'not hex'))
  })
})
