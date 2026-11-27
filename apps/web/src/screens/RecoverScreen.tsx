import { Trans } from '@lingui/react/macro'
import { t } from '@lingui/core/macro'
import { receiveAddresses, receiveTargets } from '@waroo/ledger'
import { useEffect, useRef, useState } from 'react'
import { Header } from '../components/Header.tsx'
import { QrCode } from '../components/QrCode.tsx'
import { moveCode } from '../lib/crypto.ts'
import { go, useGroup } from '../lib/hooks.ts'
import { doneIsGenuine, helloKeys, MoveChannel, newMoveSecret, sealHandover, type MoveMessage } from '../lib/move.ts'
import { recoverMember } from '../lib/rekey.ts'
import { codeLabel } from './MoveScreen.tsx'
import { groupTitle } from '../lib/title.ts'

type Phase =
  | { at: 'intro' }
  | { at: 'starting' }
  | { at: 'waiting'; secret: string }
  | { at: 'confirm'; secret: string; key: string; box: string; code: string }
  | { at: 'moving' }
  | { at: 'done' }
  | { at: 'stopped'; message: string }

const recoverLink = (secret: string) => `${location.origin}/#/move-in?t=${secret}&r=1`

/**
 * Someone lost their phone: this phone vouches for their new one. Works like
 * moving to a new phone, with this phone standing in for the lost one.
 */
export function RecoverScreen({ groupId, memberId }: { groupId: string; memberId: string }) {
  const group = useGroup(groupId)
  const [phase, setPhase] = useState<Phase>({ at: 'intro' })
  const [copied, setCopied] = useState(false)
  const channel = useRef<MoveChannel>(undefined)
  const phaseRef = useRef(phase)
  phaseRef.current = phase
  const answered = useRef(false)
  const sessionKey = useRef<string>(undefined)

  useEffect(() => () => channel.current?.close(), [])

  if (group === undefined) return <main className="screen" />
  if (group === null) {
    go('/')
    return null
  }
  const { meta, state } = group
  const person = state.members.get(memberId)
  if (!person || person.left || memberId === meta.meId) {
    go(`/g/${groupId}`)
    return null
  }
  const who = person.name
  const groupName = groupTitle(state, meta)
  const back = `/g/${groupId}/m/${memberId}`

  function stop(message: string) {
    channel.current?.close()
    channel.current = undefined
    setPhase({ at: 'stopped', message })
  }

  async function onMessage(msg: MoveMessage, secret: string) {
    const now = phaseRef.current
    if (msg.type === 'hello') {
      // Checked and set before anything waits, so two hellos can't both count.
      if (answered.current || now.at !== 'waiting') {
        await channel.current?.send({ from: 'old', type: 'cancel' })
        return stop(t`Another phone also used the code, so this was stopped. Nothing changed. Start again.`)
      }
      answered.current = true
      if (typeof msg.key !== 'string' || typeof msg.box !== 'string') return stop(t`The new phone needs updating first. Open Waroo on it again, then start over.`)
      setPhase({ at: 'confirm', secret, key: msg.key, box: msg.box, code: await moveCode(secret, helloKeys(msg)) })
    } else if (msg.type === 'done' && now.at === 'moving' && (await doneIsGenuine(msg, sessionKey.current))) {
      channel.current?.close()
      channel.current = undefined
      setPhase({ at: 'done' })
    } else if (msg.type === 'cancel') {
      stop(t`It was cancelled on ${who}’s new phone. Nothing changed.`)
    }
  }

  async function start() {
    setPhase({ at: 'starting' })
    answered.current = false
    sessionKey.current = undefined
    try {
      const secret = newMoveSecret()
      const ch = new MoveChannel(
        secret,
        'old',
        (msg) => void onMessage(msg, secret),
        () => {
          const at = phaseRef.current.at
          if (at === 'waiting' || at === 'confirm' || at === 'moving') stop(t`Lost the connection. Start again.`)
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
      const moved = await recoverMember(groupId, memberId, phase.key)
      const addresses = person ? receiveAddresses(person) : []
      const targets = person ? receiveTargets(person) : []
      const sealed = await sealHandover({
        from: 'old',
        type: 'groups',
        groups: [moved],
        lightningAddress: addresses[0] ?? '',
        lightningAddresses: addresses,
        receiveWallets: targets.map((address) => ({ address })),

      }, phase.box)
      sessionKey.current = sealed.sessionKey
      await channel.current?.send(sealed.message)
    } catch (err) {
      stop((err as Error).message)
    }
  }

  async function reject() {
    await channel.current?.send({ from: 'old', type: 'cancel' })
    stop(t`Stopped. Nothing changed, and the phone that used the code got nothing.`)
  }

  async function copy(secret: string) {
    try {
      await navigator.clipboard.writeText(recoverLink(secret))
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return (
    <main className="screen">
      <Header title={t`${who} lost their phone`} back={back} />
      {phase.at === 'intro' && (
        <section className="form">
          <p className="lead">
            <Trans>
              Vouch for {who}’s new phone, so they’re back in {groupName} as themselves.
            </Trans>
          </p>
          <ul className="steps">
            <li>{who} installs Waroo on the new phone and opens it from the Home Screen.</li>
            <li>{t`They tap the scan button and scan the code this phone will show. Not together? Send them the link instead.`}</li>
            <li>Check both phones show the same 4 numbers. If you’re apart, call {who} and read them out.</li>
          </ul>
          <p className="muted">
            <Trans>
              The lost phone stops working in {groupName}, and can’t read anything new. Everyone in the group sees that
              you vouched. Do it only when you’re sure it’s really {who}.
            </Trans>
          </p>
          <button className="button primary" onClick={start}>
            {t`Show the code`}
          </button>
        </section>
      )}
      {phase.at === 'starting' && <p className="muted" role="status">{t`Getting ready…`}</p>}
      {phase.at === 'waiting' && (
        <section className="move-qr" data-move-link={recoverLink(phase.secret)}>
          <p className="lead">On {who}’s new phone, open Waroo, tap the scan button and scan this code.</p>
          <QrCode text={recoverLink(phase.secret)} label={t`Code for ${who}’s new phone to scan`} />
          <button className="button outline" onClick={() => copy(phase.secret)}>
            {copied ? t`Link copied` : t`Copy link instead`}
          </button>
          <p className="muted">
            <Trans>
              Sending the link? {who} pastes it under the scanner in Waroo. You’ll still check the numbers together.
            </Trans>
          </p>
          <p className="muted" role="status">
            <Trans>
              Waiting for {who}’s new phone…
            </Trans>
          </p>
        </section>
      )}
      {phase.at === 'confirm' && (
        <section className="form">
          <p className="lead">Does {who}’s new phone show these numbers?</p>
          <p className="move-code" aria-label={codeLabel(phase.code)}>
            {phase.code}
          </p>
          <button className="button primary" onClick={confirm}>
            <Trans>
              Yes, it’s {who}
            </Trans>
          </button>
          <button className="button outline" onClick={reject}>
            {t`No, stop`}
          </button>
        </section>
      )}
      {phase.at === 'moving' && (
        <p className="lead" role="status">
          <Trans>
            Bringing {who} back in. Keep both phones open…
          </Trans>
        </p>
      )}
      {phase.at === 'done' && (
        <section className="empty">
          <h2>{who} is back</h2>
          <p>
            {who} is in {groupName} on the new phone. The lost phone can’t add anything or read anything new.
          </p>
          <a className="button primary" href={`#/g/${groupId}`}>
            {t`Done`}
          </a>
        </section>
      )}
      {phase.at === 'stopped' && (
        <section className="empty">
          <h2>{t`Nothing changed`}</h2>
          <p role="alert">{phase.message}</p>
          <button className="button primary" onClick={() => setPhase({ at: 'intro' })}>
            {t`Start again`}
          </button>
        </section>
      )}
    </main>
  )
}
