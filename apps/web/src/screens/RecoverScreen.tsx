import { receiveAddresses } from '@footless/ledger'
import { useEffect, useRef, useState } from 'react'
import { Header } from '../components/Header.tsx'
import { QrCode } from '../components/QrCode.tsx'
import { moveCode } from '../lib/crypto.ts'
import { go, useGroup } from '../lib/hooks.ts'
import { MoveChannel, newMoveSecret, type MoveMessage } from '../lib/move.ts'
import { recoverMember } from '../lib/rekey.ts'

type Phase =
  | { at: 'intro' }
  | { at: 'starting' }
  | { at: 'waiting'; secret: string }
  | { at: 'confirm'; secret: string; key: string; code: string }
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
  const groupName = state.name ?? meta.name
  const back = `/g/${groupId}/m/${memberId}`

  function stop(message: string) {
    channel.current?.close()
    channel.current = undefined
    setPhase({ at: 'stopped', message })
  }

  async function onMessage(msg: MoveMessage, secret: string) {
    const now = phaseRef.current
    if (msg.type === 'hello') {
      if (now.at !== 'waiting') {
        await channel.current?.send({ from: 'old', type: 'cancel' })
        return stop('Another phone also used the code, so this was stopped. Nothing changed. Start again.')
      }
      setPhase({ at: 'confirm', secret, key: msg.key, code: await moveCode(secret, msg.key) })
    } else if (msg.type === 'done' && now.at === 'moving') {
      channel.current?.close()
      channel.current = undefined
      setPhase({ at: 'done' })
    } else if (msg.type === 'cancel') {
      stop(`It was cancelled on ${who}’s new phone. Nothing changed.`)
    }
  }

  async function start() {
    setPhase({ at: 'starting' })
    try {
      const secret = newMoveSecret()
      const ch = new MoveChannel(
        secret,
        'old',
        (msg) => void onMessage(msg, secret),
        () => {
          const at = phaseRef.current.at
          if (at === 'waiting' || at === 'confirm' || at === 'moving') stop('Lost the connection. Start again.')
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
      await channel.current?.send({
        from: 'old',
        type: 'groups',
        groups: [moved],
        lightningAddress: addresses[0] ?? '',
        lightningAddresses: addresses,
      })
    } catch (err) {
      stop((err as Error).message)
    }
  }

  async function reject() {
    await channel.current?.send({ from: 'old', type: 'cancel' })
    stop('Stopped. Nothing changed, and the phone that used the code got nothing.')
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
      <Header title={`${who} lost their phone`} back={back} />
      {phase.at === 'intro' && (
        <section className="form">
          <p className="lead">
            Vouch for {who}’s new phone, so they’re back in {groupName} as themselves.
          </p>
          <ul className="steps">
            <li>{who} installs Footless on the new phone and opens it from the Home Screen.</li>
            <li>They tap the scan button and scan the code this phone will show. Not together? Send them the link instead.</li>
            <li>Check both phones show the same 4 numbers. If you’re apart, call {who} and read them out.</li>
          </ul>
          <p className="muted">
            The lost phone stops working in {groupName}, and can’t read anything new. Everyone in the group sees that
            you vouched. Do it only when you’re sure it’s really {who}.
          </p>
          <button className="button primary" onClick={start}>
            Show the code
          </button>
        </section>
      )}
      {phase.at === 'starting' && <p className="muted" role="status">Getting ready…</p>}
      {phase.at === 'waiting' && (
        <section className="move-qr" data-move-link={recoverLink(phase.secret)}>
          <p className="lead">On {who}’s new phone, open Footless, tap the scan button and scan this code.</p>
          <QrCode text={recoverLink(phase.secret)} label={`Code for ${who}’s new phone to scan`} />
          <button className="button outline" onClick={() => copy(phase.secret)}>
            {copied ? 'Link copied' : 'Copy link instead'}
          </button>
          <p className="muted">
            Sending the link? {who} pastes it under the scanner in Footless. You’ll still check the numbers together.
          </p>
          <p className="muted" role="status">
            Waiting for {who}’s new phone…
          </p>
        </section>
      )}
      {phase.at === 'confirm' && (
        <section className="form">
          <p className="lead">Does {who}’s new phone show these numbers?</p>
          <p className="move-code" aria-label={`Code ${phase.code.split('').join(' ')}`}>
            {phase.code}
          </p>
          <button className="button primary" onClick={confirm}>
            Yes, it’s {who}
          </button>
          <button className="button outline" onClick={reject}>
            No, stop
          </button>
        </section>
      )}
      {phase.at === 'moving' && (
        <p className="lead" role="status">
          Bringing {who} back in. Keep both phones open…
        </p>
      )}
      {phase.at === 'done' && (
        <section className="empty">
          <h2>{who} is back</h2>
          <p>
            {who} is in {groupName} on the new phone. The lost phone can’t add anything or read anything new.
          </p>
          <a className="button primary" href={`#/g/${groupId}`}>
            Done
          </a>
        </section>
      )}
      {phase.at === 'stopped' && (
        <section className="empty">
          <h2>Nothing changed</h2>
          <p role="alert">{phase.message}</p>
          <button className="button primary" onClick={() => setPhase({ at: 'intro' })}>
            Start again
          </button>
        </section>
      )}
    </main>
  )
}
