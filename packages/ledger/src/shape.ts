/**
 * Events arrive from other phones as plain JSON. A signature proves who sent
 * one, not that it's well-formed, so before replay uses an event it checks
 * every field it will touch has the right type and a sane size. A malformed
 * event is rejected like any other bad event: it must never make replay (or
 * the screens that show its result) throw.
 */

import type { LedgerEvent } from './events.ts'

/** Ids of people, expenses, settlements and events: letters, digits, '-' and '_'. Never '/', '?' or '#', which would break links. */
export const ID = /^[A-Za-z0-9_-]{1,64}$/
/** Largest amount, in minor units, of any one figure: a trillion yen, ten billion dollars. Keeps every sum a safe integer. */
export const MAX_AMOUNT = 1e12
/** Clocks stay far below where `+ 1` stops counting. */
const MAX_CLOCK = 2 ** 50
const MAX_PEOPLE = 500
const KEY = /^[A-Za-z0-9_-]{1,200}$/

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isId = (v: unknown): v is string => typeof v === 'string' && ID.test(v)
const isText = (v: unknown, max: number) => typeof v === 'string' && v.length <= max
const isAmount = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && Math.abs(v) <= MAX_AMOUNT
const optional = (v: unknown, ok: (v: unknown) => boolean) => v === undefined || ok(v)
const isKey = (v: unknown) => typeof v === 'string' && KEY.test(v)

/** A record from person id to amount (payers, weights, exact amounts). */
function isAmounts(v: unknown): boolean {
  if (!isObject(v)) return false
  const entries = Object.entries(v)
  return entries.length <= MAX_PEOPLE && entries.every(([k, a]) => ID.test(k) && isAmount(a))
}

const isPeople = (v: unknown) => Array.isArray(v) && v.length <= MAX_PEOPLE && v.every(isId)

/** YYYY-MM-DD that is a real date. */
export function isDate(v: unknown): boolean {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false
  const d = new Date(`${v}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v
}

/** An ISO timestamp that parses. */
const isTime = (v: unknown) => typeof v === 'string' && v.length <= 40 && !Number.isNaN(Date.parse(v))

/** Three capital letters: what Intl accepts as a currency code. */
export const isCurrencyCode = (v: unknown) => typeof v === 'string' && /^[A-Z]{3}$/.test(v)

function splitProblem(split: unknown): string | undefined {
  if (!isObject(split)) return 'Bad split'
  switch (split.kind) {
    case 'equal':
      return isPeople(split.among) ? undefined : 'Bad split'
    case 'shares':
      return isAmounts(split.weights) ? undefined : 'Bad split'
    case 'percent':
      return isAmounts(split.basisPoints) ? undefined : 'Bad split'
    case 'exact':
      return isAmounts(split.amounts) ? undefined : 'Bad split'
    case 'adjustment':
      return isPeople(split.among) && isAmounts(split.extras) ? undefined : 'Bad split'
    case 'itemized': {
      const items = split.items
      const extras = split.extras
      const itemsOk =
        Array.isArray(items) &&
        items.length <= 500 &&
        items.every((i) => isObject(i) && optional(i.label, (l) => isText(l, 200)) && isAmount(i.amount) && isPeople(i.among))
      const extrasOk =
        extras === undefined ||
        (Array.isArray(extras) &&
          extras.length <= 50 &&
          extras.every((x) => isObject(x) && optional(x.label, (l) => isText(l, 200)) && isAmount(x.amount)))
      return itemsOk && extrasOk ? undefined : 'Bad split'
    }
    default:
      return 'Unknown kind of split'
  }
}

export function expenseProblem(expense: unknown): string | undefined {
  if (!isObject(expense)) return 'Bad expense'
  if (!isId(expense.id)) return 'Bad expense id'
  if (typeof expense.title !== 'string' || expense.title.length > 200) return 'An expense needs a title of up to 200 characters'
  if (!isAmount(expense.total)) return 'Total is too large or not whole minor units'
  if (!isCurrencyCode(expense.currency)) return `Unknown currency code: ${String(expense.currency).slice(0, 10)}`
  if (!isAmounts(expense.payers)) return 'Bad payers'
  if (!isDate(expense.date)) return 'Bad date'
  return splitProblem(expense.split)
}

function settlementProblem(s: unknown): string | undefined {
  if (!isObject(s)) return 'Bad payment'
  if (!isId(s.id) || !isId(s.from) || !isId(s.to)) return 'Bad payment'
  if (!isAmount(s.amount)) return 'Payment amount is too large or not whole minor units'
  if (!isCurrencyCode(s.currency)) return `Unknown currency code: ${String(s.currency).slice(0, 10)}`
  if (!['bitcoin', 'cash', 'bank', 'other'].includes(s.method as string)) return 'Bad payment method'
  if (!optional(s.note, (n) => isText(n, 500))) return 'Bad note'
  if (s.bitcoin !== undefined) {
    const b = s.bitcoin
    const ok =
      isObject(b) &&
      typeof b.sats === 'number' && Number.isSafeInteger(b.sats) && b.sats > 0 && b.sats <= 21e14 &&
      isText(b.btcPrice, 40) && isText(b.rateSource, 100) &&
      typeof b.paymentHash === 'string' && /^([0-9a-f]{64})?$/.test(b.paymentHash) &&
      optional(b.preimage, (p) => typeof p === 'string' && /^[0-9a-f]{64}$/.test(p)) &&
      optional(b.offer, (o) => typeof o === 'boolean') &&
      isTime(b.settledAt)
    if (!ok) return 'Bad bitcoin receipt'
  }
  return undefined
}

function memberProblem(m: unknown): string | undefined {
  if (!isObject(m)) return 'Bad person'
  if (!isId(m.id)) return 'Bad person id'
  if (typeof m.name !== 'string' || !m.name.trim() || m.name.length > 80) return 'A person needs a name of up to 80 characters'
  if (!optional(m.key, isKey) || !optional(m.boxKey, isKey)) return 'Bad key'
  if (!optional(m.lightningAddress, (a) => isText(a, 320))) return 'Bad address'
  if (!optional(m.lightningAddresses, (l) => Array.isArray(l) && l.length <= 5 && l.every((a) => isText(a, 320)))) return 'Bad address'
  if (!optional(m.receive, (l) => Array.isArray(l) && l.length <= 5 && l.every((a) => isText(a, 2100)))) return 'Bad address'
  // Only replay decides these; nobody gets to write them in.
  if (m.left !== undefined || m.removedBy !== undefined || m.recoveredBy !== undefined) return 'Bad person'
  return undefined
}

/** Why an event is malformed, or undefined if every field replay uses is the right shape. */
export function shapeProblem(e: unknown): string | undefined {
  if (!isObject(e)) return 'Not an event'
  if (!isId(e.id) || !isId(e.author)) return 'Bad id'
  if (typeof e.clock !== 'number' || !Number.isSafeInteger(e.clock) || e.clock < 0 || e.clock > MAX_CLOCK) return 'Bad clock'
  if (!isTime(e.at)) return 'Bad time'
  if (!optional(e.signer, (s) => typeof s === 'string')) return 'Bad signer'
  const ev = e as unknown as LedgerEvent
  switch (ev.type) {
    case 'member.added':
      return memberProblem(ev.member)
    case 'member.renamed':
      return isId(ev.memberId) && typeof ev.name === 'string' && ev.name.length <= 80 ? undefined : 'Bad rename'
    case 'member.updated':
      return isId(ev.memberId) &&
        optional(ev.lightningAddress, (a) => isText(a, 320)) &&
        optional(ev.lightningAddresses, Array.isArray) &&
        optional(ev.receive, Array.isArray) &&
        optional(ev.boxKey, (k) => typeof k === 'string')
        ? undefined
        : 'Bad update'
    case 'member.removed':
    case 'member.left':
      return isId(ev.memberId) ? undefined : 'Bad person id'
    case 'member.recovered':
    case 'member.claimed':
    case 'member.rekeyed':
      return isId(ev.memberId) && isKey(ev.key) ? undefined : 'Bad key'
    case 'group.rekeyed':
      return isObject(ev.wrapped) && Object.keys(ev.wrapped).length <= MAX_PEOPLE && Object.keys(ev.wrapped).every((k) => ID.test(k))
        ? undefined
        : 'Bad key hand-off'
    case 'group.updated':
      return optional(ev.name, (n) => typeof n === 'string') && optional(ev.currency, (c) => typeof c === 'string')
        ? undefined
        : 'Bad group update'
    case 'expense.saved':
      return expenseProblem(ev.expense) ?? (optional(ev.basedOn, isId) ? undefined : 'Bad id')
    case 'expense.deleted':
      return isId(ev.expenseId) && isId(ev.basedOn) ? undefined : 'Bad id'
    case 'settlement.recorded':
      return settlementProblem(ev.settlement)
    case 'settlement.voided':
      return isId(ev.settlementId) && optional(ev.reason, (r) => isText(r, 500)) ? undefined : 'Bad id'
    default:
      return 'Unknown kind of event'
  }
}
