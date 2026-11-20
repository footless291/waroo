import { replay, type LedgerEvent, type Settlement } from '@footless/ledger'
import { useEffect, useRef, useState } from 'react'
import { getEvents, getGroup, onNewEvents, type EventOrigin } from '../lib/db.ts'
import { money } from '../lib/format.ts'
import { go, locale } from '../lib/hooks.ts'

interface Banner {
  id: string
  groupId: string
  tone: 'in' | 'out'
  title: string
  detail: string
}

const SHOW_FOR_MS = 7000

const sats = (n: number) => `${new Intl.NumberFormat(locale()).format(n)} sats`

/**
 * Decides whether a new payment is news for this person, and how to say it.
 * Payments between two other people stay quiet; they're in the group's list.
 */
async function describe(groupId: string, settlement: Settlement, origin: EventOrigin): Promise<Banner | null> {
  const group = await getGroup(groupId)
  if (!group) return null
  const state = replay(await getEvents(groupId))
  const me = group.meId
  const name = (id: string) => state.members.get(id)?.name ?? 'Someone'
  const amount = money(settlement.amount, settlement.currency)
  const groupName = state.name ?? group.name
  const proof = settlement.bitcoin ? `${sats(settlement.bitcoin.sats)}${settlement.bitcoin.preimage ? ', verified' : ''}` : ''
  const base = { id: settlement.id, groupId }

  if (origin === 'remote' && settlement.to === me) {
    return settlement.bitcoin
      ? { ...base, tone: 'in', title: `${name(settlement.from)} paid you ${amount}`, detail: `${proof}, in ${groupName}` }
      : { ...base, tone: 'in', title: `${name(settlement.from)} marked ${amount} as paid to you`, detail: `In ${groupName}` }
  }
  if (origin === 'remote' && settlement.from === me) {
    return { ...base, tone: 'out', title: `${name(settlement.to)} marked your ${amount} as paid`, detail: `In ${groupName}` }
  }
  if (origin === 'local' && settlement.from === me && settlement.bitcoin) {
    return { ...base, tone: 'out', title: `Payment sent: ${amount} to ${name(settlement.to)}`, detail: `${proof}, in ${groupName}` }
  }
  return null
}

/**
 * Banners for payments sent and received, shown over any screen. The live
 * region stays mounted so screen readers hear each new one.
 */
export function Banners() {
  const [banners, setBanners] = useState<Banner[]>([])
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())

  function dismiss(id: string) {
    clearTimeout(timers.current.get(id))
    timers.current.delete(id)
    setBanners((list) => list.filter((b) => b.id !== id))
  }

  useEffect(
    () =>
      onNewEvents(async (groupId, events: LedgerEvent[], origin) => {
        for (const event of events) {
          if (event.type !== 'settlement.recorded') continue
          const banner = await describe(groupId, event.settlement, origin)
          if (!banner) continue
          setBanners((list) => (list.some((b) => b.id === banner.id) ? list : [...list, banner].slice(-3)))
          timers.current.set(banner.id, setTimeout(() => dismiss(banner.id), SHOW_FOR_MS))
          if (banner.tone === 'in') navigator.vibrate?.([30, 60, 30])
        }
      }),
    [],
  )

  return (
    <div className="banners" aria-live="polite">
      {banners.map((b) => (
        <div key={b.id} className={`banner ${b.tone}`}>
          <button
            className="banner-body"
            onClick={() => {
              dismiss(b.id)
              go(`/g/${b.groupId}`)
            }}
          >
            <span className="banner-mark" aria-hidden="true">
              {b.tone === 'in' ? '↓' : '↑'}
            </span>
            <span className="banner-text">
              <strong>{b.title}</strong>
              <span>{b.detail}</span>
            </span>
          </button>
          <button className="banner-close" aria-label="Dismiss" onClick={() => dismiss(b.id)}>
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  )
}
