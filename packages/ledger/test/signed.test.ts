import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { canonicalJson, replay, signingBytes, type Expense, type LedgerEvent } from '../src/index.ts'

let n = 0
const ev = (author: string, clock: number, signer: string | undefined, body: Record<string, unknown>) =>
  ({ id: `ev${++n}`, author, clock, at: '2026-11-20T00:00:00Z', ...(signer ? { signer } : {}), ...body }) as LedgerEvent

const lunch: Expense = {
  id: 'lunch',
  title: 'Lunch',
  total: 2000,
  currency: 'JPY',
  payers: { ana: 2000 },
  split: { kind: 'equal', among: ['ana', 'bob'] },
  date: '2026-11-20',
}

/** Ana founds a signed group and adds Bob, who hasn't joined on a phone yet. */
function base(): LedgerEvent[] {
  return [
    ev('ana', 1, 'KA', { type: 'member.added', member: { id: 'ana', name: 'Ana', key: 'KA' } }),
    ev('ana', 2, 'KA', { type: 'member.added', member: { id: 'bob', name: 'Bob' } }),
    ev('ana', 3, 'KA', { type: 'group.updated', name: 'Okinawa trip', currency: 'JPY' }),
    ev('ana', 4, 'KA', { type: 'expense.saved', expense: lunch }),
  ]
}

describe('signed groups', () => {
  it('becomes signed when the founder joins with a key', () => {
    const state = replay(base())
    assert.equal(state.signed, true)
    assert.equal(state.name, 'Okinawa trip')
    assert.equal(state.currency, 'JPY')
    assert.deepEqual(state.rejected, [])
  })

  it('rejects events signed with the wrong key', () => {
    const forged = ev('ana', 5, 'KX', { type: 'expense.deleted', expenseId: 'lunch', basedOn: 'x' })
    const state = replay([...base(), forged])
    assert.equal(state.expenses.size, 1)
    assert.match(state.rejected[0]!.reason, /wrong key/)
  })

  it('rejects unsigned events in a signed group', () => {
    const unsigned = ev('ana', 5, undefined, { type: 'group.updated', name: 'Hacked' })
    const state = replay([...base(), unsigned])
    assert.equal(state.name, 'Okinawa trip')
  })

  it('lets a phone claim an unclaimed member, then write as them', () => {
    const claim = ev('bob', 5, 'KB', { type: 'member.claimed', memberId: 'bob', key: 'KB' })
    const pay = ev('bob', 6, 'KB', {
      type: 'settlement.recorded',
      settlement: { id: 's1', from: 'bob', to: 'ana', amount: 1000, currency: 'JPY', method: 'cash' },
    })
    const state = replay([...base(), claim, pay])
    assert.equal(state.members.get('bob')!.key, 'KB')
    assert.equal(state.settlements.size, 1)
    assert.deepEqual(state.rejected, [])
  })

  it('stops an unclaimed member from writing', () => {
    const early = ev('bob', 5, 'KB', { type: 'group.updated', name: 'Bob’s trip' })
    assert.match(replay([...base(), early]).rejected[0]!.reason, /not joined on a phone/)
  })

  it('lets only the first claim win', () => {
    const first = ev('bob', 5, 'KB', { type: 'member.claimed', memberId: 'bob', key: 'KB' })
    const second = ev('bob', 6, 'KZ', { type: 'member.claimed', memberId: 'bob', key: 'KZ' })
    const state = replay([...base(), second, first])
    assert.equal(state.members.get('bob')!.key, 'KB')
    assert.match(state.rejected[0]!.reason, /already joined/)
  })

  it('rejects a claim signed with a different key than it claims', () => {
    const bad = ev('bob', 5, 'KZ', { type: 'member.claimed', memberId: 'bob', key: 'KB' })
    const state = replay([...base(), bad])
    assert.equal(state.members.get('bob')!.key, undefined)
  })

  it('lets a new person add themselves with their own key', () => {
    const join = ev('dee', 5, 'KD', { type: 'member.added', member: { id: 'dee', name: 'Dee', key: 'KD' } })
    const state = replay([...base(), join])
    assert.equal(state.members.get('dee')!.key, 'KD')
  })

  it('stops anyone adding a key on someone else’s behalf', () => {
    const sneaky = ev('ana', 5, 'KA', { type: 'member.added', member: { id: 'eve', name: 'Eve', key: 'KE' } })
    assert.match(replay([...base(), sneaky]).rejected[0]!.reason, /themselves/)
  })

  it('leaves unsigned groups working as before', () => {
    const state = replay([
      ev('ana', 1, undefined, { type: 'member.added', member: { id: 'ana', name: 'Ana' } }),
      ev('ana', 2, undefined, { type: 'member.added', member: { id: 'bob', name: 'Bob' } }),
      ev('ana', 3, undefined, { type: 'expense.saved', expense: lunch }),
    ])
    assert.equal(state.signed, false)
    assert.equal(state.expenses.size, 1)
  })

  it('refuses claims in unsigned groups', () => {
    const state = replay([
      ev('ana', 1, undefined, { type: 'member.added', member: { id: 'ana', name: 'Ana' } }),
      ev('ana', 2, undefined, { type: 'member.added', member: { id: 'bob', name: 'Bob' } }),
      ev('bob', 3, 'KB', { type: 'member.claimed', memberId: 'bob', key: 'KB' }),
    ])
    assert.equal(state.members.get('bob')!.key, undefined)
  })
})

describe('canonical signing bytes', () => {
  it('sorts keys and ignores the transport’s signer', () => {
    assert.equal(canonicalJson({ b: 1, a: [2, { d: 3, c: undefined }] }), '{"a":[2,{"d":3}],"b":1}')
    const e = base()[0]!
    const withSigner = new TextDecoder().decode(signingBytes(e))
    const without = new TextDecoder().decode(signingBytes({ ...e, signer: 'other' }))
    assert.equal(withSigner, without)
    assert.ok(!withSigner.includes('signer'))
  })
})

describe('Lightning addresses', () => {
  const claimBob = () => ev('bob', 5, 'KB', { type: 'member.claimed', memberId: 'bob', key: 'KB' })

  it('lets a member set and clear their own address', () => {
    const set = ev('bob', 6, 'KB', { type: 'member.updated', memberId: 'bob', lightningAddress: 'Bob@Example.com' })
    let state = replay([...base(), claimBob(), set])
    assert.equal(state.members.get('bob')!.lightningAddress, 'bob@example.com')
    const clear = ev('bob', 7, 'KB', { type: 'member.updated', memberId: 'bob', lightningAddress: '' })
    state = replay([...base(), claimBob(), set, clear])
    assert.equal(state.members.get('bob')!.lightningAddress, undefined)
  })

  it('stops anyone setting someone else’s address', () => {
    const hijack = ev('ana', 6, 'KA', { type: 'member.updated', memberId: 'bob', lightningAddress: 'ana@example.com' })
    const state = replay([...base(), claimBob(), hijack])
    assert.equal(state.members.get('bob')!.lightningAddress, undefined)
    assert.match(state.rejected[0]!.reason, /themselves/)
  })

  it('stops an address being slipped in when adding someone', () => {
    const sneaky = ev('ana', 5, 'KA', {
      type: 'member.added',
      member: { id: 'cai', name: 'Cai', lightningAddress: 'ana@example.com' },
    })
    assert.match(replay([...base(), sneaky]).rejected[0]!.reason, /themselves/)
  })

  it('rejects things that aren’t addresses', () => {
    for (const bad of ['bob', 'bob@', '@example.com', 'bob@localhost', 'bob@exa mple.com', 'lnurl1dp68gurn8ghj7']) {
      const e = ev('ana', 5, 'KA', { type: 'member.updated', memberId: 'ana', lightningAddress: bad })
      assert.equal(replay([...base(), e]).members.get('ana')!.lightningAddress, undefined, bad)
    }
  })
})
