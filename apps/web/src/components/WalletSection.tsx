import { t } from '@lingui/core/macro'
import { useEffect, useState } from 'react'
import {
  isOfferWallet,
  receiveLabel,
  renameWallet,
  walletKey,
  walletNames,
  receiveWallets,
  saveReceiveWallets,
  saveSendWallets,
  sendLabel,
  sendWallets,
  PROVIDERS,
  type ReceiveWallet,
  type SendWallet,
} from '../lib/wallets.ts'
import { Pager } from './Pager.tsx'
import { RankedList } from './RankedList.tsx'
import { Segmented } from './Segmented.tsx'
import { CoinosGuide, OtherWallet, RizfulGuide } from './WalletGuides.tsx'

type Tab = 'send' | 'receive'
type Option = 'coinos' | 'rizful' | 'other'

const tabs = (): { value: Tab; label: string }[] => [
  { value: 'receive', label: t`Receive` },
  { value: 'send', label: t({ message: 'Send', context: 'wallet: the ones you pay from' }) },
]

const blurb = (option: Option): string =>
  option === 'coinos'
    ? t`Free. Just a username and a password.`
    : option === 'rizful'
      ? t`Free. Sign up with email; one code sets up everything.`
      : t`Any wallet with a Lightning address or Nostr Wallet Connect.`

/**
 * Your wallets as one list per side, in the order Waroo uses them.
 * Connected wallets are ranked cards. Coinos and Rizful always appear, so
 * people see whether they're connected and can set them up; adding any other
 * wallet is the last card.
 */
export function WalletSection() {
  const [tab, setTab] = useState<Tab>('receive')
  const [receive, setReceive] = useState<ReceiveWallet[]>()
  const [send, setSend] = useState<SendWallet[]>()
  // Each side remembers its own open guide, since both sides are on screen while swiping.
  const [openGuides, setOpenGuides] = useState<Partial<Record<Tab, Option>>>({})
  const [names, setNames] = useState<Record<string, string>>({})
  /** The wallet being renamed, by its shared key, and which side it's on. */
  const [renaming, setRenaming] = useState<{ key: string; side: Tab }>()

  async function load() {
    const [r, s, n] = await Promise.all([receiveWallets(), sendWallets(), walletNames()])
    setReceive(r)
    setSend(s)
    setNames(n)
    return { r, s }
  }
  useEffect(() => {
    void load()
  }, [])

  if (!receive || !send) return <div className="wallet" />

  // Coinos and Rizful when they aren't connected on this side, then "a different wallet".
  const setupCards = (side: Tab) => {
    const connected = (p: Option) => (side === 'send' ? send : receive).some((w) => w.provider === p)
    const open = openGuides[side]
    const setOpen = (option: Option | undefined) => setOpenGuides((g) => ({ ...g, [side]: option }))
    return (['coinos', 'rizful', 'other'] as const)
    // An open guide stays until closed, even once connected: Coinos has a step after the address.
    .filter((option) => option === 'other' || !connected(option) || open === option)
    .map((option) => {
      const expanded = open === option
      const name = option === 'other' ? t`Add a different wallet` : PROVIDERS[option].name
      return (
        <li key={option} className={`wallet-card setup-card${expanded ? ' open' : ''}`}>
          <div className="wallet-card-head">
            <span className="row-main">
              <strong>{name}</strong>
              <span className="muted">{blurb(option)}</span>
            </span>
            <button
              type="button"
              className="button small outline"
              aria-expanded={expanded}
              onClick={() => setOpen(expanded ? undefined : option)}
            >
              {expanded ? t`Close` : option === 'other' ? t`Add` : t`Set up`}
            </button>
          </div>
          {expanded && (
            <div className="wallet-guide">
              {option === 'coinos' && (
                <CoinosGuide
                  receive={receive}
                  send={send}
                  onChange={() => void load()}
                  onDone={() => setOpen(undefined)}
                />
              )}
              {option === 'rizful' && <RizfulGuide receive={receive} send={send} onChange={() => void load()} />}
              {option === 'other' && <OtherWallet tab={side} onChange={() => void load()} />}
            </div>
          )}
        </li>
      )
    })
  }

  // Connected shows as the green, gently pulsing number; this is for screen readers.
  const status = <span className="visually-hidden">{t`Connected.`}</span>

  /** The name on a card: yours if you gave one, else the wallet's own. */
  const nameOf = (w: ReceiveWallet | SendWallet) =>
    names[walletKey(w)] ?? ('address' in w ? receiveLabel(w) : sendLabel(w))

  /** The wallet's name, as a button that renames it in place. */
  const nameButton = (w: ReceiveWallet | SendWallet, side: Tab, shown: string) => {
    const key = walletKey(w)
    if (renaming?.key === key && renaming.side === side) {
      return (
        <RenameForm
          initial={names[key] ?? ''}
          placeholder={'address' in w ? receiveLabel(w) : sendLabel(w)}
          onDone={async (name) => {
            if (name !== undefined) setNames(await renameWallet(key, name))
            setRenaming(undefined)
          }}
        />
      )
    }
    return (
      <button type="button" className="wallet-name" onClick={() => setRenaming({ key, side })} aria-label={t`Rename ${shown}`}>
        <strong className="address" data-address={'address' in w ? w.address : undefined}>
          {shown}
        </strong>
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
          <path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
        </svg>
      </button>
    )
  }

  return (
    <div className="wallet">
      <Segmented label={t`Wallets for sending or receiving`} options={tabs()} value={tab} onChange={setTab} />
      {/* Swipe between Send and Receive, like the main tabs. */}
      <Pager
        inline
        label={t`Wallets`}
        current={tab}
        onChange={(path) => setTab(path as Tab)}
        pages={[
          {
            path: 'receive',
            content: (
              <>
                <p className="wallet-explain">
                  {t`Friends pay you at these, in order. If the first can’t take a payment, the next one is used.`}
                </p>
                <RankedList
                  items={receive}
                  label={(w) => nameOf(w)}
                  render={(w) =>
                    names[walletKey(w)] ? (
                      <>
                        {nameButton(w, 'receive', names[walletKey(w)]!)}
                        <span className="wallet-status">
                          <span className="muted domain">{receiveLabel(w)}</span>
                          {status}
                        </span>
                      </>
                    ) : isOfferWallet(w) ? (
                      <>
                        {nameButton(w, 'receive', w.name ? w.name.split('@')[0]! : t`BOLT12 offer`)}
                        <span className="wallet-status">
                          <span className="muted domain">
                            {w.name ? `@${w.name.split('@').slice(1).join('@')} · BOLT12` : `${w.address.slice(0, 12)}…${w.address.slice(-6)}`}
                          </span>
                          {status}
                        </span>
                      </>
                    ) : (
                      <>
                        {/* Username on top, @provider underneath, so long addresses fit. */}
                        {nameButton(w, 'receive', w.address.split('@')[0]!)}
                        <span className="wallet-status">
                          <span className="muted domain">@{w.address.split('@').slice(1).join('@')}</span>
                          {status}
                        </span>
                      </>
                    )
                  }
                  removeQuestion={(w) => t`Stop getting paid at ${nameOf(w)}? Your groups will stop using it.`}
                  onChange={async (next) => {
                    setReceive(next)
                    await saveReceiveWallets(next)
                  }}
                  onRemove={async (w) => {
                    const next = receive.filter((x) => x.id !== w.id)
                    setReceive(next)
                    await saveReceiveWallets(next)
                  }}
                  after={setupCards('receive')}
                />
              </>
            ),
          },
          {
            path: 'send',
            content: (
              <>
                <p className="wallet-explain">
                  {t`When you pay, Waroo asks these in order. If one can’t pay, you’ll see why and choose whether to try the next. You can always pay by opening your wallet app instead.`}
                </p>
                <RankedList
                  items={send}
                  label={nameOf}
                  render={(w) => (
                    <>
                      {nameButton(w, 'send', nameOf(w))}
                      <span className="wallet-status">
                        {status}
                        <span className="muted">{w.kind === 'nwc' ? t`Pays in one tap` : t`Browser wallet`}</span>
                      </span>
                    </>
                  )}
                  removeQuestion={(w) => t`Stop paying with ${nameOf(w)}? You can connect it again any time.`}
                  onChange={async (next) => {
                    setSend(next)
                    await saveSendWallets(next)
                  }}
                  onRemove={async (w) => {
                    const next = send.filter((x) => x.id !== w.id)
                    setSend(next)
                    await saveSendWallets(next)
                  }}
                  after={setupCards('send')}
                />
              </>
            ),
          },
        ]}
      />
    </div>
  )
}

/** Renaming a wallet in place. Empty goes back to the wallet's own name; Escape or Cancel keeps it. */
function RenameForm({
  initial,
  placeholder,
  onDone,
}: {
  initial: string
  placeholder: string
  onDone: (name: string | undefined) => void
}) {
  const [value, setValue] = useState(initial)
  return (
    <form
      className="rename-form"
      onSubmit={(e) => {
        e.preventDefault()
        onDone(value)
      }}
    >
      <input
        autoFocus
        value={value}
        maxLength={40}
        placeholder={placeholder}
        aria-label={t`Wallet name`}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && onDone(undefined)}
      />
      <div className="rename-actions">
        <button className="button small primary">{t`Save`}</button>
        <button type="button" className="button small outline" onClick={() => onDone(undefined)}>
          {t`Cancel`}
        </button>
      </div>
    </form>
  )
}
