import { useEffect, useState } from 'react'
import { Header } from '../components/Header.tsx'
import { isGroupKey, moveCode, newSigningKeys } from '../lib/crypto.ts'
import { MoveChannel, receiveGroups } from '../lib/move.ts'

type Phase =
  | { at: 'connecting' }
  | { at: 'code'; code: string }
  | { at: 'receiving' }
  | { at: 'done'; count: number }
  | { at: 'stopped'; message: string }

/** The new phone: makes its own key, shows the check code, receives the groups. */
export function MoveInScreen({ params }: { params: URLSearchParams }) {
  const secret = params.get('t') ?? ''
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
                const moved = await receiveGroups(msg.groups, keys, publicKey, addresses)
                await channel?.send({ from: 'new', type: 'done', moved })
                finished = true
                channel?.close()
                setPhase({ at: 'done', count: msg.groups.length })
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
        <Header title="Move to this phone" back="/" />
        <section className="empty">
          <h2>This code isn’t complete</h2>
          <p>Scan the code on your other phone again.</p>
        </section>
      </main>
    )
  }

  return (
    <main className="screen">
      <Header title="Move to this phone" back="/" />
      {phase.at === 'connecting' && <p className="muted" role="status">Connecting to your other phone…</p>}
      {phase.at === 'code' && (
        <section className="form">
          <p className="lead">Check your other phone shows the same numbers, and confirm there.</p>
          <p className="move-code" aria-label={`Code ${phase.code.split('').join(' ')}`}>
            {phase.code}
          </p>
          <p className="muted" role="status">
            Waiting for your other phone…
          </p>
        </section>
      )}
      {phase.at === 'receiving' && (
        <p className="lead" role="status">
          Moving your groups here. Keep both phones open…
        </p>
      )}
      {phase.at === 'done' && (
        <section className="empty">
          <h2>All here</h2>
          <p>
            {phase.count === 1 ? 'Your group is' : `Your ${phase.count} groups are`} on this phone now. If you paid with a
            connected wallet before, connect it again in You.
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
