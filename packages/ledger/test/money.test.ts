import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { fiatToSats, formatAmount, LedgerError, minorDigits, parseAmount } from '../src/index.ts'

describe('minorDigits', () => {
  it('knows yen has no decimals and dollars have two', () => {
    assert.equal(minorDigits('JPY'), 0)
    assert.equal(minorDigits('usd'), 2)
    assert.equal(minorDigits('KWD'), 3)
  })
  it('rejects unknown codes', () => {
    assert.throws(() => minorDigits('NOPE!'), LedgerError)
  })
})

describe('parseAmount', () => {
  it('parses exactly, without floating point', () => {
    assert.equal(parseAmount('4800', 'JPY'), 4800)
    assert.equal(parseAmount('12.5', 'USD'), 1250)
    assert.equal(parseAmount('0.29', 'USD'), 29) // 0.29 * 100 is 28.999… in floats
    assert.equal(parseAmount('-3.20', 'EUR'), -320)
    assert.equal(parseAmount('1,234', 'JPY'), 1234)
  })
  it('refuses more decimals than the currency has', () => {
    assert.throws(() => parseAmount('100.5', 'JPY'), /at most 0 decimal/)
    assert.throws(() => parseAmount('1.234', 'USD'), /at most 2 decimal/)
  })
  it('refuses junk', () => {
    assert.throws(() => parseAmount('12abc', 'USD'), LedgerError)
    assert.throws(() => parseAmount('', 'USD'), LedgerError)
  })
})

describe('formatAmount', () => {
  it('formats in the viewer locale', () => {
    assert.equal(formatAmount(4800, 'JPY', 'ja-JP'), '￥4,800')
    assert.equal(formatAmount(1250, 'USD', 'en-US'), '$12.50')
  })
})

describe('fiatToSats', () => {
  it('converts yen at a quoted price', () => {
    // 1 BTC = ¥15,000,000 → ¥1 = 6.666… sats → ¥4,800 = 32,000 sats
    assert.equal(fiatToSats(4800, 'JPY', '15000000'), 32000)
  })
  it('rounds up so the creditor is never short', () => {
    // ¥1 at ¥15,000,000/BTC is 6.67 sats → 7
    assert.equal(fiatToSats(1, 'JPY', '15000000'), 7)
  })
  it('handles decimal prices and cents', () => {
    // $12.50 at $100,000.00/BTC = 12,500 sats exactly
    assert.equal(fiatToSats(1250, 'USD', '100000.00'), 12500)
  })
  it('rejects bad prices and negative amounts', () => {
    assert.throws(() => fiatToSats(100, 'JPY', '0'), LedgerError)
    assert.throws(() => fiatToSats(100, 'JPY', '-5'), LedgerError)
    assert.throws(() => fiatToSats(-1, 'JPY', '100'), LedgerError)
  })
})
