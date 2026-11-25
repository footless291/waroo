import { plural, t } from '@lingui/core/macro'
import { useEffect, useRef, useState } from 'react'
import { Header } from '../components/Header.tsx'
import { QrCode } from '../components/QrCode.tsx'
import { moveCode } from '../lib/crypto.ts'
import type { GroupMeta } from '../lib/db.ts'
import {
  forgetMoved,
  groupsToMove,
  handOver,
  forgetMovedWallets,
  lightningAddressesToMove,
  receiveWalletsToMove,
  sendWalletsToMove,
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
        return stop(t`Another phone also scanned the code, so the move was stopped. Nothing changed. Start again, and keep the code to yourself.`)
      }
      setPhase({ at: 'confirm', secret, key: msg.key, code: await moveCode(secret, msg.key) })
    } else if (msg.type === 'done' && now.at === 'moving') {
      await forgetMoved(groups.current.map((g) => g.id))
      await forgetMovedWallets()
      channel.current?.close()
      channel.current = undefined
      setPhase({ at: 'done', count: groups.current.length })
    } else if (msg.type === 'cancel') {
      stop(t`The move was cancelled on the new phone. Nothing changed here.`)
    }
  }

  async function start() {
    setPhase({ at: 'starting' })
    try {
      groups.current = await groupsToMove()
      if (groups.current.length === 0 && (await sendWalletsToMove()).length === 0 && (await receiveWalletsToMove()).length === 0) {
        return stop(t`There’s nothing on this phone to move yet: no groups and no wallets.`)
      }
      const secret = newMoveSecret()
      const ch = new MoveChannel(
        secret,
        'old',
        (msg) => void onMessage(msg, secret),
        () => {
          const at = phaseRef.current.at
          if (at === 'waiting' || at === 'confirm' || at === 'moving') stop(t`Lost the connection. Nothing was moved; start again.`)
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
        sendWallets: await sendWalletsToMove(),
        receiveWallets: await receiveWalletsToMove(),
      })
    } catch (err) {
      stop((err as Error).message)
    }
  }

  async function reject() {
    await channel.current?.send({ from: 'old', type: 'cancel' })
    stop(t`Stopped. Nothing was moved. If a phone you don’t know scanned the code, that’s fine: it got nothing.`)
  }

  return (
    <main className="screen">
      <Header title={t`Move to a new phone`} back="/settings" />
      {phase.at === 'intro' && (
        <section className="form">
          <p className="lead">{t`Your groups and wallets move to the new phone, and leave this one.`}</p>
          <ul className="steps">
            <li>{t`Open Footless on the new phone, from its Home Screen.`}</li>
            <li>{t`Tap the scan button and scan the code this phone will show.`}</li>
            <li>{t`Check both phones show the same 4 numbers.`}</li>
          </ul>
          <p className="muted">
            {t`Your Lightning addresses and wallet connections come along, in the same order. A wallet that’s built into this browser stays behind.`}
          </p>
          <button className="button primary" onClick={start}>
            {t`Show the code`}
          </button>
        </section>
      )}
      {phase.at === 'starting' && <p className="muted" role="status">{t`Getting ready…`}</p>}
      {phase.at === 'waiting' && (
        <section className="move-qr" data-move-link={moveLink(phase.secret)}>
          <p className="lead">{t`On the new phone, open Footless, tap the scan button and scan this code.`}</p>
          <QrCode text={moveLink(phase.secret)} label={t`Code to scan with the new phone`} />
          <p className="muted" role="status">
            {t`Waiting for the new phone…`}
          </p>
          <p className="muted">{t`Don’t share this code: it’s only for your own phone.`}</p>
        </section>
      )}
      {phase.at === 'confirm' && (
        <section className="form">
          <p className="lead">{t`Does the new phone show these numbers?`}</p>
          <p className="move-code" aria-label={codeLabel(phase.code)}>
            {phase.code}
          </p>
          <button className="button primary" onClick={confirm}>
            {t`Yes, move my groups`}
          </button>
          <button className="button outline" onClick={reject}>
            {t`No, stop`}
          </button>
        </section>
      )}
      {phase.at === 'moving' && (
        <p className="lead" role="status">
          {t`Moving your groups. Keep both phones open…`}
        </p>
      )}
      {phase.at === 'done' && (
        <section className="empty">
          <h2>{t`Moved`}</h2>
          <p>
            {phase.count === 0 ? t`Your wallets are on the new phone now, and gone from this one.` : plural(phase.count, {
              one: 'Your group and wallets are on the new phone now, and gone from this one.',
              other: 'Your # groups and wallets are on the new phone now, and gone from this one.',
            })}
          </p>
          <a className="button primary" href="#/">
            {t`Done`}
          </a>
        </section>
      )}
      {phase.at === 'stopped' && (
        <section className="empty">
          <h2>{t`Not moved`}</h2>
          <p role="alert">{phase.message}</p>
          <button className="button primary" onClick={() => setPhase({ at: 'intro' })}>
            {t`Start again`}
          </button>
        </section>
      )}
    </main>
  )
}

/** "Code 1 2 3 4", for screen readers to read digit by digit. */
export const codeLabel = (code: string) => {
  const digits = code.split('').join(' ')
  return t`Code ${digits}`
}
