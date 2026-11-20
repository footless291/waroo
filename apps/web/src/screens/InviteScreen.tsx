import { useEffect, useState } from 'react'
import { Header } from '../components/Header.tsx'
import { QrCode } from '../components/QrCode.tsx'
import { makeShareable, type GroupMeta } from '../lib/db.ts'
import { go, useGroup } from '../lib/hooks.ts'
import { syncHub } from '../lib/sync.ts'

/** The invite link. Everything after `#` stays in the browser: servers never see the key. */
export function inviteLink(group: GroupMeta): string {
  const params = new URLSearchParams({ g: group.id, k: group.key!, from: group.meId })
  return `${location.origin}/#/join?${params}`
}

export function InviteScreen({ groupId }: { groupId: string }) {
  const group = useGroup(groupId)
  const [ready, setReady] = useState<GroupMeta>()
  const [copied, setCopied] = useState(false)
  const [showQr, setShowQr] = useState(false)

  useEffect(() => {
    makeShareable(groupId).then(async (g) => {
      await syncHub.ensure(g.id)
      setReady(g)
    })
  }, [groupId])

  if (group === null) {
    go('/')
    return null
  }
  const name = group?.state.name ?? group?.meta.name ?? ''
  const link = ready ? inviteLink(ready) : ''
  const joined = group ? [...group.state.members.values()].filter((m) => m.key) : []
  const canShare = typeof navigator.share === 'function'

  async function share() {
    try {
      await navigator.share({ title: name, text: `Join ${name} on Footless`, url: link })
    } catch {
      // Dismissed the share sheet: nothing to do.
    }
  }

  async function copy() {
    await navigator.clipboard.writeText(link)
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  }

  return (
    <main className="screen">
      <Header title="Invite people" back={`/g/${groupId}`} />
      <div className="form">
        <p className="lead">
          Send the others a link to <strong>{name}</strong>. They open it, pick who they are, and the group appears on
          their phone with everything added so far.
        </p>

        {canShare ? (
          <button className="button primary" disabled={!ready} onClick={share}>
            Share invite link
          </button>
        ) : null}
        <div className="button-row">
          <button className={`button ${canShare ? 'outline' : 'primary'}`} disabled={!ready} onClick={copy}>
            {copied ? 'Link copied' : 'Copy link'}
          </button>
          <button className="button outline" disabled={!ready} onClick={() => setShowQr(!showQr)} aria-expanded={showQr}>
            {showQr ? 'Hide QR code' : 'Show QR code'}
          </button>
        </div>
        <p className="hint" aria-live="polite">
          {copied ? 'Invite link copied. Paste it to the people in this group.' : ''}
        </p>
        {showQr && link && (
          <div className="qr-box">
            <QrCode text={link} label="QR code for the invite link" />
            <p className="muted">Scan with the other phone’s camera.</p>
          </div>
        )}

        <section className="notice-card">
          <h2>Share it only with the group</h2>
          <p>
            Anyone with this link can join and see the group’s expenses. The link holds the group’s key, so
            nobody else, not even Footless, can read them.
          </p>
        </section>

        <p className="muted">
          Joined so far:{' '}
          {joined.length <= 1
            ? 'just you'
            : joined.map((m) => (m.id === group?.meta.meId ? 'you' : m.name)).join(', ')}
        </p>
      </div>
    </main>
  )
}
