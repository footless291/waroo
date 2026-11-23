import { useEffect, useState } from 'react'
import {
  isOfferWallet,
  receiveLabel,
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

const TABS: { value: Tab; label: string }[] = [
  { value: 'receive', label: 'Receive' },
  { value: 'send', label: 'Send' },
]

const BLURB: Record<Option, string> = {
  coinos: 'Free. Just a username and a password.',
  rizful: 'Free. Sign up with email; one code sets up everything.',
  other: 'Any wallet with a Lightning address or Nostr Wallet Connect.',
}

/**
 * Your wallets as one list per side, in the order Footless uses them.
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

  async function load() {
    const [r, s] = await Promise.all([receiveWallets(), sendWallets()])
    setReceive(r)
    setSend(s)
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
      const name = option === 'other' ? 'Add a different wallet' : PROVIDERS[option].name
      return (
        <li key={option} className={`wallet-card setup-card${expanded ? ' open' : ''}`}>
          <div className="wallet-card-head">
            <span className="row-main">
              <strong>{name}</strong>
              <span className="muted">{BLURB[option]}</span>
            </span>
            <button
              type="button"
              className="button small outline"
              aria-expanded={expanded}
              onClick={() => setOpen(expanded ? undefined : option)}
            >
              {expanded ? 'Close' : option === 'other' ? 'Add' : 'Set up'}
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
  const status = <span className="visually-hidden">Connected.</span>

  return (
    <div className="wallet">
      <Segmented label="Wallets for sending or receiving" options={TABS} value={tab} onChange={setTab} />
      {/* Swipe between Send and Receive, like the main tabs. */}
      <Pager
        inline
        label="Wallets"
        current={tab}
        onChange={(path) => setTab(path as Tab)}
        pages={[
          {
            path: 'receive',
            content: (
              <>
                <p className="wallet-explain">
                  Friends pay you at these, in order. If the first can’t take a payment, the next one is used.
                </p>
                <RankedList
                  items={receive}
                  label={(w) => receiveLabel(w)}
                  render={(w) =>
                    isOfferWallet(w) ? (
                      <>
                        <strong className="address" data-address={w.address}>
                          {w.name ? w.name.split('@')[0] : 'BOLT12 offer'}
                        </strong>
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
                        <strong className="address" data-address={w.address}>
                          {w.address.split('@')[0]}
                        </strong>
                        <span className="wallet-status">
                          <span className="muted domain">@{w.address.split('@').slice(1).join('@')}</span>
                          {status}
                        </span>
                      </>
                    )
                  }
                  removeQuestion={(w) => `Stop getting paid at ${receiveLabel(w)}? Your groups will stop using it.`}
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
                  When you pay, Footless asks these in order. If one can’t pay, you’ll see why and choose whether to try
                  the next. You can always pay by opening your wallet app instead.
                </p>
                <RankedList
                  items={send}
                  label={sendLabel}
                  render={(w) => (
                    <>
                      <strong>{sendLabel(w)}</strong>
                      <span className="wallet-status">
                        {status}
                        <span className="muted">{w.kind === 'nwc' ? 'Pays in one tap' : 'Browser wallet'}</span>
                      </span>
                    </>
                  )}
                  removeQuestion={(w) => `Stop paying with ${sendLabel(w)}? You can connect it again any time.`}
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
