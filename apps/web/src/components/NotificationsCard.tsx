import { useEffect, useState } from 'react'
import { getSetting, setSetting } from '../lib/db.ts'
import { disablePush, enablePush, pushSupport, type PushSupport } from '../lib/push.ts'

const WHAT = 'when someone pays you, joins a group or adds an expense'

function usePushSupport() {
  const [support, setSupport] = useState<PushSupport>()
  useEffect(() => {
    void pushSupport().then(setSupport)
  }, [])
  return [support, setSupport] as const
}

/** The full control, on the You screen. */
export function NotificationsCard() {
  const [support, setSupport] = usePushSupport()
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  async function turnOn() {
    setBusy(true)
    setNote('')
    try {
      const result = await enablePush()
      setSupport(result)
      setNote(result === 'on' ? 'Notifications are on.' : result === 'blocked' ? '' : 'Notifications weren’t turned on.')
    } catch (err) {
      setNote((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function turnOff() {
    setBusy(true)
    try {
      await disablePush()
      setSupport('ready')
      setNote('Notifications are off.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="settings-card">
      <h2>Notifications</h2>
      {support === 'on' && (
        <>
          <p>This phone gets a notification {WHAT}, even when Footless is closed.</p>
          <button className="button outline" disabled={busy} onClick={turnOff}>
            Turn off notifications
          </button>
        </>
      )}
      {support === 'ready' && (
        <>
          <p>Get a notification {WHAT}. What happened is worked out on this phone; the server never sees it.</p>
          <button className="button primary" disabled={busy} onClick={turnOn}>
            Turn on notifications
          </button>
        </>
      )}
      {support === 'install-first' && (
        <p>
          On iPhone and iPad, only apps on the Home Screen can send notifications. Tap Share, then “Add to Home Screen”,
          and turn them on from there.
        </p>
      )}
      {support === 'blocked' && (
        <p>Notifications are blocked for Footless. To get them, allow notifications for Footless in your phone’s settings.</p>
      )}
      {support === 'unsupported' && <p>This browser can’t show notifications.</p>}
      <p className="hint" aria-live="polite">
        {note}
      </p>
    </section>
  )
}

/** A one-time suggestion inside a shared group. Gone once answered either way. */
export function NotificationsNudge() {
  const [support, setSupport] = usePushSupport()
  const [dismissed, setDismissed] = useState<boolean>()
  useEffect(() => {
    void getSetting('pushNudgeDismissed').then((d) => setDismissed(d === true))
  }, [])
  if (support !== 'ready' || dismissed !== false) return null

  async function answer(yes: boolean) {
    await setSetting('pushNudgeDismissed', true)
    setDismissed(true)
    if (yes) setSupport(await enablePush().catch(() => 'ready' as const))
  }

  return (
    <section className="nudge">
      <p>Get a notification {WHAT}?</p>
      <div className="nudge-actions">
        <button className="button small primary" onClick={() => answer(true)}>
          Turn on
        </button>
        <button className="button small outline" onClick={() => answer(false)}>
          Not now
        </button>
      </div>
    </section>
  )
}
