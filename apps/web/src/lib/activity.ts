import { computeShares, replay, type LedgerEvent } from '@footless/ledger'
import { getEvents, listGroups } from './db.ts'

export interface ActivityItem {
  key: string
  kind: 'expense' | 'payment'
  groupId: string
  groupName: string
  /** When it was added (or last changed), ISO. */
  at: string
  title: string
  amount: number
  currency: string
  /** From the group's point of view: who paid, or who paid whom. */
  from: string
  to?: string
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
    const state = replay(events)
    const byId = new Map<string, LedgerEvent>(events.map((e) => [e.id, e]))
    const name = (id: string) => (id === group.meId ? 'You' : (state.members.get(id)?.name ?? 'Someone'))
    const groupName = state.name ?? group.name
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
        at: head?.at ?? `${expense.date}T00:00:00Z`,
        title: expense.title,
        amount: expense.total,
        currency: expense.currency,
        from: payers.length === 1 ? name(payers[0]!) : `${payers.length} people`,
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
        at: recorded.get(s.id) ?? '',
        title: '',
        amount: s.amount,
        currency: s.currency,
        from: name(s.from),
        to: s.to === group.meId ? 'you' : name(s.to),
        method: s.method,
        sats: s.bitcoin?.sats,
      })
    }
  }
  return items.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit)
}
