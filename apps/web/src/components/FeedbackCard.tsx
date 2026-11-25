import { t } from '@lingui/core/macro'
import { useState, type FormEvent } from 'react'
import { currentLocale } from '../lib/i18n.ts'
import { relayHttpUrl } from '../lib/sync.ts'
import { Segmented } from './Segmented.tsx'

type Kind = 'bug' | 'idea' | 'other'

interface Shot {
  name: string
  type: string
  data: string
  preview: string
}

const MAX_SHOTS = 3
const MAX_SIDE = 1600

/** Shrinks a screenshot on the phone (longest side 1600px, JPEG) so it sends quickly. */
async function shrink(file: File): Promise<Shot> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  const preview = canvas.toDataURL('image/jpeg', 0.8)
  return { name: file.name, type: 'image/jpeg', data: preview.split(',')[1]!, preview }
}

/**
 * Report a bug, suggest something, and/or sign up for news. Sent by email to
 * the people making Waroo. It isn't encrypted like groups are, and says so.
 */
export function FeedbackCard() {
  const [kind, setKind] = useState<Kind>('bug')
  const [message, setMessage] = useState('')
  const [email, setEmail] = useState('')
  const [updates, setUpdates] = useState(false)
  const [shots, setShots] = useState<Shot[]>([])
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ text: string; ok?: boolean }>()

  async function addShots(files: FileList | null) {
    if (!files) return
    const room = MAX_SHOTS - shots.length
    const picked = [...files].filter((f) => f.type.startsWith('image/')).slice(0, room)
    try {
      const shrunk = await Promise.all(picked.map(shrink))
      setShots((s) => [...s, ...shrunk].slice(0, MAX_SHOTS))
    } catch {
      setNote({ text: t`That image couldn’t be read. Try a screenshot in PNG or JPEG.` })
    }
  }

  const canSend = !busy && (message.trim().length > 0 || (updates && email.trim().length > 0))

  async function send(e: FormEvent) {
    e.preventDefault()
    if (updates && !email.trim()) {
      setNote({ text: t`Add your email address to get updates.` })
      return
    }
    setBusy(true)
    setNote(undefined)
    try {
      const res = await fetch(relayHttpUrl('feedback'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind,
          message: message.trim(),
          email: email.trim(),
          updates,
          lang: currentLocale(),
          app: __APP_VERSION__,
          device: navigator.userAgent,
          screenshots: shots.map(({ name, type, data }) => ({ name, type, data })),
        }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(res.status === 429 ? t`Too many messages for now. Try again in a minute.` : (body.error ?? t`Couldn’t send it right now. Try again later.`))
      }
      const sentMessage = message.trim().length > 0
      setMessage('')
      setShots([])
      setNote({
        ok: true,
        text: sentMessage
          ? updates
            ? t`Thanks! It’s on its way, and you’ll get news about Waroo by email.`
            : t`Thanks! It’s on its way.`
          : t`You’re on the list for news about Waroo.`,
      })
    } catch (err) {
      setNote({ text: err instanceof TypeError ? t`Couldn’t reach Waroo. Check your connection and try again.` : (err as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="feedback field-stack" onSubmit={send}>
      <Segmented<Kind>
        label={t`What is it?`}
        options={[
          { value: 'bug', label: t`Bug` },
          { value: 'idea', label: t`Idea` },
          { value: 'other', label: t`Other` },
        ]}
        value={kind}
        onChange={setKind}
      />
      <label className="field">
        <span>{kind === 'bug' ? t`What happened?` : kind === 'idea' ? t`What would you like?` : t`Your message`}</span>
        <textarea
          rows={5}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          maxLength={5000}
          placeholder={
            kind === 'bug'
              ? t`What you did, what you expected, and what happened instead.`
              : kind === 'idea'
                ? t`What would make Waroo better for you?`
                : ''
          }
        />
      </label>

      <div className="feedback-shots">
        {shots.map((s, i) => (
          <span key={i} className="feedback-shot">
            <img src={s.preview} alt={t`Screenshot ${i + 1}`} />
            <button
              type="button"
              className="icon-button"
              aria-label={t`Remove screenshot ${i + 1}`}
              onClick={() => setShots(shots.filter((_, j) => j !== i))}
            >
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
              </svg>
            </button>
          </span>
        ))}
        {shots.length < MAX_SHOTS && (
          <label className="button small outline feedback-add">
            {shots.length === 0 ? t`Add screenshots` : t`Add another`}
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => {
                void addShots(e.target.files)
                e.target.value = ''
              }}
            />
          </label>
        )}
      </div>

      <label className="field">
        <span>{t`Your email (optional)`}</span>
        <input
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t`So we can reply`}
        />
      </label>
      <label className="check">
        <input type="checkbox" checked={updates} onChange={(e) => setUpdates(e.target.checked)} />
        {t`Email me now and then about Waroo updates`}
      </label>

      <button className="button primary" disabled={!canSend}>
        {busy ? t`Sending…` : message.trim() ? t`Send` : t`Sign me up`}
      </button>
      <p className={`hint${note?.ok ? ' ok' : ''}`} aria-live="polite">
        {note?.text}
      </p>
      <p className="muted small">
        {t`This goes by email to the people making Waroo, and isn’t end-to-end encrypted like your groups, so leave out anything private. We get only what you write and attach here, plus the app version, your language and your phone and browser type, to help fix bugs. Nothing from your groups or wallets is included. Your email is only used to reply and, if you ask, for news, which you can stop any time.`}
      </p>
    </form>
  )
}
