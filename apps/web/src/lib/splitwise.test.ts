import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { groupBalances, replay, type LedgerEvent } from '@waroo/ledger'
import { convert, parseSplitwise } from './splitwise.ts'

// Shaped like a real friend export: a no-effect row, half-yen shares, dollars, payments both ways.
const csv = `Note: does not include group expenses

Date,Description,Category,Cost,Currency,Ana,Bob

2024-06-01,Movie,Movies,6000.00,JPY,0.00,0.00
2024-06-02,Shinkansen,Bus/train,10000.00,JPY,-10000.00,10000.00
2024-06-03,Hotel,Hotel,8000.00,JPY,8000.00,-8000.00
2024-06-04,Groceries,Groceries,5645.00,JPY,-2822.50,2822.50
2024-06-05,Ana paid Bob,Payment,4822.50,JPY,4822.50,-4822.50
2024-06-06,"Gas, for the car",Gas/fuel,7500.00,JPY,-3750.00,3750.00
2024-06-07,Flights,Plane,1856.00,USD,1856.00,-1856.00
2024-06-08,Bob paid Ana,Payment,1856.00,USD,-1856.00,1856.00

2024-06-09,Total balance, , ,JPY,-3750.00,3750.00
2024-06-09,Total balance, , ,USD,0.00,0.00
`

describe('Splitwise import', () => {
  it('reads a friend export', () => {
    const data = parseSplitwise(csv)
    assert.deepEqual(data.people, ['Ana', 'Bob'])
    assert.equal(data.rows.length, 8)
    assert.equal(data.totals.JPY!.Bob, 3750)
    assert.equal(data.rows[5]!.description, 'Gas, for the car')
  })

  it('rebuilds every row so the balance matches Splitwise to the yen', async () => {
    const data = parseSplitwise(csv)
    const imported = await convert(data, { Ana: 'a', Bob: 'b' })
    let clock = 0
    const ev = (body: object) => ({ id: `x${++clock}`, author: 'a', clock, at: '2026-11-28T00:00:00Z', ...body }) as LedgerEvent
    const events = [
      ev({ type: 'member.added', member: { id: 'a', name: 'Ana' } }),
      ev({ type: 'member.added', member: { id: 'b', name: 'Bob' } }),
      ...imported.map((i) => (i.kind === 'expense' ? ev({ type: 'expense.saved', expense: i.expense }) : ev({ type: 'settlement.recorded', settlement: i.settlement }))),
    ]
    const state = replay(events)
    assert.deepEqual(state.rejected, [])
    const balances = groupBalances(state)
    assert.equal(balances.get('JPY')!.get('a'), -3750)
    assert.equal(balances.get('JPY')!.get('b'), 3750)
    assert.equal(balances.get('USD')?.get('a') ?? 0, 0)
    // The movie, with no effect on anyone, still comes in, as each paying their own part.
    const movie = imported.find((i) => i.row.description === 'Movie')!
    assert.equal(movie.kind, 'expense')
    // A payment comes in as a payment.
    assert.equal(imported.filter((i) => i.kind === 'payment').length, 2)
  })

  it('the same file gives the same ids', async () => {
    const a = await convert(parseSplitwise(csv), { Ana: 'a', Bob: 'b' })
    const b = await convert(parseSplitwise(csv), { Ana: 'a', Bob: 'b' })
    assert.deepEqual(a.map((x) => (x.kind === 'expense' ? x.expense.id : x.settlement.id)), b.map((x) => (x.kind === 'expense' ? x.expense.id : x.settlement.id)))
  })

  it('refuses something that isn’t a Splitwise export', () => {
    assert.throws(() => parseSplitwise('a,b,c\n1,2,3'))
  })
})
