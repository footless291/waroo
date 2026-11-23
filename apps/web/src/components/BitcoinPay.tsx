import { fiatToSats, receiveAddresses, type GroupState } from '@footless/ledger'
import { useEffect, useState } from 'react'
import { append, newId, type GroupMeta } from '../lib/db.ts'
import { money } from '../lib/format.ts'
import { locale } from '../lib/hooks.ts'
import { btcPrice, checkPaid, getInvoice, payParams, provesPayment, type CheckedInvoice } from '../lib/lightning.ts'
import { payWithWallet, WalletPayError } from '../lib/wallet.ts'
import { sendLabel, sendWallets, type SendWallet } from '../lib/wallets.ts'
import { QrCode } from './QrCode.tsx'

type Quote = { invoice: CheckedInvoice; price: string; source: string }
type Phase =
  | { at: 'idle' }
  | { at: 'quoting' }
  /** `next`: which of your wallets to offer first (after a failure, the one after it). */
  | { at: 'ready'; quote: Quote; next: number }
  | { at: 'paying'; quote: Quote; index: number }
  /** A wallet couldn't pay. Nothing more happens until the person decides. */
  | { at: 'failed'; quote: Quote; index: number; reason: string; certain: boolean }
  | { at: 'external'; quote: Quote }
  | { at: 'paid'; sats: number }
  | { at: 'error'; message: string; checkWallet?: boolean }

const satsText = (n: number) => `${new Intl.NumberFormat(locale()).format(n)} sats`

/** "from Kraken, bitFlyer and 2 more" */
const sourcesText = (source: string) => {
  const names = source.split('+')
  return names.length <= 3
    ? `from ${names.join(', ')}`
    : `from ${names.slice(0, 2).join(', ')} and ${names.length - 2} more`
}

const pricePerBitcoin = (price: string, currency: string) =>
  new Intl.NumberFormat(locale(), { style: 'currency', currency, maximumFractionDigits: 0 }).format(Number(price))

/**
 * Pays the person you owe, in bitcoin, from your own wallet. The debt is in
 * yen (or whatever the group uses); bitcoin is only how it moves. The amount
 * in sats is worked out at the moment of paying, and recorded with the rate
 * and the proof of payment.
 */
export function BitcoinPay(props: {
  meta: GroupMeta
  state: GroupState
  to: string
  amount: number
  currency: string
  /** The payment is recorded: the screen should stop offering other ways to pay. */
  onRecorded: () => void
  onPaid: () => void
}) {
  const { meta, state, to, amount, currency, onPaid, onRecorded } = props
  const toMember = state.members.get(to)
  const toName = toMember?.name ?? 'them'
  const addresses = receiveAddresses(toMember)
  const address = addresses[0]
  const [wallets, setWallets] = useState<SendWallet[]>()
  const [phase, setPhase] = useState<Phase>({ at: 'idle' })

  useEffect(() => {
    void sendWallets().then(setWallets)
  }, [])

  // A new amount means a new quote.
  useEffect(() => setPhase((p) => (p.at === 'ready' || p.at === 'error' ? { at: 'idle' } : p)), [amount])

  async function record(quote: Quote, preimage?: string) {
    await append(meta, [
      {
        type: 'settlement.recorded',
        settlement: {
          id: newId(),
          from: meta.meId,
          to,
          amount,
          currency,
          method: 'bitcoin',
          bitcoin: {
            sats: quote.invoice.sats,
            btcPrice: quote.price,
            rateSource: quote.source,
            paymentHash: quote.invoice.paymentHash,
            ...(preimage ? { preimage: preimage.toLowerCase() } : {}),
            settledAt: new Date().toISOString(),
          },
        },
      },
    ])
    setPhase({ at: 'paid', sats: quote.invoice.sats })
    onRecorded()
  }

  /**
   * Gets an invoice from the first of their addresses that gives one. Asking
   * moves no money, so trying the next address needs no confirmation.
   */
  async function quote(next = 0) {
    if (addresses.length === 0) return
    setPhase({ at: 'quoting' })
    let rate: Awaited<ReturnType<typeof btcPrice>>
    try {
      rate = await btcPrice(currency)
    } catch (err) {
      setPhase({ at: 'error', message: (err as Error).message })
      return
    }
    const sats = fiatToSats(amount, currency, rate.price)
    const problems: string[] = []
    for (const addr of addresses) {
      try {
        const invoice = await getInvoice(await payParams(addr), sats, `Footless: ${state.name ?? meta.name}`)
        setPhase({ at: 'ready', quote: { invoice, price: rate.price, source: rate.source }, next })
        return
      } catch (err) {
        problems.push(`${addr}: ${(err as Error).message}`)
      }
    }
    setPhase({
      at: 'error',
      message:
        addresses.length === 1
          ? (problems[0]!.split(': ').slice(1).join(': '))
          : `None of ${toName}’s addresses could take a payment right now. ${problems.join(' ')}`,
    })
  }

  /** Pays with the wallet at `index` in your send list. Only ever one wallet per tap. */
  async function pay(q: Quote, index: number) {
    const wallet = wallets?.[index]
    if (!wallet) return
    // An invoice about to expire gets replaced first; the person then taps again.
    if (q.invoice.expiresAt * 1000 < Date.now() + 15_000) return quote(index)
    setPhase({ at: 'paying', quote: q, index })
    let preimage: string
    try {
      preimage = await payWithWallet(wallet, q.invoice.invoice)
    } catch (err) {
      setPhase({
        at: 'failed',
        quote: q,
        index,
        reason: (err as Error).message || 'the payment didn’t go through',
        certain: err instanceof WalletPayError && err.certain,
      })
      return
    }
    if (!(await provesPayment(q.invoice.paymentHash, preimage))) {
      setPhase({
        at: 'error',
        message: 'Your wallet reported the payment, but its proof didn’t check out.',
        checkWallet: true,
      })
      return
    }
    await record(q, preimage)
  }

  // Paying from another app: ask the provider every few seconds whether it's paid.
  useEffect(() => {
    if (phase.at !== 'external' || !phase.quote.invoice.verify) return
    const q = phase.quote
    let live = true
    const tick = async () => {
      const preimage = await checkPaid(q.invoice)
      if (!live) return
      if (preimage) await record(q, preimage)
      else timer = setTimeout(tick, 3000)
    }
    let timer = setTimeout(tick, 3000)
    return () => {
      live = false
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  if (to === meta.meId) return null

  return (
    <section className="bitcoin" aria-labelledby="bitcoin-title">
      <h2 id="bitcoin-title">Pay with bitcoin</h2>

      {!address ? (
        <p>{toName} hasn’t added a Lightning address yet, so they can’t receive bitcoin. They can add one under You.</p>
      ) : phase.at === 'paid' ? (
        <>
          <p className="bitcoin-done" role="status">
            Paid {money(amount, currency)} to {toName} ({satsText(phase.sats)}).
          </p>
          <button type="button" className="button primary" onClick={onPaid}>
            Done
          </button>
        </>
      ) : phase.at === 'ready' || phase.at === 'paying' || phase.at === 'external' || phase.at === 'failed' ? (
        <>
          <dl className="quote">
            <div>
              <dt>You pay</dt>
              <dd>{money(amount, currency)}</dd>
            </div>
            <div>
              <dt>In bitcoin</dt>
              <dd>{satsText(phase.quote.invoice.sats)}</dd>
            </div>
            <div>
              <dt>Price</dt>
              <dd>
                {pricePerBitcoin(phase.quote.price, currency)} per bitcoin
                <span className="quote-source">{sourcesText(phase.quote.source)}</span>
              </dd>
            </div>
          </dl>
          {phase.at === 'external' ? (
            <>
              <a className="button primary" href={`lightning:${phase.quote.invoice.invoice}`}>
                Open in wallet app
              </a>
              <p className="muted">Or scan it with a wallet on another phone:</p>
              <a className="qr-link" href={`lightning:${phase.quote.invoice.invoice}`} aria-label="Open in your wallet app">
                <QrCode text={`lightning:${phase.quote.invoice.invoice.toUpperCase()}`} label="QR code to pay with a wallet app" />
              </a>
              <button
                type="button"
                className="button outline"
                onClick={() => void navigator.clipboard.writeText(phase.quote.invoice.invoice)}
              >
                Copy invoice
              </button>
              {phase.quote.invoice.verify ? (
                <p role="status">Waiting for the payment… This updates by itself once it goes through.</p>
              ) : (
                <>
                  <p>{toName}’s provider can’t confirm payments automatically. Once you’ve paid, mark it here.</p>
                  <button type="button" className="button outline" onClick={() => void record(phase.quote)}>
                    I’ve paid it
                  </button>
                </>
              )}
            </>
          ) : (
            <WalletChoices
              phase={phase}
              wallets={wallets ?? []}
              onPay={(index) => void pay(phase.quote, index)}
              onExternal={() => setPhase({ at: 'external', quote: phase.quote })}
            />
          )}
        </>
      ) : (
        <>
          <p>
            Straight from your wallet to {toName}’s, at today’s price. The payment is checked automatically and recorded in{' '}
            {currency === 'JPY' ? 'yen' : currency}.
          </p>
          {phase.at === 'error' && (
            <p className="bitcoin-error" role="alert">
              {phase.message}
              {phase.checkWallet && ' Check your wallet to see whether it went through before trying again.'}
            </p>
          )}
          <button
            type="button"
            className="button primary"
            disabled={amount <= 0 || phase.at === 'quoting'}
            onClick={() => void quote()}
          >
            {phase.at === 'quoting' ? 'Getting the price…' : `Pay ${amount > 0 ? money(amount, currency) : ''} with bitcoin`}
          </button>
          {wallets?.length === 0 && (
            <p className="muted">
              Tip: <a href="#/settings?open=wallet">set up one-tap payments</a>, so you don’t have to switch apps.
            </p>
          )}
        </>
      )}
    </section>
  )
}

/**
 * Which wallet to pay with. Your first wallet is offered; if one fails, the
 * reason is shown and the next is offered, never tried without a tap. When a
 * wallet may still have paid, the person is told to check it first.
 */
function WalletChoices({
  phase,
  wallets,
  onPay,
  onExternal,
}: {
  phase: Extract<Phase, { at: 'ready' | 'paying' | 'failed' }>
  wallets: SendWallet[]
  onPay: (index: number) => void
  onExternal: () => void
}) {
  const invoice = phase.quote.invoice.invoice
  const nextIndex = phase.at === 'ready' ? phase.next : phase.at === 'failed' ? phase.index + 1 : phase.index
  const next = wallets[nextIndex]
  const failed = phase.at === 'failed' ? wallets[phase.index] : undefined
  return (
    <>
      {phase.at === 'failed' && failed && (
        <div className="bitcoin-error" role="alert">
          <p>
            <strong>{sendLabel(failed)} couldn’t pay:</strong> {phase.reason}.
          </p>
          {phase.certain ? (
            <p>Nothing was paid.</p>
          ) : (
            <p>
              It may still have paid. Check {sendLabel(failed)} before trying again, so you don’t pay twice.
            </p>
          )}
        </div>
      )}
      {next && (
        <button
          type="button"
          className="button primary"
          disabled={phase.at === 'paying'}
          onClick={() => onPay(nextIndex)}
        >
          {phase.at === 'paying'
            ? `Paying with ${sendLabel(next)}…`
            : phase.at === 'failed'
              ? phase.certain
                ? `Try ${sendLabel(next)}`
                : `It didn’t pay. Try ${sendLabel(next)}`
              : `Pay with ${sendLabel(next)}`}
        </button>
      )}
      {/* Hands the invoice to whatever wallet app is installed, and waits for it here. */}
      <a
        className={`button ${next ? 'outline' : 'primary'}`}
        href={`lightning:${invoice}`}
        aria-disabled={phase.at === 'paying'}
        onClick={onExternal}
      >
        {wallets.length > 0 ? 'Open another wallet app' : 'Open in wallet app'}
      </a>
      {wallets.length === 0 && (
        <button type="button" className="link" onClick={onExternal}>
          Paying from another phone? Show a QR code
        </button>
      )}
    </>
  )
}
