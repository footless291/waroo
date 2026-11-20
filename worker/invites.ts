/**
 * Invite links that expire, work once, or can be turned off.
 *
 * An invite link carries a fresh secret, not the group's key. The group's key
 * waits here, encrypted with that secret, under an id derived from it, so the
 * relay can't read it. The relay hands it out only while the invite is
 * valid: before it expires, the right number of times, and until the person
 * who made it turns it off (with a token only their phone has).
 *
 * After that, the box keeps only its state ("used", "expired", "turned off")
 * so the inviter can see what happened, and forgets even that a month later.
 */
import { DurableObject } from 'cloudflare:workers'

const MAX_DATA = 16 * 1024
const MAX_DAYS = 31
const DAY = 24 * 60 * 60 * 1000
const KEEP_STATE_FOR = 30 * DAY

export type InviteState = 'open' | 'used' | 'expired' | 'stopped'

interface Box {
  data: string | null
  expiresAt: number
  /** How many more people can open it; null for any number until it expires. */
  usesLeft: number | null
  /** SHA-256 of the inviter's turn-off token, base64url. */
  stopHash: string
  opens: number
  state: InviteState
}

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })

async function sha256(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))
  let bin = ''
  for (const b of digest) bin += String.fromCharCode(b)
  return btoa(bin).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

export class InviteBox extends DurableObject {
  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const opening = url.pathname.endsWith('/open')
    let box = await this.ctx.storage.get<Box>('box')
    if (box?.state === 'open' && Date.now() >= box.expiresAt) box = await this.expire(box)

    if (request.method === 'PUT') {
      if (box) return json({ error: 'Already exists' }, 409)
      let input: { data?: unknown; expiresAt?: unknown; uses?: unknown; stopHash?: unknown }
      try {
        input = await request.json()
      } catch {
        return json({ error: 'Not JSON' }, 400)
      }
      const { data, expiresAt, uses, stopHash } = input
      const now = Date.now()
      if (typeof data !== 'string' || data.length > MAX_DATA || !/^[A-Za-z0-9_-]+$/.test(data)) {
        return json({ error: 'Bad data' }, 400)
      }
      if (typeof expiresAt !== 'number' || expiresAt <= now || expiresAt > now + MAX_DAYS * DAY) {
        return json({ error: `Invites last up to ${MAX_DAYS} days` }, 400)
      }
      if (uses !== null && !(Number.isSafeInteger(uses) && (uses as number) >= 1 && (uses as number) <= 100)) {
        return json({ error: 'Bad uses' }, 400)
      }
      if (typeof stopHash !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(stopHash)) return json({ error: 'Bad token' }, 400)
      const created: Box = { data, expiresAt, usesLeft: uses as number | null, stopHash, opens: 0, state: 'open' }
      await this.ctx.storage.put('box', created)
      await this.ctx.storage.setAlarm(expiresAt)
      return json(this.status(created), 201)
    }

    if (!box) return json({ state: 'unknown' }, 404)

    if (request.method === 'GET') return json(this.status(box))

    if (request.method === 'POST' && opening) {
      if (box.state !== 'open' || !box.data) return json(this.status(box), 410)
      const data = box.data
      box.opens++
      if (box.usesLeft !== null) {
        box.usesLeft--
        if (box.usesLeft <= 0) {
          box.state = 'used'
          box.data = null
        }
      }
      await this.ctx.storage.put('box', box)
      return json({ ...this.status(box), data })
    }

    if (request.method === 'DELETE') {
      const token = request.headers.get('X-Stop-Token') ?? ''
      if (!token || (await sha256(token)) !== box.stopHash) return json({ error: 'Not yours to turn off' }, 403)
      if (box.state === 'open') {
        box = { ...box, state: 'stopped', data: null }
        await this.ctx.storage.put('box', box)
        await this.ctx.storage.setAlarm(Date.now() + KEEP_STATE_FOR)
      }
      return json(this.status(box))
    }

    return json({ error: 'Method not allowed' }, 405)
  }

  override async alarm(): Promise<void> {
    const box = await this.ctx.storage.get<Box>('box')
    if (box?.state === 'open') await this.expire(box)
    else await this.ctx.storage.deleteAll()
  }

  private async expire(box: Box): Promise<Box> {
    const expired: Box = { ...box, state: 'expired', data: null }
    await this.ctx.storage.put('box', expired)
    await this.ctx.storage.setAlarm(Date.now() + KEEP_STATE_FOR)
    return expired
  }

  private status(box: Box) {
    return { state: box.state, expiresAt: box.expiresAt, usesLeft: box.usesLeft, opens: box.opens }
  }
}
