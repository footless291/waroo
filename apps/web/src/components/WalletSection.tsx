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
 * Your wallets, in the order Footless uses them. Send: who Footless asks to
 * pay, first to last. Receive: where friends pay you, first to last. Coinos
 * and Rizful are always offered, with whether they're connected; any other
 * wallet can be added too.
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

  if (!receive || !send) return <section className="settings-card wallet" />
  const list = tab === 'send' ? send : receive
  const connected = (p: Option) =>
    p !== 'other' && (tab === 'send' ? send.some((w) => w.provider === p) : receive.some((w) => w.provider === p))

  return (
    <section className="settings-card wallet" aria-labelledby="wallet-title">
      <h2 id="wallet-title">Wallet</h2>
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

      {list.length === 0 ? (
        <p className="muted wallet-empty">
          {tab === 'send'
            ? 'No wallets connected for paying yet. You can still pay by opening your wallet app.'
            : 'No addresses yet, so friends can’t pay you in bitcoin.'}
        </p>
      ) : tab === 'send' ? (
        <RankedList
          items={send}
          label={sendLabel}
          render={(w) => (
            <>
              <strong>{sendLabel(w)}</strong>
              <span className="muted">{w.kind === 'nwc' ? 'Pays in one tap' : 'Browser wallet'}</span>
            </>
          )}
          onChange={async (next) => {
            setSend(next)
            await saveSendWallets(next)
          }}
          onRemove={async (w) => {
            const next = send.filter((x) => x.id !== w.id)
            setSend(next)
            await saveSendWallets(next)
          }}
        />
      ) : (
        <RankedList
          items={receive}
          label={(w) => w.address}
          render={(w) => (
            <>
              <strong className="address">{w.address}</strong>
              {w.provider !== 'other' && <span className="muted">{PROVIDERS[w.provider].name}</span>}
            </>
          )}
          onChange={async (next) => {
            setReceive(next)
            await saveReceiveWallets(next)
          }}
          onRemove={async (w) => {
            const next = receive.filter((x) => x.id !== w.id)
            setReceive(next)
            await saveReceiveWallets(next)
          }}
        />
      )}

      <h3 className="wallet-add-title">Add a wallet</h3>
      <ul className="wallet-options">
        {(['coinos', 'rizful', 'other'] as const).map((option) => {
          const isOn = connected(option)
          const expanded = open === option
          const name = option === 'other' ? 'A different wallet' : PROVIDERS[option].name
          return (
            <li key={option} className={`wallet-option${expanded ? ' open' : ''}`}>
              <div className="wallet-option-head">
                <span className="row-main">
                  <strong>{name}</strong>
                  <span className="muted">{BLURB[option]}</span>
                </span>
                {isOn && !expanded ? (
                  <span className="chip on">Connected</span>
                ) : (
                  <button
                    type="button"
                    className="button small outline"
                    aria-expanded={expanded}
                    onClick={() => setOpen(expanded ? undefined : option)}
                  >
                    {expanded ? 'Close' : option === 'other' ? 'Add' : 'Set up'}
                  </button>
                )}
              </div>
              {expanded && (
                <div className="wallet-guide">
                  {option === 'coinos' && <CoinosGuide receive={receive} send={send} onChange={() => void load()} />}
                  {option === 'rizful' && <RizfulGuide receive={receive} send={send} onChange={() => void load()} />}
                  {option === 'other' && <OtherWallet tab={tab} onChange={() => void load()} />}
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
