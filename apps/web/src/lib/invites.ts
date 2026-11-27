import { t } from '@lingui/core/macro'
/**
 * Invite links that expire, work for one person, or can be turned off.
 *
 * The link holds a fresh secret, never the group key. The group key waits on
 * the relay, encrypted with that secret, and is handed out only while the
 * invite is valid. See worker/invites.ts.
 */
import { firstKeys, replay } from '@waroo/ledger'
import { decryptJson, encryptJson, inviteId, newGroupKey, toB64url } from './crypto.ts'
import { getEvents, getSetting, setSetting, type GroupMeta } from './db.ts'
import { relayHttpUrl } from './sync.ts'

export type InviteState = 'open' | 'used' | 'expired' | 'stopped' | 'unknown'

export interface SavedInvite {
  secret: string
  groupId: string
  /** Lets this phone turn the link off. Only a hash of it is on the relay. */
  stopToken: string
  createdAt: number
  expiresAt: number
  oneTime: boolean
}

export interface InviteStatus {
  state: InviteState
  opens: number
}

/** What the invite unlocks: enough to load and join the group. */
export interface InviteTicket {
  g: string
  k: string
  from: string
  /** The keys the inviter's phone knows people joined with: see GroupMeta.pins. */
  p?: Record<string, string>
}

export const DAY = 24 * 60 * 60 * 1000

export function inviteLinkFor(secret: string): string {
  return `${location.origin}/#/join?i=${secret}`
}

async function saved(): Promise<SavedInvite[]> {
  return ((await getSetting('invites')) as SavedInvite[] | undefined) ?? []
}

export async function invitesFor(groupId: string): Promise<SavedInvite[]> {
  return (await saved()).filter((i) => i.groupId === groupId).sort((a, b) => b.createdAt - a.createdAt)
}

async function sha256(text: string): Promise<string> {
  return toB64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))
}

export async function createInvite(group: GroupMeta, options: { days: number; oneTime: boolean }): Promise<SavedInvite> {
  const secret = newGroupKey()
  const stopToken = newGroupKey()
  const events = await getEvents(group.id)
  const pins = { ...firstKeys(events, replay(events, { pins: group.pins })), ...group.pins }
  const ticket: InviteTicket = { g: group.id, k: group.key!, from: group.meId, p: pins }
  const expiresAt = Date.now() + options.days * DAY
  const res = await fetch(relayHttpUrl(`invites/${await inviteId(secret)}`), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      data: await encryptJson(secret, ticket),
      expiresAt,
      uses: options.oneTime ? 1 : null,
      stopHash: await sha256(stopToken),
    }),
  })
  if (!res.ok) throw new Error(t`Couldn’t make the link. Check your connection and try again.`)
  const invite: SavedInvite = {
    secret,
    groupId: group.id,
    stopToken,
    createdAt: Date.now(),
    expiresAt,
    oneTime: options.oneTime,
  }
  // Old entries go once the relay has forgotten them too.
  const keep = (await saved()).filter((i) => i.expiresAt > Date.now() - 30 * DAY)
  await setSetting('invites', [invite, ...keep])
  return invite
}

export async function inviteStatus(invite: SavedInvite): Promise<InviteStatus> {
  try {
    const res = await fetch(relayHttpUrl(`invites/${await inviteId(invite.secret)}`), { cache: 'no-store' })
    const body = (await res.json()) as { state?: InviteState; opens?: number }
    return { state: body.state ?? 'unknown', opens: body.opens ?? 0 }
  } catch {
    return { state: invite.expiresAt < Date.now() ? 'expired' : 'unknown', opens: 0 }
  }
}

export async function stopInvite(invite: SavedInvite): Promise<void> {
  const res = await fetch(relayHttpUrl(`invites/${await inviteId(invite.secret)}`), {
    method: 'DELETE',
    headers: { 'X-Stop-Token': invite.stopToken },
  })
  if (!res.ok) throw new Error(t`Couldn’t turn the link off. Check your connection and try again.`)
}

export class InviteClosed extends Error {
  readonly state: InviteState
  constructor(state: InviteState) {
    super(
      state === 'used'
        ? t`This invite link has already been used.`
        : state === 'expired'
          ? t`This invite link has expired.`
          : state === 'stopped'
            ? t`This invite link was turned off.`
            : t`This invite link doesn’t work.`,
    )
    this.state = state
  }
}

/**
 * Opens an invite: asks the relay for the ticket, which uses up a one-person
 * link. The ticket is kept on this phone, so opening the same link again here
 * still works after it's used.
 */
const opening = new Map<string, Promise<InviteTicket>>()

export function openInvite(secret: string): Promise<InviteTicket> {
  // Opening twice at once (a screen drawn twice) would use up a one-person
  // link on the first and be refused on the second: share one request.
  let pending = opening.get(secret)
  if (!pending) {
    pending = openOnce(secret).finally(() => opening.delete(secret))
    opening.set(secret, pending)
  }
  return pending
}

async function openOnce(secret: string): Promise<InviteTicket> {
  const id = await inviteId(secret)
  const cached = (await getSetting(`opened:${id}`)) as InviteTicket | undefined
  if (cached) return cached
  let res: Response
  try {
    res = await fetch(relayHttpUrl(`invites/${id}/open`), { method: 'POST', cache: 'no-store' })
  } catch {
    throw new Error(t`Couldn’t reach Waroo. Check your connection and try again.`)
  }
  const body = (await res.json().catch(() => ({}))) as { state?: InviteState; data?: string }
  if (!res.ok || !body.data) throw new InviteClosed(body.state ?? 'unknown')
  const ticket = await decryptJson<InviteTicket>(secret, body.data)
  if (typeof ticket?.g !== 'string' || typeof ticket.k !== 'string' || typeof ticket.from !== 'string') throw new InviteClosed('unknown')
  if (ticket.p !== undefined && !Object.values(ticket.p ?? 0).every((v) => typeof v === 'string')) delete ticket.p
  await setSetting(`opened:${id}`, ticket)
  return ticket
}
