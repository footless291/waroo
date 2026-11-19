import type { LedgerEvent } from './events.ts'

/**
 * Deterministic JSON: object keys sorted, no whitespace, `undefined` dropped.
 * Two devices serialising the same value always get the same string.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new TypeError('Cannot serialise a non-finite number')
    }
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v ?? null)).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`
}

/**
 * The exact bytes an event's signature covers: the canonical JSON of the
 * event without its transport-supplied `signer`.
 */
export function signingBytes(event: LedgerEvent): Uint8Array<ArrayBuffer> {
  const { signer: _signer, ...rest } = event
  return new TextEncoder().encode(canonicalJson(rest)) as Uint8Array<ArrayBuffer>
}
