import { useEffect, useState } from 'react'
import { Header } from '../components/Header.tsx'
import { isGroupKey, moveCode, newSigningKeys } from '../lib/crypto.ts'
import { MoveChannel, receiveGroups } from '../lib/move.ts'

type Phase =
  | { at: 'connecting' }
  | { at: 'code'; code: string }
  | { at: 'receiving' }
  | { at: 'done'; count: number; wallets: number }
  | { at: 'stopped'; message: string }

/** The new phone: makes its own key, shows the check code, receives the groups. */
export function MoveInScreen({ params }: { params: URLSearchParams }) {
  const secret = params.get('t') ?? ''
  // Someone else in a group is vouching for this phone, after the old one was lost.
  const recovering = params.get('r') === '1'
  const title = recovering ? 'Get back into a group' : 'Move to this phone'
  const other = recovering ? 'the phone helping you' : 'your other phone'
  const valid = isGroupKey(secret)
  const [phase, setPhase] = useState<Phase>({ at: 'connecting' })

  useEffect(() => {
    if (!valid) return
    let channel: MoveChannel | undefined
    let finished = false
    ;(async () => {
      try {
        const { keys, publicKey } = await newSigningKeys()
        channel = new MoveChannel(
          secret,
          'new',
          async (msg) => {
            if (msg.type === 'cancel') {
              finished = true
              channel?.close()
              setPhase({ at: 'stopped', message: 'The move was stopped on the other phone. Nothing changed.' })
            } else if (msg.type === 'groups' && !finished) {
              setPhase({ at: 'receiving' })
              try {
                const addresses = msg.lightningAddresses ?? (msg.lightningAddress ? [msg.lightningAddress] : [])
                const wallets = recovering ? [] : (msg.sendWallets ?? [])
                const moved = await receiveGroups(msg.groups, keys, publicKey, addresses, wallets)
                await channel?.send({ from: 'new', type: 'done', moved })
                finished = true
                channel?.close()
                setPhase({ at: 'done', count: msg.groups.length, wallets: wallets.length })
              } catch (err) {
                setPhase({ at: 'stopped', message: (err as Error).message })
              }
            }
          },
          () => {
            if (!finished) setPhase({ at: 'stopped', message: 'Lost the connection. Start again on the other phone.' })
          },
        )
        await channel.open()
        await channel.send({ from: 'new', type: 'hello', key: publicKey })
        setPhase({ at: 'code', code: await moveCode(secret, publicKey) })
      } catch (err) {
        setPhase({ at: 'stopped', message: (err as Error).message })
      }
    })()
    return () => {
      finished = true
      channel?.close()
    }
  }, [secret, valid])

  if (!valid) {
    return (
      <main className="screen">
        <Header title={title} back="/" />
        <section className="empty">
          <h2>This code isn’t complete</h2>
          <p>Scan the code on {other} again.</p>
        </section>
      </main>
    )
  }

  return (
    <main className="screen">
      <Header title={title} back="/" />
      {phase.at === 'connecting' && <p className="muted" role="status">Connecting to {other}…</p>}
      {phase.at === 'code' && (
        <section className="form">
          <p className="lead">Check {other} shows the same numbers, and confirm there.</p>
          <p className="move-code" aria-label={`Code ${phase.code.split('').join(' ')}`}>
            {phase.code}
          </p>
          <p className="muted" role="status">
            Waiting for {other}…
          </p>
        </section>
      )}
      {phase.at === 'receiving' && (
        <p className="lead" role="status">
          {recovering ? 'Bringing your group here' : 'Moving your groups here'}. Keep both phones open…
        </p>
      )}
      {phase.at === 'done' && (
        <section className="empty">
          <h2>All here</h2>
          <p>
            {phase.count === 0
              ? 'Nothing to move but your wallets.'
              : phase.count === 1
                ? 'Your group is on this phone now.'
                : `Your ${phase.count} groups are on this phone now.`}{' '}
            {recovering
              ? 'Your wallet connection was on the lost phone: connect your wallet again in Settings, and in your wallet’s own app, turn off the connection the lost phone used.'
              : phase.wallets > 0
                ? `Your wallet ${phase.wallets === 1 ? 'connection came' : 'connections came'} too, in the same order.`
                : 'If you paid from a wallet in this browser before, connect it again in Settings.'}
          </p>
          <a className="button primary" href="#/">
            Open my groups
          </a>
        </section>
      )}
      {phase.at === 'stopped' && (
        <section className="empty">
          <h2>Not moved</h2>
          <p role="alert">{phase.message}</p>
          <a className="button primary" href="#/">
            Open Footless
          </a>
        </section>
      )}
    </main>
  )
}
