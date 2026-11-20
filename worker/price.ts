export interface Quote {
  name: string
  price: number
}

export type Agreement =
  | { ok: true; price: number; agreeing: Quote[] }
  | { ok: false; reason: 'too-few' | 'disagree' }

/**
 * Picks a price only when independent sources back it up.
 *
 * Finds the largest group of quotes that all sit within `tolerance` of each
 * other, and answers with its median, but only if at least `minAgreeing`
 * sources are in it. One source on its own is never trusted: a single wrong
 * feed must not be able to set the price people pay at.
 */
export function agree(quotes: Quote[], tolerance = 0.02, minAgreeing = 2): Agreement {
  const valid = quotes.filter((q) => Number.isFinite(q.price) && q.price > 0)
  if (valid.length < minAgreeing) return { ok: false, reason: 'too-few' }

  let best: Quote[] = []
  for (const anchor of valid) {
    const group = valid.filter((q) => Math.abs(q.price - anchor.price) / anchor.price <= tolerance)
    const lo = Math.min(...group.map((q) => q.price))
    const hi = Math.max(...group.map((q) => q.price))
    // Every member must also agree with every other, not just with the anchor.
    if ((hi - lo) / lo <= tolerance && group.length > best.length) best = group
  }
  if (best.length < minAgreeing) return { ok: false, reason: 'disagree' }

  const sorted = best.map((q) => q.price).sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const price = sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
  return { ok: true, price, agreeing: best }
}
