import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { amountsIn, dateIn, readReceipt } from './receipt.ts'

const now = new Date('2026-11-28T09:00:00+09:00')

describe('reading receipts', () => {
  it('a convenience store receipt', () => {
    const text = `ファミリーマート
渋谷道玄坂店
TEL 03-1234-5678
2026年11月27日(金) 18:42
領収書
おにぎり 鮭        ¥160
お茶              ¥140
小計              ¥300
(内消費税等 8%     ¥22)
合計 ¥324
お預り            ¥1,000
お釣り            ¥676`
    assert.deepEqual(readReceipt(text, now), { currency: 'JPY', amount: '324', date: '2026-11-27', title: 'ファミリーマート' })
  })

  it('full-width digits, 円, and a total on the next line', () => {
    const text = `居酒屋 たぬき
２０２６／１１／２０
合計
１２，８００円
お預り 13,000円`
    assert.deepEqual(readReceipt(text, now), { currency: 'JPY', amount: '12800', date: '2026-11-20', title: '居酒屋たぬき' })
  })

  it('an item count and points are not the total', () => {
    const text = `スーパーまるや
R8.11.01
合計点数 5点
ポイント 120
合 計 \\2,345`
    const r = readReceipt(text, now)
    assert.equal(r.amount, '2345')
    assert.equal(r.date, '2026-11-01')
  })

  it('an English receipt in dollars', () => {
    const text = `Blue Bottle Coffee
11/26/2026 08:15
Latte 5.50
Croissant 4.25
Subtotal 9.75
Tax 0.86
TOTAL $10.61
Cash $20.00
Change $9.39`
    assert.deepEqual(readReceipt(text, now), { currency: 'USD', amount: '10.61', date: '2026-11-26', title: 'Blue Bottle Coffee' })
  })

  it('joins Japanese the OCR spaced out', () => {
    assert.equal(readReceipt('ファ ミリ ー マ ー ト\n合 計 ¥324', now).title, 'ファミリーマート')
  })

  it('leaves out what it can’t read', () => {
    assert.deepEqual(readReceipt('|||  ..  ~~', now), {})
  })

  it('ignores future and impossible dates', () => {
    assert.equal(dateIn('2026/02/30', now), undefined)
    assert.equal(dateIn('2027/01/05', now), undefined)
    assert.equal(dateIn('25/12/24', now), '2025-12-24')
  })

  it('reads amounts in their usual shapes', () => {
    assert.deepEqual(amountsIn('¥1,234 1,234円 $12.34 99'), [1234, 1234, 12.34, 99])
  })
})
