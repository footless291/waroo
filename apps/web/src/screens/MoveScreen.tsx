import { useEffect, useRef, useState } from 'react'
import { Header } from '../components/Header.tsx'
import { QrCode } from '../components/QrCode.tsx'
import { moveCode } from '../lib/crypto.ts'
import type { GroupMeta } from '../lib/db.ts'
import {
  forgetMoved,
  groupsToMove,
  handOver,
  lightningAddressesToMove,
  moveLink,
  MoveChannel,
  newMoveSecret,
  type MoveMessage,
} from '../lib/move.ts'

type Phase =
  | { at: 'intro' }
  | { at: 'starting' }
  | { at: 'waiting'; secret: string }
  | { at: 'confirm'; secret: string; key: string; code: string }
  | { at: 'moving' }
  | { at: 'done'; count: number }
  | { at: 'stopped'; message: string }

/** The old phone: shows the code to scan, checks it's the right phone, hands everything over. */
export function MoveScreen() {
  const [phase, setPhase] = useState<Phase>({ at: 'intro' })
  const channel = useRef<MoveChannel>(undefined)
  const groups = useRef<GroupMeta[]>([])
  const phaseRef = useRef(phase)
  phaseRef.current = phase

  useEffect(() => () => channel.current?.close(), [])

  function stop(message: string) {
    channel.current?.close()
    channel.current = undefined
    setPhase({ at: 'stopped', message })
  }

  async function onMessage(msg: MoveMessage, secret: string) {
    const now = phaseRef.current
    if (msg.type === 'hello') {
      if (now.at !== 'waiting') {
        // A second phone answered. Someone else may have the code: start over.
        await channel.current?.send({ from: 'old', type: 'cancel' })
        return stop('Another phone also scanned the code, so the move was stopped. Nothing changed. Start again, and keep the code to yourself.')
      }
      setPhase({ at: 'confirm', secret, key: msg.key, code: await moveCode(secret, msg.key) })
    } else if (msg.type === 'done' && now.at === 'moving') {
      await forgetMoved(groups.current.map((g) => g.id))
      channel.current?.close()
      channel.current = undefined
      setPhase({ at: 'done', count: groups.current.length })
    } else if (msg.type === 'cancel') {
      stop('The move was cancelled on the new phone. Nothing changed here.')
    }
  }

  async function start() {
    setPhase({ at: 'starting' })
    try {
      groups.current = await groupsToMove()
      if (groups.current.length === 0) return stop('There are no groups on this phone to move.')
      const secret = newMoveSecret()
      const ch = new MoveChannel(
        secret,
        'old',
        (msg) => void onMessage(msg, secret),
        () => {
          const at = phaseRef.current.at
          if (at === 'waiting' || at === 'confirm' || at === 'moving') stop('Lost the connection. Nothing was moved; start again.')
        },
      )
      channel.current = ch
      await ch.open()
      setPhase({ at: 'waiting', secret })
    } catch (err) {
      stop((err as Error).message)
    }
  }

  async function confirm() {
    if (phase.at !== 'confirm') return
    setPhase({ at: 'moving' })
    try {
      const moved = await handOver(groups.current, phase.key)
      const addresses = await lightningAddressesToMove()
      await channel.current?.send({
        from: 'old',
        type: 'groups',
        groups: moved,
        lightningAddress: addresses[0] ?? '',
        lightningAddresses: addresses,
      })
    } catch (err) {
      stop((err as Error).message)
    }
  }

  async function reject() {
    await channel.current?.send({ from: 'old', type: 'cancel' })
    stop('Stopped. Nothing was moved. If a phone you don’t know scanned the code, that’s fine: it got nothing.')
  }

  return (
    <main className="screen">
      <Header title="Move to a new phone" back="/you" />
      {phase.at === 'intro' && (
        <section className="form">
          <p className="lead">Your groups move to the new phone, and leave this one.</p>
          <ul className="steps">
            <li>Open Footless on the new phone, from its Home Screen.</li>
            <li>Tap the scan button and scan the code this phone will show.</li>
            <li>Check both phones show the same 4 numbers.</li>
          </ul>
          <p className="muted">
            Your Lightning address comes along. A connected wallet doesn’t: connect it again on the new phone.
          </p>
          <button className="button primary" onClick={start}>
            Show the code
          </button>
        </section>
      )}
      {phase.at === 'starting' && <p className="muted" role="status">Getting ready…</p>}
      {phase.at === 'waiting' && (
        <section className="move-qr" data-move-link={moveLink(phase.secret)}>
          <p className="lead">On the new phone, open Footless, tap the scan button and scan this code.</p>
          <QrCode text={moveLink(phase.secret)} label="Code to scan with the new phone" />
          <p className="muted" role="status">
            Waiting for the new phone…
          </p>
          <p className="muted">Don’t share this code: it’s only for your own phone.</p>
        </section>
      )}
      {phase.at === 'confirm' && (
        <section className="form">
          <p className="lead">Does the new phone show these numbers?</p>
          <p className="move-code" aria-label={`Code ${phase.code.split('').join(' ')}`}>
            {phase.code}
          </p>
          <button className="button primary" onClick={confirm}>
            Yes, move my groups
          </button>
          <button className="button outline" onClick={reject}>
            No, stop
          </button>
        </section>
      )}
      {phase.at === 'moving' && (
        <p className="lead" role="status">
          Moving your groups. Keep both phones open…
        </p>
      )}
      {phase.at === 'done' && (
        <section className="empty">
          <h2>Moved</h2>
          <p>
            {phase.count === 1 ? 'Your group is' : `Your ${phase.count} groups are`} on the new phone now, and gone from
            this one.
          </p>
          <a className="button primary" href="#/">
            Done
          </a>
        </section>
      )}
      {phase.at === 'stopped' && (
        <section className="empty">
          <h2>Not moved</h2>
          <p role="alert">{phase.message}</p>
          <button className="button primary" onClick={() => setPhase({ at: 'intro' })}>
            Start again
          </button>
        </section>
      )}
    </main>
  )
}
