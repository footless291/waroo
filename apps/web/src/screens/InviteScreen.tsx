import { Trans } from '@lingui/react/macro'
import { plural, t } from '@lingui/core/macro'
import { useEffect, useState } from 'react'
import { Header } from '../components/Header.tsx'
import { QrCode } from '../components/QrCode.tsx'
import { Segmented } from '../components/Segmented.tsx'
import { makeShareable, type GroupMeta } from '../lib/db.ts'
import { go, locale, useGroup } from '../lib/hooks.ts'
import {
  createInvite,
  inviteLinkFor,
  invitesFor,
  inviteStatus,
  stopInvite,
  type InviteStatus,
  type SavedInvite,
} from '../lib/invites.ts'
import { syncHub } from '../lib/sync.ts'

type Who = 'many' | 'one'
type Days = '1' | '7' | '30'

const whoOptions = (): { value: Who; label: string }[] => [
  { value: 'many', label: t`Several people` },
  { value: 'one', label: t`One person` },
]
const dayOptions = (): { value: Days; label: string }[] => [
  { value: '1', label: t`1 day` },
  { value: '7', label: t`1 week` },
  { value: '30', label: t`1 month` },
]

const until = (ms: number) =>
  new Intl.DateTimeFormat(locale(), { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(ms)

function describe(invite: SavedInvite) {
  const date = until(invite.expiresAt)
  return invite.oneTime ? t`For one person, until ${date}` : t`For several people, until ${date}`
}

function stateText(status: InviteStatus, oneTime: boolean): string {
  const state =
    status.state === 'open'
      ? t`Works`
      : status.state === 'used'
        ? t`Used`
        : status.state === 'expired'
          ? t`Expired`
          : status.state === 'stopped'
            ? t`Turned off`
            : t`Can’t check right now`
  if (oneTime || status.opens === 0) return state
  return plural(status.opens, { one: `${state}, opened once`, other: `${state}, opened # times` })
}

export function InviteScreen({ groupId }: { groupId: string }) {
  const group = useGroup(groupId)
  const [ready, setReady] = useState<GroupMeta>()
  const [who, setWho] = useState<Who>('many')
  const [days, setDays] = useState<Days>('7')
  const [current, setCurrent] = useState<SavedInvite>()
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [copied, setCopied] = useState(false)
  const [showQr, setShowQr] = useState(false)
  const [links, setLinks] = useState<(SavedInvite & { status?: InviteStatus })[]>([])

  useEffect(() => {
    makeShareable(groupId).then(async (g) => {
      await syncHub.ensure(g.id)
      setReady(g)
    })
  }, [groupId])

  async function refresh() {
    const saved = await invitesFor(groupId)
    setLinks(saved)
    const withStatus = await Promise.all(saved.map(async (i) => ({ ...i, status: await inviteStatus(i) })))
    setLinks(withStatus)
  }
  useEffect(() => {
    void refresh()
  }, [groupId])

  if (group === null) {
    go('/')
    return null
  }
  const name = group?.state.name ?? group?.meta.name ?? ''
  const link = current ? inviteLinkFor(current.secret) : ''
  const joined = group ? [...group.state.members.values()].filter((m) => m.key && !m.left) : []
  const canShare = typeof navigator.share === 'function'

  async function create() {
    if (!ready) return
    setBusy(true)
    setNote('')
    try {
      const invite = await createInvite(ready, { days: Number(days), oneTime: who === 'one' })
      setCurrent(invite)
      setShowQr(false)
      void refresh()
    } catch (err) {
      setNote((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function share() {
    try {
      await navigator.share({ title: name, text: t`Join ${name} on Waroo`, url: link })
    } catch {
      // Dismissed the share sheet: nothing to do.
    }
  }

  async function copy() {
    await navigator.clipboard.writeText(link)
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  }

  async function stop(invite: SavedInvite) {
    try {
      await stopInvite(invite)
      if (current?.secret === invite.secret) setCurrent(undefined)
      setNote(t`Link turned off. Nobody else can join with it.`)
      void refresh()
    } catch (err) {
      setNote((err as Error).message)
    }
  }

  return (
    <main className="screen">
      <Header title={t`Invite people`} back={`/g/${groupId}`} />
      <div className="form">
        <p className="lead">
          <Trans>
            Send the others a link to <strong>{name}</strong>. They open it, pick who they are, and the group appears on
            their phone with everything added so far.
          </Trans>
        </p>

        {!current ? (
          <section className="settings-card">
            <fieldset className="field">
              <legend>{t`Who it’s for`}</legend>
              <Segmented label={t`Who it’s for`} options={whoOptions()} value={who} onChange={setWho} />
            </fieldset>
            <fieldset className="field">
              <legend>{t`Works for`}</legend>
              <Segmented label={t`Works for`} options={dayOptions()} value={days} onChange={setDays} />
            </fieldset>
            <button className="button primary" disabled={!ready || busy} onClick={create}>
              {busy ? t`Making the link…` : t`Create invite link`}
            </button>
          </section>
        ) : (
          <section className="invite-link">
            <p className="invite-link-terms">{describe(current)}</p>
            {canShare && (
              <button className="button primary" onClick={share}>
                {t`Share invite link`}
              </button>
            )}
            <div className="button-row">
              <button className={`button ${canShare ? 'outline' : 'primary'}`} onClick={copy}>
                {copied ? t`Link copied` : t`Copy link`}
              </button>
              <button className="button outline" onClick={() => setShowQr(!showQr)} aria-expanded={showQr}>
                {showQr ? t`Hide QR code` : t`Show QR code`}
              </button>
            </div>
            {showQr && (
              <div className="qr-box">
                <QrCode text={link} label={t`QR code for the invite link`} />
                <p className="muted">{t`Scan it in Waroo on the other phone, with the scan button.`}</p>
              </div>
            )}
            <button className="link" onClick={() => setCurrent(undefined)}>
              {t`Make a different link`}
            </button>
          </section>
        )}
        <p className="hint" aria-live="polite">
          {copied ? t`Invite link copied. Paste it to the people in this group.` : note}
        </p>

        <section className="notice-card">
          <h2>{t`Share it only with the group`}</h2>
          <p>
            {t`Whoever opens the link while it works can join and see the group’s expenses. Nobody else can read them, not even Waroo.`}
          </p>
        </section>

        {links.length > 0 && (
          <section className="section">
            <h2 className="section-title">{t`Your invite links`}</h2>
            <ul className="cards">
              {links.map((i) => (
                <li key={i.secret} className="card-row invite-row">
                  <span className="row-main">
                    <strong>{describe(i)}</strong>
                    <span className="muted">{i.status ? stateText(i.status, i.oneTime) : t`Checking…`}</span>
                  </span>
                  {i.status?.state === 'open' && (
                    <button className="button small outline" onClick={() => stop(i)} aria-label={t`Turn off: ${describe(i)}`}>
                      {t`Turn off`}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        <p className="muted">{joinedSoFar(joined.filter((m) => m.id !== group?.meta.meId).map((m) => m.name))}</p>
      </div>
    </main>
  )
}

/** "Joined so far: you, Ana and Bob" */
function joinedSoFar(others: string[]) {
  if (others.length === 0) return t`Joined so far: just you`
  const names = new Intl.ListFormat(locale(), { type: 'conjunction' }).format(others)
  return t`Joined so far: you, ${names}`
}
