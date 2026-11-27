import { Trans } from '@lingui/react/macro'
import { plural, t } from '@lingui/core/macro'
import { groupBalances, type GroupState } from '@waroo/ledger'
import { useEffect, useState, type FormEvent } from 'react'
import { Avatar } from '../components/Avatar.tsx'
import { Header, PageTitle } from '../components/Header.tsx'
import { QrCode } from '../components/QrCode.tsx'
import { createFriend, deleteGroupLocally, makeShareable, myLastName, replayGroup, type GroupMeta } from '../lib/db.ts'
import { money } from '../lib/format.ts'
import { groupTitle } from '../lib/title.ts'
import { go, useGroup, useGroups, useLoad } from '../lib/hooks.ts'
import { currentLocale } from '../lib/i18n.ts'
import { listGroups } from '../lib/db.ts'
import { createInvite, inviteLinkFor, invitesFor, inviteStatus, stopInvite, type SavedInvite } from '../lib/invites.ts'
import { syncHub } from '../lib/sync.ts'
import { friendIn, friendshipState, publishFriendLinks, reconnect, removeFriend, sharedGroups, type FriendGroup } from '../lib/friends.ts'

/**
 * Friends: people you split with outside any group. Each friendship is a
 * private group of two under the hood, so everything a group can do (add
 * expenses, settle up in bitcoin, move phones) works here too.
 */
export function FriendsPage() {
  const groups = useGroups()
  const all = groups?.filter((g) => g.friend)
  // Friendships you removed are archived: listed separately, history kept.
  const removed = useLoad(
    async () => new Set((await Promise.all((all ?? []).map(async (g) => [g.id, friendshipState(await replayGroup(g.id), g.meId)] as const))).filter(([, s]) => s === 'removed').map(([id]) => id)),
    [groups],
  )
  const friends = removed ? all?.filter((g) => !removed.has(g.id)) : undefined
  return (
    <div className="screen with-tabbar">
      <PageTitle>{t`Friends`}</PageTitle>
      {friends && friends.length === 0 && (
        <section className="empty">
          <h2>{t`Split with a friend, no group needed`}</h2>
          <p>
            <Trans>Add a friend once, then keep track of lunches, taxis and loans between the two of you, and settle up any time.</Trans>
          </p>
          <div className="empty-actions">
            <a className="button primary" href="#/friends/add">
              {t`Add a friend`}
            </a>
          </div>
        </section>
      )}
      {friends && friends.length > 0 && (
        <ul className="cards">
          {friends.map((g) => (
            <li key={g.id}>
              <FriendRow group={g} />
            </li>
          ))}
        </ul>
      )}
      {removed && removed.size > 0 && (
        <a className="archived-link" href="#/friends/archived">
          {plural(removed.size, { one: 'Removed friends (#)', other: 'Removed friends (#)' })}
        </a>
      )}
    </div>
  )
}

/** Friends you removed: their history stays, here, until you delete it. */
export function ArchivedFriendsScreen() {
  const groups = useGroups()
  const removed = useLoad(
    async () => {
      const out = []
      for (const g of groups ?? []) {
        if (!g.friend) continue
        const state = await replayGroup(g.id)
        if (friendshipState(state, g.meId) === 'removed') out.push({ id: g.id, name: groupTitle(state, g) })
      }
      return out
    },
    [groups],
  )
  return (
    <main className="screen">
      <Header title={t`Removed friends`} back="/friends" />
      <p className="lead">{t`Their history stays here until you delete it.`}</p>
      {removed && removed.length === 0 && <p className="muted">{t`Nobody here.`}</p>}
      <ul className="cards">
        {(removed ?? []).map((f) => (
          <li key={f.id}>
            <a className="card-row" href={`#/g/${f.id}`}>
              <span className="row-main">
                <strong>{f.name}</strong>
              </span>
              <span className="chevron" aria-hidden="true">›</span>
            </a>
          </li>
        ))}
      </ul>
    </main>
  )
}

/**
 * On a friend's page, when it's no longer a working friendship: you removed
 * them (archived: reconnect or delete), or they removed you (disconnected:
 * send a new friend code or delete).
 */
export function FriendStatus({ friendship, state }: { friendship: GroupMeta; state: GroupState }) {
  const status = friendshipState(state, friendship.meId)
  const [busy, setBusy] = useState(false)
  const name = groupTitle(state, friendship)
  if (status !== 'removed' && status !== 'disconnected') return null

  async function forget() {
    setBusy(true)
    for (const saved of await invitesFor(friendship.id)) await stopInvite(saved).catch(() => {})
    syncHub.drop(friendship.id)
    await deleteGroupLocally(friendship.id)
    go('/friends')
  }
  async function comeBack() {
    setBusy(true)
    await reconnect(friendship, state.members.get(friendship.meId)?.name ?? '')
    setBusy(false)
  }

  return (
    <section className="invite-card friend-status">
      {status === 'removed' ? (
        <>
          <h2>{t`You removed ${name}`}</h2>
          <p>{t`Your history together stays here. Reconnect to split with them again.`}</p>
          <button className="button primary" disabled={busy} onClick={() => void comeBack()}>
            {t`Reconnect`}
          </button>
        </>
      ) : (
        <>
          <h2>{t`Disconnected`}</h2>
          <p>{t`You and ${name} aren’t connected any more. Your history together stays here.`}</p>
          <a className="button primary" href={`#/friends/add?g=${friendship.id}`}>
            {t`Send a new friend code`}
          </a>
        </>
      )}
      <ConfirmDelete name={name} busy={busy} onDelete={() => void forget()} />
    </section>
  )
}

function ConfirmDelete({ name, busy, onDelete }: { name: string; busy: boolean; onDelete: () => void }) {
  const [asking, setAsking] = useState(false)
  if (!asking) {
    return (
      <button className="button danger" onClick={() => setAsking(true)}>
        {t`Delete from this phone`}
      </button>
    )
  }
  return (
    <div className="confirm">
      <p>{t`Delete everything with ${name} from this phone? Their copy stays on their phone. This can’t be undone.`}</p>
      <button className="button danger-fill" disabled={busy} onClick={onDelete}>
        {t`Delete`}
      </button>
      <button className="button outline" onClick={() => setAsking(false)}>
        {t`Cancel`}
      </button>
    </div>
  )
}

/** At the bottom of a friend's page: end the friendship, once you're all square. */
export function RemoveFriend({ friendship, state }: { friendship: GroupMeta; state: GroupState }) {
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  if (friendshipState(state, friendship.meId) !== 'connected') return null
  const name = groupTitle(state, friendship)
  const square = [...groupBalances(state).values()].every((byPerson) => !byPerson.get(friendship.meId))

  async function remove() {
    setBusy(true)
    await removeFriend(friendship)
    go('/friends')
  }

  return (
    <section className="remove-friend">
      {!square ? (
        <p className="hint pad">{t`To remove ${name} as a friend, settle up first.`}</p>
      ) : asking ? (
        <div className="confirm">
          <p>{t`Remove ${name} as a friend? You’ll keep your history together, archived. They won’t be notified, but they’ll see you’re no longer connected.`}</p>
          <button className="button danger-fill" disabled={busy} onClick={() => void remove()}>
            {t`Remove`}
          </button>
          <button className="button outline" onClick={() => setAsking(false)}>
            {t`Cancel`}
          </button>
        </div>
      ) : (
        <button className="button danger" onClick={() => setAsking(true)}>
          {t`Remove ${name} as a friend`}
        </button>
      )}
    </section>
  )
}

function FriendRow({ group }: { group: GroupMeta }) {
  const [summary, setSummary] = useState<{ state: GroupState; other?: string; name: string; waiting: boolean; disconnected: boolean; lines: { amount: number; currency: string }[]; groups: number }>()
  useEffect(() => {
    void (async () => {
      const state = await replayGroup(group.id)
      const status = friendshipState(state, group.meId)
      const other = status === 'disconnected' ? [...state.members.values()].find((m) => m.id !== group.meId)?.id : friendIn(state, group.meId)?.id
      const waiting = status === 'waiting'
      const shared = waiting ? [] : await sharedGroups(group, state)
      setSummary({ state, other, name: groupTitle(state, group), waiting, disconnected: status === 'disconnected', lines: totalOwed(group, state, shared), groups: shared.length })
    })()
  }, [group])
  if (!summary) return <span className="card-row" />
  const href = summary.waiting ? `#/friends/add?g=${group.id}` : `#/g/${group.id}`
  return (
    <a className="card-row" href={href}>
      {summary.other && <Avatar state={summary.state} id={summary.other} />}
      <span className="row-main">
        <strong>{summary.waiting ? t`Friend code, not used yet` : summary.name}</strong>
        {summary.waiting ? (
          <span className="muted">{t`Waiting for your friend to scan it`}</span>
        ) : summary.disconnected ? (
          <span className="muted">{t`Disconnected`}</span>
        ) : summary.lines.length === 0 ? (
          <span className="muted">{t`All square`}</span>
        ) : (
          <span className="position">
            {summary.lines.map(({ amount, currency }) => {
              const sum = money(Math.abs(amount), currency)
              return (
                <span key={currency} className={amount > 0 ? 'owed' : 'owes'}>
                  {amount > 0 ? t`Owes you ${sum}` : t`You owe ${sum}`}
                </span>
              )
            })}
          </span>
        )}
        {summary.groups > 0 && (
          <span className="muted small">{plural(summary.groups, { one: 'Counting # group you share', other: 'Counting # groups you share' })}</span>
        )}
      </span>
      <span className="chevron" aria-hidden="true">›</span>
    </a>
  )
}

/**
 * Everything owed between you and a friend: between the two of you, plus
 * what each shared group suggests you pay each other. Positive: they owe you.
 */
function totalOwed(friendship: GroupMeta, state: GroupState, shared: FriendGroup[]) {
  const total = new Map<string, number>()
  for (const [currency, byPerson] of groupBalances(state)) {
    const mine = byPerson.get(friendship.meId)
    if (mine) total.set(currency, mine)
  }
  for (const g of shared) for (const [currency, amount] of g.owed) total.set(currency, (total.get(currency) ?? 0) + amount)
  return [...total].filter(([, amount]) => amount !== 0).map(([currency, amount]) => ({ currency, amount }))
}

/** On a friend's page: your groups with them, and the total across everything. */
export function FriendAcross({ friendship, state }: { friendship: GroupMeta; state: GroupState }) {
  const [shared, setShared] = useState<FriendGroup[]>()
  useEffect(() => {
    void sharedGroups(friendship, state).then(setShared)
  }, [friendship, state])
  if (!shared || shared.length === 0) return null
  const total = totalOwed(friendship, state, shared)
  const owedText = (owed: { amount: number; currency: string }[]) =>
    owed.length === 0
      ? t`All square`
      : owed
          .map(({ amount, currency }) => {
            const sum = money(Math.abs(amount), currency)
            return amount > 0 ? t`Owes you ${sum}` : t`You owe ${sum}`
          })
          .join(' · ')
  return (
    <section className="section friend-across">
      <h2>{t`In your groups too`}</h2>
      <ul className="cards">
        {shared.map((g) => {
          const owed = [...g.owed].map(([currency, amount]) => ({ currency, amount }))
          return (
            <li key={g.groupId}>
              <a className="card-row" href={`#/g/${g.groupId}`}>
                <span className="row-main">
                  <strong>{g.name}</strong>
                  <span className={owed.length === 0 ? 'muted' : owed[0]!.amount > 0 ? 'owed' : 'owes'}>{owedText(owed)}</span>
                </span>
                <span className="chevron" aria-hidden="true">›</span>
              </a>
            </li>
          )
        })}
      </ul>
      <p className="friend-total">
        <span>{t`Everything together`}</span>
        <strong className={total.length === 0 ? '' : total[0]!.amount > 0 ? 'owed' : 'owes'}>{owedText(total)}</strong>
      </p>
      <p className="hint pad">{t`Each group settles up on its own: open one to pay or mark a payment.`}</p>
    </section>
  )
}

/** Adding a friend: your name, then a one-person code for them to scan (or a link to send). */
export function AddFriendScreen({ params }: { params: URLSearchParams }) {
  const groupId = params.get('g')
  return groupId ? <FriendCode key={groupId} groupId={groupId} /> : <StartFriend />
}

function StartFriend() {
  const [myName, setMyName] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    void myLastName().then((name) => setMyName((typed) => typed || name))
  }, [])

  async function start(e: FormEvent) {
    e.preventDefault()
    if (!myName.trim() || busy) return
    setBusy(true)
    const group = await createFriend({ myName: myName.trim(), currency: await defaultCurrency() })
    go(`/friends/add?g=${group.id}`)
  }

  return (
    <main className="screen">
      <Header title={t`Add a friend`} back="/friends" />
      <form className="form" onSubmit={start}>
        <p className="lead">{t`You’ll get a code for your friend to scan with Waroo, or a link to send them.`}</p>
        <label className="field">
          <span>{t`Your name, as your friend knows you`}</span>
          <input value={myName} onChange={(e) => setMyName(e.target.value)} autoComplete="given-name" maxLength={80} />
        </label>
        <button className="button primary" disabled={!myName.trim() || busy}>
          {t`Make a friend code`}
        </button>
      </form>
    </main>
  )
}

const FRIEND_CODE_DAYS = 7

/** The currency of the newest group on this phone; otherwise yen in Japan (or in Japanese), dollars elsewhere. */
async function defaultCurrency(): Promise<string> {
  const latest = (await listGroups())[0]
  if (latest) return latest.currency
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
  return zone === 'Asia/Tokyo' || currentLocale() === 'ja' ? 'JPY' : 'USD'
}

function FriendCode({ groupId }: { groupId: string }) {
  const group = useGroup(groupId)
  const [invite, setInvite] = useState<SavedInvite>()
  const [problem, setProblem] = useState('')
  const [copied, setCopied] = useState(false)
  const joined = group ? [...group.state.members.values()].find((m) => m.id !== group.meta.meId && !m.left) : undefined

  useEffect(() => {
    let live = true
    ;(async () => {
      try {
        const ready = await makeShareable(groupId)
        await syncHub.ensure(groupId)
        // Reuse a code that still works; otherwise make one.
        for (const saved of await invitesFor(groupId)) {
          if (saved.expiresAt > Date.now() && (await inviteStatus(saved).catch(() => null))?.state === 'open') {
            if (live) setInvite(saved)
            return
          }
        }
        const made = await createInvite(ready, { days: FRIEND_CODE_DAYS, oneTime: true })
        if (live) setInvite(made)
      } catch (err) {
        if (live) setProblem((err as Error).message)
      }
    })()
    return () => {
      live = false
    }
  }, [groupId])

  // Once they've joined, the friendship is ready: open it.
  useEffect(() => {
    if (joined) {
      void publishFriendLinks()
      go(`/g/${groupId}?joined=1`)
    }
  }, [joined, groupId])

  if (group === null) {
    go('/friends')
    return null
  }
  const link = invite ? inviteLinkFor(invite.secret) : ''
  const canShare = typeof navigator.share === 'function'

  async function share() {
    try {
      await navigator.share({ title: t`Add me on Waroo`, text: t`Add me as a friend on Waroo`, url: link })
    } catch {
      // Dismissed.
    }
  }
  async function copy() {
    await navigator.clipboard.writeText(link)
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  }
  async function cancel() {
    for (const saved of await invitesFor(groupId)) await stopInvite(saved).catch(() => {})
    // A friendship with history (a reconnection code) stays; a brand-new one goes.
    if (group && friendshipState(group.state, group.meta.meId) === 'waiting') {
      syncHub.drop(groupId)
      await deleteGroupLocally(groupId)
      go('/friends')
    } else go(`/g/${groupId}`)
  }

  return (
    <main className="screen">
      <Header title={t`Add a friend`} back="/friends" />
      <section className="move-qr friend-code" data-invite-link={link || undefined}>
        <p className="lead">{t`Have your friend scan this with Waroo, or send them the link.`}</p>
        {link ? <QrCode text={link} label={t`Friend code`} /> : <p className="muted" role="status">{problem || t`Making the code…`}</p>}
        {link && (
          <>
            <p className="muted" role="status">
              {t`It works once, for a week. This page moves on by itself when they’ve joined.`}
            </p>
            {canShare && (
              <button className="button primary" onClick={() => void share()}>
                {t`Send the link`}
              </button>
            )}
            <button className={`button ${canShare ? 'outline' : 'primary'}`} onClick={() => void copy()}>
              {copied ? t`Link copied` : t`Copy link`}
            </button>
          </>
        )}
        <button className="button danger" onClick={() => void cancel()}>
          {t`Cancel this code`}
        </button>
      </section>
    </main>
  )
}
