import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { canonicalJson, receiveAddresses, replay, signingBytes, type Expense, type LedgerEvent } from '../src/index.ts'

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

describe('moving to a new phone', () => {
  const claimed = () => [...base(), ev('bob', 5, 'KB', { type: 'member.claimed', memberId: 'bob', key: 'KB' })]
  const rename = (signer: string, clock: number) =>
    ev('bob', clock, signer, { type: 'member.renamed', memberId: 'bob', name: `Bob ${clock}` })

  it('hands a member over to the new phone’s key', () => {
    const move = ev('bob', 6, 'KB', { type: 'member.rekeyed', memberId: 'bob', key: 'KB2' })
    const state = replay([...claimed(), move, rename('KB2', 7)])
    assert.equal(state.members.get('bob')!.key, 'KB2')
    assert.equal(state.members.get('bob')!.name, 'Bob 7')
    assert.deepEqual(state.rejected, [])
  })

  it('stops the old phone writing afterwards, but keeps what it wrote before', () => {
    const before = rename('KB', 6)
    const move = ev('bob', 7, 'KB', { type: 'member.rekeyed', memberId: 'bob', key: 'KB2' })
    const after = rename('KB', 8)
    const state = replay([...claimed(), before, move, after])
    assert.equal(state.members.get('bob')!.name, 'Bob 6')
    assert.equal(state.rejected.length, 1)
    assert.match(state.rejected[0]!.reason, /wrong key/)
  })

  it('can only be done with the member’s current key', () => {
    const hijack = ev('bob', 6, 'KX', { type: 'member.rekeyed', memberId: 'bob', key: 'KX' })
    assert.equal(replay([...claimed(), hijack]).members.get('bob')!.key, 'KB')
  })

  it('can’t move someone else', () => {
    const move = ev('ana', 6, 'KA', { type: 'member.rekeyed', memberId: 'bob', key: 'KA2' })
    const state = replay([...claimed(), move])
    assert.equal(state.members.get('bob')!.key, 'KB')
    assert.match(state.rejected[0]!.reason, /themselves/)
  })

  it('can’t take over another member’s key', () => {
    const move = ev('bob', 6, 'KB', { type: 'member.rekeyed', memberId: 'bob', key: 'KA' })
    assert.equal(replay([...claimed(), move]).members.get('bob')!.key, 'KB')
  })
})

describe('names and leaving', () => {
  const claimed = () => [...base(), ev('bob', 5, 'KB', { type: 'member.claimed', memberId: 'bob', key: 'KB' })]
  const pay = (clock: number, amount = 1000) =>
    ev('bob', clock, 'KB', {
      type: 'settlement.recorded',
      settlement: { id: `s${clock}`, from: 'bob', to: 'ana', amount, currency: 'JPY', method: 'cash' },
    })

  it('lets people rename themselves once joined, but not others', () => {
    const own = ev('bob', 6, 'KB', { type: 'member.renamed', memberId: 'bob', name: ' Bobby ' })
    const other = ev('ana', 7, 'KA', { type: 'member.renamed', memberId: 'bob', name: 'Robert' })
    const state = replay([...claimed(), own, other])
    assert.equal(state.members.get('bob')!.name, 'Bobby')
    assert.match(state.rejected[0]!.reason, /themselves/)
  })

  it('still lets anyone fix the name of someone who hasn’t joined yet', () => {
    const fix = ev('ana', 5, 'KA', { type: 'member.renamed', memberId: 'bob', name: 'Bob K' })
    assert.equal(replay([...base(), fix]).members.get('bob')!.name, 'Bob K')
  })

  it('won’t let someone leave while they owe money', () => {
    const leave = ev('bob', 6, 'KB', { type: 'member.left', memberId: 'bob' })
    const state = replay([...claimed(), leave])
    assert.ok(!state.members.get('bob')!.left)
    assert.match(state.rejected[0]!.reason, /Settle up/)
  })

  it('lets someone leave once square, and then they can’t write', () => {
    const leave = ev('bob', 7, 'KB', { type: 'member.left', memberId: 'bob' })
    const after = ev('bob', 8, 'KB', { type: 'member.renamed', memberId: 'bob', name: 'Ghost' })
    const state = replay([...claimed(), pay(6), leave, after])
    assert.equal(state.members.get('bob')!.left, true)
    assert.equal(state.members.get('bob')!.name, 'Bob')
    assert.match(state.rejected[0]!.reason, /left the group/)
  })

  it('can’t leave for someone else', () => {
    const leave = ev('ana', 7, 'KA', { type: 'member.left', memberId: 'bob' })
    assert.ok(!replay([...claimed(), pay(6), leave]).members.get('bob')!.left)
  })

  it('protects the balance of someone who left', () => {
    const leave = ev('bob', 7, 'KB', { type: 'member.left', memberId: 'bob' })
    const retitle = ev('ana', 8, 'KA', { type: 'expense.saved', expense: { ...lunch, title: 'Lunch at Ichiran' }, basedOn: 'ev4' })
    const reshare = ev('ana', 9, 'KA', { type: 'expense.saved', expense: { ...lunch, split: { kind: 'equal', among: ['ana'] } } })
    const remove = ev('ana', 10, 'KA', { type: 'expense.deleted', expenseId: 'lunch', basedOn: 'x' })
    const fresh = ev('ana', 11, 'KA', { type: 'expense.saved', expense: { ...lunch, id: 'dinner' } })
    const paid = ev('ana', 12, 'KA', {
      type: 'settlement.recorded',
      settlement: { id: 'late', from: 'ana', to: 'bob', amount: 5, currency: 'JPY', method: 'cash' },
    })
    const state = replay([...claimed(), pay(6), leave, retitle, reshare, remove, fresh, paid])
    assert.equal(state.expenses.get('lunch')!.title, 'Lunch at Ichiran')
    assert.equal(state.expenses.has('dinner'), false)
    assert.equal(state.rejected.length, 4)
    for (const r of state.rejected) assert.match(r.reason, /left the group/)
  })
})

describe('several Lightning addresses', () => {
  const claimed = () => [...base(), ev('bob', 5, 'KB', { type: 'member.claimed', memberId: 'bob', key: 'KB' })]
  it('keeps an ordered list, and the first is the main address', () => {
    const update = ev('bob', 6, 'KB', { type: 'member.updated', memberId: 'bob', lightningAddress: 'Bob@coinos.io', lightningAddresses: ['Bob@coinos.io', 'bob@rizful.com', 'bob@coinos.io'] })
    const bob = replay([...claimed(), update]).members.get('bob')!
    assert.deepEqual(receiveAddresses(bob), ['bob@coinos.io', 'bob@rizful.com'])
    assert.equal(bob.lightningAddress, 'bob@coinos.io')
  })
  it('still reads a single address from older phones', () => {
    const update = ev('bob', 6, 'KB', { type: 'member.updated', memberId: 'bob', lightningAddress: 'bob@wos.com' })
    assert.deepEqual(receiveAddresses(replay([...claimed(), update]).members.get('bob')), ['bob@wos.com'])
  })
  it('rejects a list with anything that isn’t an address, and clears with an empty list', () => {
    const set = ev('bob', 6, 'KB', { type: 'member.updated', memberId: 'bob', lightningAddresses: ['bob@coinos.io'] })
    const bad = ev('bob', 7, 'KB', { type: 'member.updated', memberId: 'bob', lightningAddresses: ['bob@coinos.io', 'nope'] })
    const state = replay([...claimed(), set, bad])
    assert.deepEqual(receiveAddresses(state.members.get('bob')), ['bob@coinos.io'])
    const clear = ev('bob', 8, 'KB', { type: 'member.updated', memberId: 'bob', lightningAddresses: [] })
    assert.deepEqual(receiveAddresses(replay([...claimed(), set, clear]).members.get('bob')), [])
  })
})

describe('removing someone', () => {
  const BOX = 'B'.repeat(87)
  const joined = () => [
    ...base(),
    ev('bob', 5, 'KB', { type: 'member.claimed', memberId: 'bob', key: 'KB' }),
    ev('cai', 6, 'KC', { type: 'member.added', member: { id: 'cai', name: 'Cai', key: 'KC' } }),
  ]
  const remove = (who: string, by = 'ana', signer = 'KA', clock = 7) =>
    ev(by, clock, signer, { type: 'member.removed', memberId: who })

  it('cuts a stranger off entirely when they took no part', () => {
    const state = replay([...joined(), remove('cai')])
    const cai = state.members.get('cai')!
    assert.equal(cai.key, undefined)
    assert.equal(cai.left, true)
    assert.equal(cai.removedBy, 'ana')
    const after = ev('cai', 8, 'KC', { type: 'group.updated', name: 'Mine now' })
    assert.equal(replay([...joined(), remove('cai'), after]).name, 'Okinawa trip')
  })

  it('keeps someone who took part, with their balance, so they can rejoin as themselves', () => {
    const state = replay([...joined(), remove('bob')])
    const bob = state.members.get('bob')!
    assert.equal(bob.key, undefined)
    assert.ok(!bob.left)
    const back = ev('bob', 8, 'KB2', { type: 'member.claimed', memberId: 'bob', key: 'KB2' })
    const again = replay([...joined(), remove('bob'), back]).members.get('bob')!
    assert.equal(again.key, 'KB2')
    assert.equal(again.removedBy, undefined)
  })

  it('can’t remove yourself, or be done by someone who isn’t in', () => {
    assert.match(replay([...joined(), remove('ana')]).rejected[0]!.reason, /leave/)
    const forged = remove('bob', 'ana', 'KX')
    assert.equal(replay([...joined(), forged]).members.get('bob')!.key, 'KB')
  })

  it('takes box keys from the person only, and keeps addresses when only the box key changes', () => {
    const addr = ev('bob', 7, 'KB', { type: 'member.updated', memberId: 'bob', lightningAddresses: ['bob@coinos.io'] })
    const box = ev('bob', 8, 'KB', { type: 'member.updated', memberId: 'bob', boxKey: BOX })
    const notHis = ev('ana', 9, 'KA', { type: 'member.updated', memberId: 'bob', boxKey: 'C'.repeat(87) })
    const bob = replay([...joined(), addr, box, notHis]).members.get('bob')!
    assert.equal(bob.boxKey, BOX)
    assert.equal(bob.lightningAddress, 'bob@coinos.io')
  })

  it('accepts a key hand-off from a member, and nobody else', () => {
    const handOff = { type: 'group.rekeyed', from: 'R'.repeat(43), ephemeral: 'E'.repeat(87), wrapped: { bob: 'x' } }
    const ok = ev('ana', 8, 'KA', handOff)
    const outsider = ev('zed', 9, 'KZ', handOff)
    const state = replay([...joined(), remove('cai'), ok, outsider])
    assert.equal(state.rejected.length, 1)
    assert.match(state.rejected[0]!.reason, /not a member/)
  })
})
