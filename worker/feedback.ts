/**
 * Bug reports, ideas, and sign-ups for news about the app.
 *
 * A report is emailed to the maintainer (Cloudflare Email Service),
 * screenshots attached. Nothing about the report is stored. People who tick
 * "email me about updates" are kept in D1 (`subscribers`): just the address,
 * their language and when. Unlike everything else in Waroo, this is readable
 * by whoever runs the server, and the form says so.
 */

import { readCapped } from './invites.ts'

export interface FeedbackEnv {
  EMAIL?: SendEmail
  /**
   * Where reports are delivered. On Cloudflare's free plan, Email Service
   * only sends to verified addresses, so this is the maintainer's verified
   * inbox (a secret, so it isn't in the repository). hello@getwaroo.app
   * forwards to the same inbox for people writing in directly.
   */
  FEEDBACK_TO?: string
  DB?: D1Database
  FEEDBACK_LIMIT?: RateLimit
}

const FROM = { email: 'feedback@getwaroo.app', name: 'Waroo feedback' }
const KINDS = { bug: 'Bug', idea: 'Idea', other: 'Feedback' } as const
const MAX_MESSAGE = 5000
const MAX_SHOTS = 3
/** Base64 size of one screenshot; the app shrinks them well under this. */
const MAX_SHOT_CHARS = 2_000_000
const MAX_BODY = 7 * 1024 * 1024
const MAX_PER_DAY = 300
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,253}\.[^\s@]{2,63}$/

interface Shot {
  name?: string
  type?: string
  data?: string
}

interface Report {
  kind?: string
  message?: string
  email?: string
  updates?: boolean
  lang?: string
  app?: string
  device?: string
  screenshots?: Shot[]
}

const bad = (error: string, status = 400) => Response.json({ error }, { status })

export async function feedback(request: Request, env: FeedbackEnv): Promise<Response> {
  if (request.method !== 'POST') return bad('Method not allowed', 405)
  if (!env.EMAIL || !env.DB) return bad('Feedback isn’t set up on this server', 501)
  const ip = request.headers.get('CF-Connecting-IP') ?? 'local'
  if (env.FEEDBACK_LIMIT && !(await env.FEEDBACK_LIMIT.limit({ key: ip })).success) {
    return bad('Too many messages for now. Try again in a minute.', 429)
  }
  // Only from the app itself: a page elsewhere can't send reports through its visitors.
  const origin = request.headers.get('Origin')
  if (origin !== new URL(request.url).origin) return bad('Send feedback from the app', 403)
  if (!(request.headers.get('Content-Type') ?? '').startsWith('application/json')) return bad('Not JSON', 415)
  let report: Report
  try {
    const text = await readCapped(request, MAX_BODY)
    if (text === null) return bad('Too large', 413)
    report = JSON.parse(text) as Report
  } catch {
    return bad('Not JSON')
  }

  const message = String(report.message ?? '').trim()
  const email = String(report.email ?? '').trim().toLowerCase()
  const kind = report.kind && report.kind in KINDS ? (report.kind as keyof typeof KINDS) : 'other'
  const lang = String(report.lang ?? '').slice(0, 10)
  const shots = Array.isArray(report.screenshots) ? report.screenshots : []
  if (message.length > MAX_MESSAGE) return bad('Message too long')
  if (email && !EMAIL.test(email)) return bad('That email address doesn’t look right')
  if (report.updates && !email) return bad('An email address is needed for updates')
  if (!message && !report.updates) return bad('Nothing to send')
  if (shots.length > MAX_SHOTS) return bad('Too many screenshots')
  for (const s of shots) {
    if (typeof s.data !== 'string' || s.data.length > MAX_SHOT_CHARS || !/^[A-Za-z0-9+/]+=*$/.test(s.data)) {
      return bad('A screenshot couldn’t be read')
    }
    if (!/^image\/(jpeg|png|webp)$/.test(s.type ?? '')) return bad('Screenshots must be images')
  }

  // A cap on the whole day as well as each address, so the inbox can't be flooded.
  if (message) {
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS feedback_days (day TEXT PRIMARY KEY, n INTEGER NOT NULL)`).run()
    const day = new Date().toISOString().slice(0, 10)
    const row = await env.DB.prepare(
      `INSERT INTO feedback_days (day, n) VALUES (?, 1) ON CONFLICT(day) DO UPDATE SET n = n + 1 RETURNING n`,
    )
      .bind(day)
      .first<{ n: number }>()
    if ((row?.n ?? 0) > MAX_PER_DAY) return bad('Lots of messages today already. Try again tomorrow, or email hello@getwaroo.app.', 429)
  }

  if (report.updates) {
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS subscribers (email TEXT PRIMARY KEY, lang TEXT, source TEXT, created_at TEXT NOT NULL, unsubscribed_at TEXT)`,
    ).run()
    await env.DB.prepare(
      `INSERT INTO subscribers (email, lang, source, created_at) VALUES (?, ?, 'app', ?)
       ON CONFLICT(email) DO UPDATE SET lang = excluded.lang`,
    )
      .bind(email, lang, new Date().toISOString())
      .run()
  }

  if (message) {
    // No control characters in a header.
    const firstLine = message.split('\n')[0]!.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ').slice(0, 70)
    const details = [
      `From: ${email || 'no email given'}${report.updates ? ' (wants updates)' : ''}`,
      `App: ${String(report.app ?? '').slice(0, 40)}`,
      `Language: ${lang}`,
      `Device: ${String(report.device ?? '').slice(0, 300)}`,
    ]
    const text = `${message}\n\n---\n${details.join('\n')}`
    const html = `<div style="white-space:pre-wrap;font:15px/1.5 system-ui,sans-serif">${escape(message)}</div>
<hr><p style="color:#666;font:13px/1.5 system-ui,sans-serif">${details.map(escape).join('<br>')}</p>`
    try {
      await env.EMAIL.send({
        to: env.FEEDBACK_TO ?? 'hello@getwaroo.app',
        from: FROM,
        ...(email ? { replyTo: email } : {}),
        subject: `[${KINDS[kind]}] ${firstLine}`,
        text,
        html,
        attachments: shots.map((s, i) => ({
          content: s.data!,
          filename: safeName(s.name, i, s.type!),
          type: s.type!,
          disposition: 'attachment' as const,
        })),
      })
    } catch (err) {
      console.warn(JSON.stringify({ feedback: 'send failed', error: String(err).slice(0, 300) }))
      return bad('Couldn’t send it right now. Try again later.', 502)
    }
  }
  return Response.json({ ok: true })
}

function escape(s: string) {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
}

function safeName(name: string | undefined, i: number, type: string) {
  const ext = type.split('/')[1] === 'jpeg' ? 'jpg' : type.split('/')[1]
  const base = (name ?? '').replace(/\.[^.]*$/, '').replace(/[^\w-]+/g, '-').slice(0, 40) || `screenshot-${i + 1}`
  return `${base}.${ext}`
}
