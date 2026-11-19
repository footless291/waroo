/*
 * Adapted from Spliit (https://github.com/spliit-app/spliit), src/lib/shares.ts.
 * Copyright (c) 2023 Sebastien Castiel. Used under the MIT License; see
 * THIRD_PARTY_NOTICES.md at the repository root.
 */

import { assertMinor, LedgerError } from './money.ts'

/**
 * A small deterministic string hash (FNV-1a, 32 bit). Seeds which person is
 * offered the leftover minor unit of an uneven split, so the result is a pure
 * function of the expense and the extra yen moves around between expenses.
 */
export function hashString(value: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/**
 * Splits `amount` (minor units, may be negative) in proportion to `weights`
 * so the parts always add up to exactly `amount`.
 *
 * Every part first gets the floor of its exact share; the units left over go
 * by largest remainder (Hamilton apportionment). Ties are broken by rotating
 * the starting position by `offset`, so equal splits don't always hand the
 * extra unit to the same person.
 */
export function apportion(amount: number, weights: readonly number[], offset = 0): number[] {
  assertMinor(amount)
  const count = weights.length
  if (count === 0) {
    if (amount !== 0) throw new LedgerError('Cannot apportion a non-zero amount among nobody')
    return []
  }
  for (const w of weights) {
    if (!Number.isSafeInteger(w) || w < 0) {
      throw new LedgerError(`Weights must be non-negative integers, got ${w}`)
    }
  }
  const total = weights.reduce((sum, w) => sum + w, 0)
  if (total === 0) throw new LedgerError('Weights must not all be zero')

  // BigInt keeps amount * weight exact even for large amounts.
  const big = BigInt(amount)
  const bigTotal = BigInt(total)
  const parts: bigint[] = []
  const remainders: { index: number; remainder: bigint }[] = []
  let distributed = 0n

  weights.forEach((w, index) => {
    const exact = big * BigInt(w)
    // Floor division that also floors for negative amounts.
    let base = exact / bigTotal
    if (exact % bigTotal !== 0n && exact < 0n) base -= 1n
    parts.push(base)
    distributed += base
    remainders.push({ index, remainder: exact - base * bigTotal })
  })

  const remaining = Number(big - distributed)
  if (remaining > 0) {
    const rotate = (i: number) => (i - (offset % count) + count) % count
    remainders.sort((a, b) =>
      a.remainder !== b.remainder
        ? a.remainder > b.remainder ? -1 : 1
        : rotate(a.index) - rotate(b.index),
    )
    for (let i = 0; i < remaining; i++) {
      const target = remainders[i]
      if (target) parts[target.index] = (parts[target.index] ?? 0n) + 1n
    }
  }
  return parts.map((p) => Number(p) + 0)
}
