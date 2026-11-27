import { Trans } from '@lingui/react/macro'
import { plural, t } from '@lingui/core/macro'
import { useEffect, useState } from 'react'
import { Header } from '../components/Header.tsx'
import { encryptJson, isGroupKey, moveCode, newBoxKeys, newSigningKeys } from '../lib/crypto.ts'
import { helloKeys, MoveChannel, openHandover, receiveGroups } from '../lib/move.ts'
import { codeLabel } from './MoveScreen.tsx'

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
  const title = recovering ? t`Get back into a group` : t`Move to this phone`
  const other = recovering ? t`the phone helping you` : t`your other phone`
  const valid = isGroupKey(secret)
  const [phase, setPhase] = useState<Phase>({ at: 'connecting' })

  useEffect(() => {
    if (!valid) return
    let channel: MoveChannel | undefined
    let finished = false
    ;(async () => {
      try {
        const { keys, publicKey } = await newSigningKeys()
        // Only this phone can open what the other phone sends: it's locked to this key.
        const box = await newBoxKeys()
        let taken = false
        channel = new MoveChannel(
          secret,
          'new',
          async (msg) => {
            if (msg.type === 'cancel') {
              finished = true
              channel?.close()
              setPhase({ at: 'stopped', message: t`The move was stopped on the other phone. Nothing changed.` })
            } else if (msg.type === 'sealed' && !finished && !taken) {
              taken = true
              setPhase({ at: 'receiving' })
              try {
                const opened = await openHandover(msg, box.keys.privateKey)
                if (!opened) throw new Error(t`What the other phone sent didn’t open. Start again on the other phone.`)
                const { handover: h, sessionKey } = opened
                const addresses = h.lightningAddresses ?? (h.lightningAddress ? [h.lightningAddress] : [])
                const wallets = recovering ? [] : (h.sendWallets ?? [])
                const moved = await receiveGroups(h.groups, keys, publicKey, addresses, wallets, h.receiveWallets, recovering ? undefined : h.walletNames)
                await channel?.send({ from: 'new', type: 'done', proof: await encryptJson(sessionKey, moved) })
                finished = true
                channel?.close()
                setPhase({ at: 'done', count: h.groups.length, wallets: wallets.length })
              } catch (err) {
                setPhase({ at: 'stopped', message: (err as Error).message })
              }
            }
          },
          () => {
            if (!finished) setPhase({ at: 'stopped', message: t`Lost the connection. Start again on the other phone.` })
          },
        )
        await channel.open()
        const hello = { from: 'new', type: 'hello', key: publicKey, box: box.publicKey } as const
        await channel.send(hello)
        setPhase({ at: 'code', code: await moveCode(secret, helloKeys(hello)) })
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
          <h2>{t`This code isn’t complete`}</h2>
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
          <p className="move-code" aria-label={codeLabel(phase.code)}>
            {phase.code}
          </p>
          <p className="muted" role="status">
            <Trans>
              Waiting for {other}…
            </Trans>
          </p>
        </section>
      )}
      {phase.at === 'receiving' && (
        <p className="lead" role="status">
          {recovering ? t`Bringing your group here. Keep both phones open…` : t`Moving your groups here. Keep both phones open…`}
        </p>
      )}
      {phase.at === 'done' && (
        <section className="empty">
          <h2>{t`All here`}</h2>
          <p>
            {phase.count === 0 ? t`Nothing to move but your wallets.` : plural(phase.count, {
              one: 'Your group is on this phone now.',
              other: 'Your # groups are on this phone now.',
            })}{' '}
            {recovering
              ? t`Your wallet connection was on the lost phone: connect your wallet again in Settings, and in your wallet’s own app, turn off the connection the lost phone used.`
              : phase.wallets > 0
                ? plural(phase.wallets, {
                    one: 'Your wallet connection came too, in the same order.',
                    other: 'Your wallet connections came too, in the same order.',
                  })
                : t`If you paid from a wallet in this browser before, connect it again in Settings.`}
          </p>
          <a className="button primary" href="#/">
            {t`Open my groups`}
          </a>
        </section>
      )}
      {phase.at === 'stopped' && (
        <section className="empty">
          <h2>{t`Not moved`}</h2>
          <p role="alert">{phase.message}</p>
          <a className="button primary" href="#/">
            {t`Open Waroo`}
          </a>
        </section>
      )}
    </main>
  )
}
