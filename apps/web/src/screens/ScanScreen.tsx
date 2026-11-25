import { t } from '@lingui/core/macro'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Header } from '../components/Header.tsx'
import { go } from '../lib/hooks.ts'
import { cameraProblem, inviteRoute, makeDecoder } from '../lib/scan.ts'

type Camera = 'starting' | 'on' | 'off'

export function ScanScreen() {
  const video = useRef<HTMLVideoElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [camera, setCamera] = useState<Camera>('starting')
  const [problem, setProblem] = useState('')
  const [notice, setNotice] = useState('')
  const [pasted, setPasted] = useState('')
  const [pasteError, setPasteError] = useState('')

  useEffect(() => {
    let stream: MediaStream | undefined
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let lastWrong = ''

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCamera('off')
        setProblem(t`This browser can’t open the camera. Paste the invite link below instead.`)
        return
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        })
      } catch (e) {
        if (stopped) return
        setCamera('off')
        setProblem(cameraProblem(e))
        return
      }
      if (stopped) return stop()
      const element = video.current!
      element.srcObject = stream
      await element.play().catch(() => {})
      setCamera('on')
      const decode = await makeDecoder()

      const tick = async () => {
        if (stopped) return
        if (element.readyState >= element.HAVE_ENOUGH_DATA) {
          const text = await decode(element, canvas.current!).catch(() => null)
          if (stopped) return
          if (text) {
            const route = inviteRoute(text)
            if (route) {
              stop()
              go(route)
              return
            }
            if (text !== lastWrong) {
              lastWrong = text
              setNotice(t`That code isn’t from Footless. Scan the code on a group’s Invite screen.`)
            }
          }
        }
        timer = setTimeout(tick, 150)
      }
      tick()
    }

    function stop() {
      stopped = true
      clearTimeout(timer)
      stream?.getTracks().forEach((t) => t.stop())
    }

    // Phones keep the camera light on if a hidden page holds the stream.
    function onVisibility() {
      if (document.hidden) {
        stop()
        setCamera('off')
        setProblem(t`The camera stopped while Footless was in the background.`)
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    start()
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      stop()
    }
  }, [])

  function openPasted(e: FormEvent) {
    e.preventDefault()
    const route = inviteRoute(pasted)
    if (route) go(route)
    else setPasteError(t`That isn’t a Footless invite link. It starts with this site’s address and includes “#/join”.`)
  }

  return (
    <main className="screen">
      <Header title={t`Scan a code`} back="/" />
      <p className="lead">{t`Point the camera at a friend’s invite code, or at your other phone’s code when you’re moving.`}</p>

      <div className={`scanner${camera === 'on' ? ' live' : ''}`}>
        <video ref={video} playsInline muted aria-hidden="true" />
        <canvas ref={canvas} hidden />
        {camera === 'on' && <span className="scanner-frame" aria-hidden="true" />}
        {camera === 'starting' && <span className="scanner-message">{t`Starting the camera…`}</span>}
        {camera === 'off' && <span className="scanner-message">{problem}</span>}
      </div>
      <p className="muted scanner-status" role="status">
        {camera === 'on' ? notice || t`Looking for a code…` : ''}
      </p>

      <form className="form paste-form" onSubmit={openPasted} noValidate>
        <label className="field">
          <span>{t`Or paste the invite link`}</span>
          <input
            value={pasted}
            onChange={(e) => {
              setPasted(e.target.value)
              setPasteError('')
            }}
            inputMode="url"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            aria-invalid={!!pasteError}
            aria-describedby="paste-error"
          />
        </label>
        <p id="paste-error" className="hint pad" aria-live="polite">
          {pasteError}
        </p>
        <button className="button" disabled={!pasted.trim()}>
          {t`Open invite`}
        </button>
      </form>
    </main>
  )
}
