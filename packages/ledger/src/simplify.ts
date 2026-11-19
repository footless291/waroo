/*
 * The matching below is adapted from Spliit (https://github.com/spliit-app/spliit),
 * src/lib/balances.ts, getSuggestedReimbursements. Copyright (c) 2023 Sebastien
 * Castiel. Used under the MIT License; see THIRD_PARTY_NOTICES.md.
 */

import type { Balances } from './balances.ts'
import type { CurrencyCode } from './money.ts'
import type { PersonId } from './splits.ts'

export interface Transfer {
  from: PersonId
  to: PersonId
  amount: number
  currency: CurrencyCode
}

/**
 * Suggests a short list of payments that clears every balance, per currency.
 *
 * Greedy: repeatedly matches the person owed most with the person owing most,
 * ordered by id so the suggestions stay stable as people settle; acting on one
 * suggestion doesn't reshuffle the rest. At most n - 1 transfers for n people
 * with a non-zero balance. Suggestions only: anyone may pay whoever they
 * actually owe instead.
 */
export function suggestTransfers(balances: Balances): Transfer[] {
  const transfers: Transfer[] = []
  for (const currency of [...balances.keys()].sort()) {
    const byPerson = balances.get(currency)!
    const people = [...byPerson]
      .filter(([, total]) => total !== 0)
      .map(([id, total]) => ({ id, total }))
      .sort((a, b) => {
        if (a.total > 0 && b.total < 0) return -1
        if (b.total > 0 && a.total < 0) return 1
        return a.id < b.id ? -1 : 1
      })
    while (people.length > 1) {
      const creditor = people[0]!
      const debtor = people[people.length - 1]!
      if (creditor.total <= 0 || debtor.total >= 0) break
      const amount = Math.min(creditor.total, -debtor.total)
      transfers.push({ from: debtor.id, to: creditor.id, amount, currency })
      creditor.total -= amount
      debtor.total += amount
      if (debtor.total === 0) people.pop()
      if (creditor.total === 0) people.shift()
    }
  }
  return transfers
}
