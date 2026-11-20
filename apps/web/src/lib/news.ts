/**
 * What's worth telling someone about, and how to say it. Shared by the in-app
 * banners and the service worker's notifications, so both say the same thing.
 *
 * Kept free of React and of the page (no window, no location): the service
 * worker imports it too.
 */
import { computeShares, formatAmount, type GroupState, type LedgerEvent, type Settlement } from '@footless/ledger'

export type NewsKind = 'paid-you' | 'you-paid' | 'others-paid' | 'joined' | 'expense'

export interface News {
  id: string
  kind: NewsKind
  title: string
  detail: string
}

const lang = () => (typeof navigator !== 'undefined' && navigator.language) || 'en'
const money = (amount: number, currency: string) => formatAmount(amount, currency, lang())
const sats = (n: number) => `${new Intl.NumberFormat(lang()).format(n)} sats`

/**
 * Events that should wake the others' phones. The sender decides, since the
 * relay can't read anything. Edits, renames and the like stay quiet.
 */
export function isNotable(event: LedgerEvent): boolean {
  switch (event.type) {
    case 'settlement.recorded':
    case 'member.claimed':
      return true
    case 'member.added':
      return event.member.id === event.author && event.member.key !== undefined
    case 'expense.saved':
      return !event.basedOn
    default:
      return false
  }
}

/**
 * Describes one event for the person `meId`, or null if it isn't news to
 * them. `state` is the group after the event, for names and shares.
 * `mine` is true when this phone wrote the event itself.
 */
export function describeEvent(
  event: LedgerEvent,
  state: GroupState,
  meId: string,
  groupName: string,
  mine: boolean,
): News | null {
  const name = (id: string) => state.members.get(id)?.name ?? 'Someone'
  const where = `in ${groupName}`

  if (event.type === 'settlement.recorded') {
    const s: Settlement = event.settlement
    const amount = money(s.amount, s.currency)
    const proof = s.bitcoin ? `${sats(s.bitcoin.sats)}${s.bitcoin.preimage ? ', verified' : ''}` : ''
    const detail = proof ? `${proof}, ${where}` : capital(where)
    const base = { id: s.id }
    if (mine) {
      // Only a bitcoin payment is news to the payer: a manual record is what they just did.
      return s.from === meId && s.bitcoin
        ? { ...base, kind: 'you-paid', title: `Payment sent: ${amount} to ${name(s.to)}`, detail }
        : null
    }
    if (s.to === meId) {
      return s.bitcoin
        ? { ...base, kind: 'paid-you', title: `${name(s.from)} paid you ${amount}`, detail }
        : { ...base, kind: 'paid-you', title: `${name(s.from)} marked ${amount} as paid to you`, detail }
    }
    if (s.from === meId) {
      return { ...base, kind: 'you-paid', title: `${name(s.to)} marked your ${amount} as paid`, detail }
    }
    return { ...base, kind: 'others-paid', title: `${name(s.from)} paid ${name(s.to)} ${amount}`, detail }
  }

  if (mine) return null

  if (isNotable(event) && (event.type === 'member.added' || event.type === 'member.claimed')) {
    const who = event.type === 'member.added' ? event.member.id : event.memberId
    return { id: event.id, kind: 'joined', title: `${name(who)} joined ${groupName}`, detail: 'They can see the group and add expenses now' }
  }

  if (event.type === 'expense.saved' && !event.basedOn) {
    // Say it as it is now: it may have been edited, or deleted, since.
    if (state.deleted.has(event.expense.id)) return null
    const e = state.expenses.get(event.expense.id) ?? event.expense
    let share: number | undefined
    try {
      share = computeShares(e).get(meId)
    } catch {
      share = undefined
    }
    return {
      id: event.id,
      kind: 'expense',
      title: `${name(event.author)} added ${e.title}, ${money(e.total, e.currency)}`,
      detail: share ? `Your share is ${money(share, e.currency)}, ${where}` : capital(where),
    }
  }
  return null
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
