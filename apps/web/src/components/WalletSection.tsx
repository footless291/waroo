import { useEffect, useState } from 'react'
import {
  receiveWallets,
  saveReceiveWallets,
  saveSendWallets,
  sendLabel,
  sendWallets,
  PROVIDERS,
  type ReceiveWallet,
  type SendWallet,
} from '../lib/wallets.ts'
import { RankedList } from './RankedList.tsx'
import { Segmented } from './Segmented.tsx'
import { CoinosGuide, OtherWallet, RizfulGuide } from './WalletGuides.tsx'

type Tab = 'send' | 'receive'
type Option = 'coinos' | 'rizful' | 'other'

const TABS: { value: Tab; label: string }[] = [
  { value: 'send', label: 'Send' },
  { value: 'receive', label: 'Receive' },
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
  const [tab, setTab] = useState<Tab>('send')
  const [receive, setReceive] = useState<ReceiveWallet[]>()
  const [send, setSend] = useState<SendWallet[]>()
  const [open, setOpen] = useState<Option>()

  async function load() {
    const [r, s] = await Promise.all([receiveWallets(), sendWallets()])
    setReceive(r)
    setSend(s)
    return { r, s }
  }
  useEffect(() => {
    void load().then(({ s }) => {
      // Nothing to pay with yet: start on Receive, which is what friends need first.
      if (s.length === 0) setTab('receive')
    })
  }, [])

  if (!receive || !send) return <div className="wallet" />
  const connected = (p: Option) => (tab === 'send' ? send : receive).some((w) => w.provider === p)

  // Coinos and Rizful when they aren't connected on this side, then "a different wallet".
  const setupCards = (['coinos', 'rizful', 'other'] as const)
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
          {option !== 'other' && !expanded && !connected(option) && <span className="chip">Not connected</span>}
          {expanded && (
            <div className="wallet-guide">
              {option === 'coinos' && <CoinosGuide receive={receive} send={send} onChange={() => void load()} />}
              {option === 'rizful' && <RizfulGuide receive={receive} send={send} onChange={() => void load()} />}
              {option === 'other' && <OtherWallet tab={tab} onChange={() => void load()} />}
            </div>
          )}
        </li>
      )
    })

  const status = <span className="chip on">Connected</span>

  return (
    <div className="wallet">
      <Segmented
        label="Wallets for sending or receiving"
        options={TABS}
        value={tab}
        onChange={(t) => {
          setTab(t)
          setOpen(undefined)
        }}
      />
      <p className="wallet-explain">
        {tab === 'send'
          ? 'When you pay, Footless asks these in order. If one can’t pay, you’ll see why and choose whether to try the next. You can always pay by opening your wallet app instead.'
          : 'Friends pay you at these addresses, in order. If the first can’t take a payment, the next one is used.'}
      </p>

      {tab === 'send' ? (
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
          after={setupCards}
        />
      ) : (
        <RankedList
          items={receive}
          label={(w) => w.address}
          render={(w) => (
            <>
              <strong className="address">{w.address}</strong>
              <span className="wallet-status">
                {status}
                {w.provider !== 'other' && <span className="muted">{PROVIDERS[w.provider].name}</span>}
              </span>
            </>
          )}
          removeQuestion={(w) => `Stop getting paid at ${w.address}? Your groups will stop using it.`}
          onChange={async (next) => {
            setReceive(next)
            await saveReceiveWallets(next)
          }}
          onRemove={async (w) => {
            const next = receive.filter((x) => x.id !== w.id)
            setReceive(next)
            await saveReceiveWallets(next)
          }}
          after={setupCards}
        />
      )}
    </div>
  )
}
