import { fiatToSats, type GroupState } from '@footless/ledger'
import { useEffect, useState } from 'react'
import { append, newId, type GroupMeta } from '../lib/db.ts'
import { money } from '../lib/format.ts'
import { locale } from '../lib/hooks.ts'
import { btcPrice, checkPaid, getInvoice, payParams, provesPayment, type CheckedInvoice } from '../lib/lightning.ts'
import { connectedWallet, payWithWallet, type WalletInfo } from '../lib/wallet.ts'
import { QrCode } from './QrCode.tsx'

type Quote = { invoice: CheckedInvoice; price: string; source: string }
type Phase =
  | { at: 'idle' }
  | { at: 'quoting' }
  | { at: 'ready'; quote: Quote }
  | { at: 'paying'; quote: Quote }
  | { at: 'external'; quote: Quote }
  | { at: 'paid'; sats: number }
  | { at: 'error'; message: string; checkWallet?: boolean }

const satsText = (n: number) => `${new Intl.NumberFormat(locale()).format(n)} sats`

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
  const address = toMember?.lightningAddress
  const [wallet, setWallet] = useState<WalletInfo | null>()
  const [phase, setPhase] = useState<Phase>({ at: 'idle' })

  useEffect(() => {
    void connectedWallet().then((w) => setWallet(w ?? null))
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

  async function quote() {
    if (!address) return
    setPhase({ at: 'quoting' })
    try {
      const [rate, params] = await Promise.all([btcPrice(currency), payParams(address)])
      const sats = fiatToSats(amount, currency, rate.price)
      const invoice = await getInvoice(params, sats, `Footless: ${state.name ?? meta.name}`)
      setPhase({ at: 'ready', quote: { invoice, price: rate.price, source: rate.source } })
    } catch (err) {
      setPhase({ at: 'error', message: (err as Error).message })
    }
  }

  async function pay(q: Quote) {
    if (!wallet) return
    if (q.invoice.expiresAt * 1000 < Date.now() + 15_000) return quote()
    setPhase({ at: 'paying', quote: q })
    let preimage: string
    try {
      preimage = await payWithWallet(wallet, q.invoice.invoice)
    } catch (err) {
      // The wallet may or may not have sent it; never let someone pay twice blindly.
      setPhase({
        at: 'error',
        message: `Your wallet said: ${(err as Error).message || 'the payment didn’t go through'}.`,
        checkWallet: true,
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
      ) : phase.at === 'ready' || phase.at === 'paying' || phase.at === 'external' ? (
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
              </dd>
            </div>
          </dl>
          {phase.at === 'external' ? (
            <>
              <a className="qr-link" href={`lightning:${phase.quote.invoice.invoice}`} aria-label="Open in your wallet app">
                <QrCode text={`lightning:${phase.quote.invoice.invoice.toUpperCase()}`} label="QR code to pay with a wallet app" />
              </a>
              <a className="button primary" href={`lightning:${phase.quote.invoice.invoice}`}>
                Open in wallet app
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
          ) : wallet ? (
            <>
              <button
                type="button"
                className="button primary"
                disabled={phase.at === 'paying'}
                onClick={() => void pay(phase.quote)}
              >
                {phase.at === 'paying' ? 'Paying…' : `Pay with ${wallet.name}`}
              </button>
              <button type="button" className="button outline" onClick={() => setPhase({ at: 'external', quote: phase.quote })}>
                Use another wallet app
              </button>
            </>
          ) : (
            <button type="button" className="button primary" onClick={() => setPhase({ at: 'external', quote: phase.quote })}>
              Pay with a wallet app
            </button>
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
          {wallet === null && (
            <p className="muted">
              Tip: <a href="#/you">connect your wallet</a> to pay in one tap.
            </p>
          )}
        </>
      )}
    </section>
  )
}
