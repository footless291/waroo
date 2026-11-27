import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { firstKeys, groupBalances, replay, type Expense, type LedgerEvent } from '../src/index.ts'

let n = 0
const ev = (author: string, clock: number, signer: string | undefined, body: Record<string, unknown>) =>
  ({ id: `h${++n}`, author, clock, at: '2026-11-20T00:00:00Z', ...(signer ? { signer } : {}), ...body }) as LedgerEvent

const lunch: Expense = {
  id: 'lunch', title: 'Lunch', total: 2000, currency: 'JPY',
  payers: { ana: 2000 }, split: { kind: 'equal', among: ['ana', 'bob'] }, date: '2026-11-20',
}

function base(): LedgerEvent[] {
  return [
    ev('ana', 1, 'KA', { type: 'member.added', member: { id: 'ana', name: 'Ana', key: 'KA' } }),
    ev('bob', 2, 'KB', { type: 'member.added', member: { id: 'bob', name: 'Bob', key: 'KB' } }),
    ev('ana', 3, 'KA', { type: 'expense.saved', expense: lunch }),
  ]
}

describe('hostile events', () => {
  it('rejects malformed events instead of throwing', () => {
    const junk: unknown[] = [
      { ...ev('ana', 4, 'KA', { type: 'member.added' }) },
      ev('ana', 4, 'KA', { type: 'member.added', member: null }),
      ev('bob', 4, 'KB', { type: 'member.added', member: { id: 'x', name: 5 } }),
      ev('ana', 4, 'KA', { type: 'settlement.recorded', settlement: null }),
      ev('ana', 4, 'KA', { type: 'expense.saved', expense: { ...lunch, id: 'a', payers: null } }),
      ev('ana', 4, 'KA', { type: 'expense.saved', expense: { ...lunch, id: 'b', title: {} } }),
      ev('ana', 4, 'KA', { type: 'expense.saved', expense: { ...lunch, id: 'c', date: 'zzz' } }),
      ev('ana', 4, 'KA', { type: 'expense.saved', expense: { ...lunch, id: 'd', currency: 'jpy' } }),
      ev('ana', 4, 'KA', { type: 'expense.saved', expense: { ...lunch, id: 'e', split: { kind: 'magic' } } }),
      ev('ana', 4, 'KA', { type: 'expense.saved', expense: { ...lunch, id: 'f/x' } }),
      ev('ana', 4, 'KA', { type: 'expense.saved', expense: { ...lunch, id: 'g', total: 9007199254740991, payers: { ana: 9007199254740991 } } }),
      { ...ev('ana', 4, 'KA', { type: 'group.updated', name: 'x' }), clock: 'x' },
      { ...ev('ana', 4, 'KA', { type: 'group.updated', name: 'x' }), at: 'zzz' },
      null,
    ]
    const state = replay([...base(), ...(junk as LedgerEvent[])])
    assert.equal(state.rejected.length, junk.length)
    assert.equal(state.expenses.size, 1)
    assert.equal(state.clock, 3)
    assert.doesNotThrow(() => groupBalances(state))
  })

  it('won’t let a clock jump run the clock out', () => {
    const state = replay([...base(), ev('ana', 2 ** 49, 'KA', { type: 'group.updated', name: 'x' })])
    assert.equal(state.clock, 3)
    assert.equal(state.rejected.length, 1)
  })

  it('won’t let a back-dated founding event switch signatures off', () => {
    const state = replay([ev('ana', 0, undefined, { type: 'member.added', member: { id: 'ana', name: 'Ana' } }), ...base()])
    assert.equal(state.signed, true)
    assert.equal(state.members.get('ana')!.key, 'KA')
  })

  it('a phone that knows who joined rejects a back-dated join in their name', () => {
    const real = base()
    const pins = firstKeys(real, replay(real))
    const forged = ev('bob', 1, 'KX', { type: 'member.added', member: { id: 'bob', name: 'Bob', key: 'KX' } })
    // Without pins the forgery wins: that's what pins are for.
    assert.equal(replay([...real, forged]).members.get('bob')!.key, 'KX')
    assert.equal(replay([...real, forged], { pins }).members.get('bob')!.key, 'KB')
  })

  it('only the payer records a bitcoin payment, and only the people in a payment undo it', () => {
    const carol = ev('carol', 4, 'KC', { type: 'member.added', member: { id: 'carol', name: 'Carol', key: 'KC' } })
    const settlement = { id: 's1', from: 'bob', to: 'ana', amount: 1000, currency: 'JPY', method: 'bitcoin' }
    const forged = ev('carol', 5, 'KC', { type: 'settlement.recorded', settlement })
    assert.equal(replay([...base(), carol, forged]).settlements.size, 0)
    const real = ev('bob', 5, 'KB', { type: 'settlement.recorded', settlement })
    const voided = ev('carol', 6, 'KC', { type: 'settlement.voided', settlementId: 's1' })
    assert.equal(replay([...base(), carol, real, voided]).settlements.size, 1)
  })

  it('a friendship stays between two people', () => {
    const events = [
      ev('ana', 1, 'KA', { type: 'member.added', member: { id: 'ana', name: 'Ana', key: 'KA' } }),
      ev('ana', 2, 'KA', { type: 'group.updated', name: 'Ana', currency: 'JPY', kind: 'friends' }),
      ev('bob', 3, 'KB', { type: 'member.added', member: { id: 'bob', name: 'Bob', key: 'KB' } }),
      ev('cai', 4, 'KC', { type: 'member.added', member: { id: 'cai', name: 'Cai', key: 'KC' } }),
    ]
    const state = replay(events)
    assert.equal(state.kind, 'friends')
    assert.deepEqual([...state.members.keys()], ['ana', 'bob'])
  })

  it('friend lists and invites only count between friends', () => {
    const tokens = [{ t: 'a'.repeat(43), s: 'b'.repeat(86) }]
    const invite = { secret: 'c'.repeat(43), group: '0f8fad5b-d9cb-469f-a165-70867728950e', name: 'Trip', expiresAt: 1e12 }
    const group = replay([...base(), ev('ana', 4, 'KA', { type: 'friend.linked', tokens }), ev('ana', 5, 'KA', { type: 'friend.invited', ...invite })])
    assert.equal(group.friendTokens.size + group.friendInvites.length, 0)
    const friends = replay([
      ev('ana', 1, 'KA', { type: 'member.added', member: { id: 'ana', name: 'Ana', key: 'KA' } }),
      ev('ana', 2, 'KA', { type: 'group.updated', name: 'Ana', currency: 'JPY', kind: 'friends' }),
      ev('ana', 3, 'KA', { type: 'friend.linked', tokens }),
      ev('ana', 4, 'KA', { type: 'friend.invited', ...invite }),
    ])
    assert.deepEqual(friends.friendTokens.get('ana'), tokens)
    assert.equal(friends.friendInvites[0]!.name, 'Trip')
  })

  it('nobody else sets how a person they add gets paid', () => {
    const added = ev('ana', 4, 'KA', { type: 'member.added', member: { id: 'dan', name: 'Dan', receive: ['evil@example.com'] } })
    assert.equal(replay([...base(), added]).members.has('dan'), false)
  })
})
