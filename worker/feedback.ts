/**
 * Bug reports, ideas, and sign-ups for news about the app.
 *
 * A report is emailed to hello@getwaroo.app (Cloudflare Email Service),
 * screenshots attached. Nothing about the report is stored. People who tick
 * "email me about updates" are kept in D1 (`subscribers`): just the address,
 * their language and when. Unlike everything else in Waroo, this is readable
 * by whoever runs the server, and the form says so.
 */

export interface FeedbackEnv {
  EMAIL?: SendEmail
  DB?: D1Database
  FEEDBACK_LIMIT?: RateLimit
}

const TO = 'hello@getwaroo.app'
const FROM = { email: 'feedback@getwaroo.app', name: 'Waroo feedback' }
const KINDS = { bug: 'Bug', idea: 'Idea', other: 'Feedback' } as const
const MAX_MESSAGE = 5000
const MAX_SHOTS = 3
/** Base64 size of one screenshot; the app shrinks them well under this. */
const MAX_SHOT_CHARS = 2_000_000
const MAX_BODY = 7 * 1024 * 1024
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
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY) return bad('Too large', 413)
  let report: Report
  try {
    report = (await request.json()) as Report
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

  if (report.updates) {
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS subscribers (email TEXT PRIMARY KEY, lang TEXT, source TEXT, created_at TEXT NOT NULL, unsubscribed_at TEXT)`,
    ).run()
    await env.DB.prepare(
      `INSERT INTO subscribers (email, lang, source, created_at) VALUES (?, ?, 'app', ?)
       ON CONFLICT(email) DO UPDATE SET unsubscribed_at = NULL, lang = excluded.lang`,
    )
      .bind(email, lang, new Date().toISOString())
      .run()
  }

  if (message) {
    const firstLine = message.split('\n')[0]!.slice(0, 70)
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
        to: TO,
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
