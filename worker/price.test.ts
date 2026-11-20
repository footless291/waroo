import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { agree } from './price.ts'

const q = (name: string, price: number) => ({ name, price })

describe('agree', () => {
  it('never trusts a single source', () => {
    assert.deepEqual(agree([q('A', 35_600_000)]), { ok: false, reason: 'too-few' })
    assert.deepEqual(agree([]), { ok: false, reason: 'too-few' })
  })

  it('outvotes one wrong source', () => {
    const r = agree([q('A', 35_600_000), q('B', 9_847_000), q('C', 9_850_000)])
    assert.equal(r.ok, true)
    assert.ok(r.ok && r.price === 9_848_500)
    assert.ok(r.ok && r.agreeing.map((x) => x.name).sort().join() === 'B,C')
  })

  it('refuses when two sources disagree and there is no third', () => {
    assert.deepEqual(agree([q('A', 35_600_000), q('B', 9_847_000)]), { ok: false, reason: 'disagree' })
  })

  it('refuses when all three disagree', () => {
    assert.deepEqual(agree([q('A', 9_000_000), q('B', 10_000_000), q('C', 11_000_000)]), { ok: false, reason: 'disagree' })
  })

  it('uses the median of agreeing sources', () => {
    const r = agree([q('A', 9_840_000), q('B', 9_850_000), q('C', 9_900_000)])
    assert.ok(r.ok && r.price === 9_850_000)
  })

  it('ignores junk values', () => {
    const r = agree([q('A', Number.NaN), q('B', 0), q('C', 9_850_000), q('D', 9_860_000)])
    assert.ok(r.ok && r.agreeing.length === 2)
  })
})
