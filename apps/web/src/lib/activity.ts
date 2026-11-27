import { computeShares, replay, type LedgerEvent } from '@waroo/ledger'
import { getEvents, listGroups, replayGroup } from './db.ts'
import { groupTitle } from './title.ts'

export interface ActivityItem {
  key: string
  kind: 'expense' | 'payment'
  groupId: string
  groupName: string
  /** From a friendship: there's no group to name, just the two of you. */
  friend?: boolean
  /** When it was added (or last changed), ISO. */
  at: string
  title: string
  amount: number
  currency: string
  /** Who paid (an expense's payer, if one; a payment's sender). Null: this phone's person. */
  from: string | null
  /** For expenses paid by several people: how many. */
  payers?: number
  /** For payments: who was paid. Null: this phone's person. */
  to?: string | null
  /** For expenses: this person's share, if any. */
  myShare?: number
  method?: string
  sats?: number
}

/**
 * Recent expenses and payments across every group on this phone, newest
 * first. Expenses count from their latest version; deleted ones are gone.
 */
export async function recentActivity(limit = 100): Promise<ActivityItem[]> {
  const items: ActivityItem[] = []
  for (const group of await listGroups()) {
    const events = await getEvents(group.id)
    const state = await replayGroup(group.id, events)
    const byId = new Map<string, LedgerEvent>(events.map((e) => [e.id, e]))
    const name = (id: string) => (id === group.meId ? null : (state.members.get(id)?.name ?? '?'))
    const groupName = groupTitle(state, group)
    for (const expense of state.expenses.values()) {
      const head = byId.get(state.heads.get(expense.id) ?? '')
      const payers = Object.keys(expense.payers)
      let myShare: number | undefined
      try {
        myShare = computeShares(expense).get(group.meId)
      } catch {
        myShare = undefined
      }
      items.push({
        key: `e:${group.id}:${expense.id}`,
        kind: 'expense',
        groupId: group.id,
        groupName,
        friend: state.kind === 'friends',
        at: head?.at ?? `${expense.date}T00:00:00Z`,
        title: expense.title,
        amount: expense.total,
        currency: expense.currency,
        from: name(payers[0]!),
        payers: payers.length,
        myShare,
      })
    }
    const recorded = new Map<string, string>()
    for (const e of events) if (e.type === 'settlement.recorded') recorded.set(e.settlement.id, e.at)
    for (const s of state.settlements.values()) {
      items.push({
        key: `p:${group.id}:${s.id}`,
        kind: 'payment',
        groupId: group.id,
        groupName,
        friend: state.kind === 'friends',
        at: recorded.get(s.id) ?? '',
        title: '',
        amount: s.amount,
        currency: s.currency,
        from: name(s.from),
        to: name(s.to),
        method: s.method,
        sats: s.bitcoin?.sats,
      })
    }
  }
  return items.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit)
}
