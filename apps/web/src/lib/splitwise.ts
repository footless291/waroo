/**
 * Importing a Splitwise export (Account → Export as spreadsheet, for a friend
 * or a group). The CSV has a row per expense or payment with each person's
 * net effect: positive for whoever's owed (paid more than their share),
 * negative for whoever owes. It doesn't say who paid what, so each row is
 * rebuilt as: the one person owed paid the whole cost, and everyone's share
 * follows from their net. That gives every balance exactly as Splitwise had
 * it.
 *
 * Splitwise allows fractions of a yen; Waroo doesn't. Amounts are rounded
 * so the running totals stay as close to Splitwise's as whole units allow,
 * which keeps the final balance the same as Splitwise's.
 */
import { minorDigits, type Expense, type Settlement } from '@waroo/ledger'

export interface SplitwiseRow {
  line: number
  date: string
  description: string
  category: string
  cost: number
  currency: string
  /** Net per person (column name → amount in major units). */
  nets: Record<string, number>
}

export interface SplitwiseExport {
  people: string[]
  rows: SplitwiseRow[]
  /** Splitwise's own final balances, per currency, per person (major units). */
  totals: Record<string, Record<string, number>>
}

/** Splits one CSV line, honouring quotes. */
function cells(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"'
        i++
      } else if (c === '"') quoted = false
      else cur += c
    } else if (c === '"') quoted = true
    else if (c === ',') {
      out.push(cur)
      cur = ''
    } else cur += c
  }
  out.push(cur)
  return out
}

export class NotSplitwise extends Error {}

export function parseSplitwise(text: string): SplitwiseExport {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/)
  const headerAt = lines.findIndex((l) => /^Date,Description,Category,Cost,Currency,/.test(l.trim()))
  if (headerAt < 0) throw new NotSplitwise('Not a Splitwise export')
  const header = cells(lines[headerAt]!.trim())
  const people = header.slice(5).map((p) => p.trim()).filter(Boolean)
  if (people.length < 2) throw new NotSplitwise('Not a Splitwise export')
  const rows: SplitwiseRow[] = []
  const totals: Record<string, Record<string, number>> = {}
  for (let i = headerAt + 1; i < lines.length; i++) {
    const raw = lines[i]!.trim()
    if (!raw) continue
    const c = cells(raw)
    const [date, description, category, cost, currency] = c.map((x) => x?.trim() ?? '')
    const nets: Record<string, number> = {}
    people.forEach((p, j) => (nets[p] = Number(c[5 + j] ?? 0) || 0))
    if (description === 'Total balance') {
      if (currency) totals[currency] = nets
      continue
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '') || !currency || !Number.isFinite(Number(cost))) continue
    rows.push({ line: i + 1, date: date!, description: description || category || 'Expense', category: category ?? '', cost: Number(cost), currency: currency.toUpperCase(), nets })
  }
  return { people, rows, totals }
}

/** Round half away from zero, so +x and −x round to opposites. */
const roundAway = (x: number) => Math.sign(x) * Math.round(Math.abs(x) + 1e-9)

async function importId(kind: string, row: SplitwiseRow): Promise<string> {
  const text = `${kind}|${row.date}|${row.description}|${row.cost}|${row.currency}|${JSON.stringify(row.nets)}`
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))
  return 'imp-' + [...digest.slice(0, 12)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export type Imported =
  | { kind: 'expense'; row: SplitwiseRow; expense: Expense }
  | { kind: 'payment'; row: SplitwiseRow; settlement: Settlement }

/**
 * Turns rows into Waroo expenses and payments, with Splitwise's people
 * matched to member ids (`who`). Rows whose amounts are all zero are left
 * out. Same rows always get the same ids, so importing twice can't double up.
 */
export async function convert(data: SplitwiseExport, who: Record<string, string>): Promise<Imported[]> {
  const out: Imported[] = []
  // Running totals per currency per person: exact, and as rounded so far.
  const exact = new Map<string, Map<string, number>>()
  const rounded = new Map<string, Map<string, number>>()
  for (const row of data.rows) {
    let scale: number
    try {
      scale = 10 ** minorDigits(row.currency)
    } catch {
      continue
    }
    const ex = exact.get(row.currency) ?? new Map()
    const ro = rounded.get(row.currency) ?? new Map()
    exact.set(row.currency, ex)
    rounded.set(row.currency, ro)
    // This row's nets in minor units, so that the running rounded totals
    // track the exact ones.
    const nets: Record<string, number> = {}
    for (const p of data.people) {
      const after = (ex.get(p) ?? 0) + row.nets[p]! * scale
      ex.set(p, after)
      nets[p] = roundAway(after) - (ro.get(p) ?? 0)
    }
    // With three or more people, rounding can leave the row a unit off zero: put it on the biggest share.
    const drift = Object.values(nets).reduce((a, b) => a + b, 0)
    if (drift !== 0) {
      const biggest = data.people.reduce((a, b) => (Math.abs(nets[b]!) > Math.abs(nets[a]!) ? b : a))
      nets[biggest]! -= drift
    }
    for (const p of data.people) ro.set(p, (ro.get(p) ?? 0) + nets[p]!)

    const owed = data.people.filter((p) => nets[p]! > 0)
    const owing = data.people.filter((p) => nets[p]! < 0)
    let cost = Math.round(Math.abs(row.cost) * scale)

    if (row.category === 'Payment') {
      if (owed.length !== 1 || owing.length !== 1) continue
      const from = owed[0]!
      const to = owing[0]!
      out.push({
        kind: 'payment',
        row,
        settlement: { id: await importId('p', row), from: who[from]!, to: who[to]!, amount: nets[from]!, currency: row.currency, method: 'other', note: 'Splitwise' },
      })
      continue
    }

    const payers: Record<string, number> = {}
    const shares: Record<string, number> = {}
    if (owed.length === 0 && owing.length === 0) {
      // Nobody owes anybody for it: everyone paid their own part.
      if (cost === 0) continue
      const n = data.people.length
      data.people.forEach((p, i) => {
        const part = Math.floor(cost / n) + (i < cost % n ? 1 : 0)
        payers[who[p]!] = part
        shares[who[p]!] = part
      })
    } else if (owed.length === 1) {
      // One person paid it all; everyone's share follows from their net.
      const payer = owed[0]!
      if (cost < nets[payer]!) cost = nets[payer]!
      payers[who[payer]!] = cost
      for (const p of data.people) shares[who[p]!] = p === payer ? cost - nets[p]! : -nets[p]!
    } else {
      // Several people out of pocket: record just what moved between them.
      cost = owed.reduce((a, p) => a + nets[p]!, 0)
      for (const p of owed) payers[who[p]!] = nets[p]!
      for (const p of owing) shares[who[p]!] = -nets[p]!
    }
    for (const id of Object.keys(shares)) if (shares[id] === 0) delete shares[id]
    if (Object.keys(shares).length === 0) continue
    const amounts = Object.values(shares)
    const even = amounts.every((a) => Math.abs(a - amounts[0]!) <= 1)
    out.push({
      kind: 'expense',
      row,
      expense: {
        id: await importId('e', row),
        title: row.description.slice(0, 200),
        total: cost,
        currency: row.currency,
        payers,
        // Equal when it was; otherwise the exact amounts. (Equal splits share
        // out odd units their own way, so exact keeps Splitwise's figures.)
        split: even && amounts.every((a) => a === amounts[0]) ? { kind: 'equal', among: Object.keys(shares) } : { kind: 'exact', amounts: shares },
        date: row.date,
      },
    })
  }
  return out
}
