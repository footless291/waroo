/**
 * Reading a receipt's text (from on-device OCR) into an expense: the shop,
 * the total, the date and the currency. OCR on a phone photo is noisy, so
 * every rule here is forgiving, and anything unsure is left out: whatever's
 * filled in is shown for checking before it's saved.
 */

export interface ReceiptGuess {
  title?: string
  /** The total in major units, as the amount field takes it: "1234" or "12.34". */
  amount?: string
  /** YYYY-MM-DD */
  date?: string
  currency?: string
}

/** Lines that hold the total. */
const TOTAL = /(合\s*計|お\s*会\s*計|総\s*計|ご\s*請\s*求|お\s*支\s*払|grand\s*total|total|amount\s*due|balance\s*due)/i
/** Lines that look like a total but aren't: subtotals, tax, cash handed over, change, item counts. */
const NOT_TOTAL = /(小\s*計|sub\s*-?\s*total|税|tax|預|釣|change|cash|tendered|点数|点|items?\b|qty|ポイント|point|割引|discount|tip)/i
/** Lines that are never the shop's name. */
const NOT_NAME = /(領\s*収|レシート|receipt|invoice|tel|電話|〒|http|www\.|@|登録番号|no\.|#|様|date|日時|\d{2,}[-:/]\d{2,})/i

/** Full-width to half-width, and the usual OCR slips around money. */
export function normalise(line: string): string {
  return line
    .normalize('NFKC')
    .replace(/[￥\\]/g, '¥')
    .replace(/(\d)\s*[,，]\s*(?=\d{3}\b)/g, '$1,')
    .replace(/(\d)\s+(?=\d{3}\b)/g, '$1')
    .replace(/[Oo](?=\d)|(?<=\d)[Oo]/g, '0')
    // OCR spaces out Japanese characters: ファ ミリ ー マート.
    .replace(/(?<=[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー])\s+(?=[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー])/gu, '')
    .trim()
}

/** Amounts on a line, as numbers in major units. "¥1,234", "1,234円", "$12.34", "12.34". */
export function amountsIn(line: string): number[] {
  const out: number[] = []
  const re = /(?:[¥$€£]\s*)?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?:\s*円)?/g
  for (const m of line.matchAll(re)) {
    const whole = Number(m[1]!.replace(/,/g, ''))
    if (!Number.isFinite(whole)) continue
    const cents = m[2] ? Number(m[2].padEnd(2, '0')) / 100 : 0
    out.push(whole + cents)
  }
  return out
}

function currencyOf(text: string): string | undefined {
  if (/[¥円]/.test(text)) return 'JPY'
  if (/€/.test(text)) return 'EUR'
  if (/£/.test(text)) return 'GBP'
  if (/\$/.test(text)) return 'USD'
  return undefined
}

/** The receipt's date, if one reads as a real date not in the future (allowing a day for time zones). */
export function dateIn(text: string, now = new Date()): string | undefined {
  const tries: [number, number, number][] = []
  const t = normalise(text)
  for (const m of t.matchAll(/(20\d{2})\s*[年/.\-]\s*(\d{1,2})\s*[月/.\-]\s*(\d{1,2})/g)) tries.push([+m[1]!, +m[2]!, +m[3]!])
  // 令和: R7 is 2025.
  for (const m of t.matchAll(/(?:令和|R)\s*(\d{1,2})\s*[年/.\-]\s*(\d{1,2})\s*[月/.\-]\s*(\d{1,2})/g)) tries.push([2018 + +m[1]!, +m[2]!, +m[3]!])
  // US style, month first, four-digit year.
  for (const m of t.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/g)) tries.push([+m[3]!, +m[1]!, +m[2]!])
  // Two-digit year first, as Japanese receipts often print: 25/11/28.
  for (const m of t.matchAll(/(?<!\d)(\d{2})[/.\-](\d{1,2})[/.\-](\d{1,2})(?!\d)/g)) tries.push([2000 + +m[1]!, +m[2]!, +m[3]!])
  const latest = now.getTime() + 86_400_000
  for (const [y, mo, d] of tries) {
    const date = new Date(Date.UTC(y, mo - 1, d))
    if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) continue
    if (date.getTime() > latest || y < now.getUTCFullYear() - 2) continue
    return date.toISOString().slice(0, 10)
  }
  return undefined
}

/** The shop: the first line near the top that reads like a name. */
function titleIn(lines: string[]): string | undefined {
  for (const line of lines.slice(0, 6)) {
    if (NOT_NAME.test(line)) continue
    const letters = line.replace(/[\s\d\p{P}\p{S}]/gu, '')
    // Mostly letters or kana/kanji, not a row of numbers or OCR dust.
    if (letters.length < 2 || letters.length < line.replace(/\s/g, '').length * 0.6) continue
    return line.slice(0, 40)
  }
  return undefined
}

export function readReceipt(text: string, now = new Date()): ReceiptGuess {
  const lines = text
    .split(/\r?\n/)
    .map(normalise)
    .filter((l) => l.length > 0)
  const guess: ReceiptGuess = {}
  const currency = currencyOf(lines.join('\n'))
  if (currency) guess.currency = currency

  // The total: the last line that says so (receipts print it after the
  // items), else the largest sensible amount on a total-ish line.
  let total: number | undefined
  for (const line of lines) {
    if (!TOTAL.test(line) || NOT_TOTAL.test(line.replace(TOTAL, ''))) continue
    const amounts = amountsIn(line.replace(TOTAL, '')).filter((a) => a > 0)
    if (amounts.length) total = amounts.at(-1)
  }
  // Some receipts put the figure on the line after the word.
  if (total === undefined) {
    lines.forEach((line, i) => {
      if (TOTAL.test(line) && !NOT_TOTAL.test(line) && amountsIn(line).length === 0) {
        const next = amountsIn(lines[i + 1] ?? '').filter((a) => a > 0)
        if (next.length) total = next.at(-1)
      }
    })
  }
  if (total !== undefined && total < 10_000_000) {
    const yen = (currency ?? 'JPY') === 'JPY'
    guess.amount = yen ? String(Math.round(total)) : total.toFixed(2).replace(/\.00$/, '')
  }

  const date = dateIn(lines.join('\n'), now)
  if (date) guess.date = date
  const title = titleIn(lines)
  if (title) guess.title = title
  return guess
}
