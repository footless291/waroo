import { fiatToSats, isOffer, receiveTargets, type GroupState } from '@footless/ledger'
import { useEffect, useState } from 'react'
import { append, newId, type GroupMeta } from '../lib/db.ts'
import { money } from '../lib/format.ts'
import { locale } from '../lib/hooks.ts'
import { btcPrice, checkPaid, getInvoice, payParams, provesPayment, type CheckedInvoice } from '../lib/lightning.ts'
import { payOfferWithWallet, payWithWallet, WalletPayError } from '../lib/wallet.ts'
import { sendLabel, sendWallets, type SendWallet } from '../lib/wallets.ts'
import { QrCode } from './QrCode.tsx'

/**
 * What's about to be paid: an invoice from a Lightning address, or a BOLT12
 * offer (the wallet fetches its invoice). `target` is its place in the
 * person's list, so "try the next one" knows where to go on.
 */
type Quote = { sats: number; price: string; source: string; target: number } & (
  | { invoice: CheckedInvoice; offer?: undefined }
  | { offer: string; invoice?: undefined }
)
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
  const targets = receiveTargets(toMember)
  const address = targets[0]
  const [wallets, setWallets] = useState<SendWallet[]>()
  const [phase, setPhase] = useState<Phase>({ at: 'idle' })

  useEffect(() => {
    void sendWallets().then(setWallets)
  }, [])

  // A new amount means a new quote.
  useEffect(() => setPhase((p) => (p.at === 'ready' || p.at === 'error' ? { at: 'idle' } : p)), [amount])

  async function record(quote: Quote, preimage?: string, paymentHash?: string) {
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
            sats: quote.sats,
            btcPrice: quote.price,
            rateSource: quote.source,
            paymentHash: (quote.invoice?.paymentHash ?? paymentHash ?? '').toLowerCase(),
            ...(quote.offer ? { offer: true } : {}),
            ...(preimage ? { preimage: preimage.toLowerCase() } : {}),
            settledAt: new Date().toISOString(),
          },
        },
      },
    ])
    setPhase({ at: 'paid', sats: quote.sats })
    onRecorded()
  }

  /**
   * Gets an invoice from the first of their addresses that gives one, from
   * `from` on. An offer needs nothing fetched: the wallet does that. Asking
   * moves no money, so trying the next one needs no confirmation.
   */
  async function quote(next = 0, from = 0) {
    if (targets.length <= from) return
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
    const tried = targets.slice(from)
    for (const [i, addr] of tried.entries()) {
      const target = from + i
      if (isOffer(addr)) {
        setPhase({ at: 'ready', quote: { offer: addr, sats, price: rate.price, source: rate.source, target }, next })
        return
      }
      try {
        const invoice = await getInvoice(await payParams(addr), sats, `Footless: ${state.name ?? meta.name}`)
        setPhase({ at: 'ready', quote: { invoice, sats: invoice.sats, price: rate.price, source: rate.source, target }, next })
        return
      } catch (err) {
        problems.push(`${addr}: ${(err as Error).message}`)
      }
    }
    setPhase({
      at: 'error',
      message:
        tried.length === 1
          ? (problems[0]!.split(': ').slice(1).join(': '))
          : `None of ${toName}’s addresses could take a payment right now. ${problems.join(' ')}`,
    })
  }

  /** Pays with the wallet at `index` in your send list. Only ever one wallet per tap. */
  async function pay(q: Quote, index: number) {
    const wallet = wallets?.[index]
    if (!wallet) return
    // An invoice about to expire gets replaced first; the person then taps again.
    if (q.invoice && q.invoice.expiresAt * 1000 < Date.now() + 15_000) return quote(index, q.target)
    setPhase({ at: 'paying', quote: q, index })
    let preimage: string | undefined
    let paymentHash = q.invoice?.paymentHash
    try {
      if (q.offer) {
        const paid = await payOfferWithWallet(wallet, q.offer, q.sats)
        preimage = paid.preimage
        paymentHash = paid.paymentHash
      } else {
        preimage = await payWithWallet(wallet, q.invoice!.invoice)
      }
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
    // An offer's wallet may not report the proof; when it does, it has to check out.
    if ((preimage || !q.offer) && !(paymentHash && preimage && (await provesPayment(paymentHash, preimage)))) {
      setPhase({
        at: 'error',
        message: 'Your wallet reported the payment, but its proof didn’t check out.',
        checkWallet: true,
      })
      return
    }
    await record(q, preimage, paymentHash)
  }

  /** The next place they receive after this quote's, if there is one: e.g. an address after an offer. */
  const nextTarget = (q: Quote) => (q.target + 1 < targets.length ? q.target + 1 : undefined)

  // Paying from another app: ask the provider every few seconds whether it's paid.
  useEffect(() => {
    if (phase.at !== 'external' || !phase.quote.invoice?.verify) return
    const q = phase.quote
    let live = true
    const tick = async () => {
      const preimage = await checkPaid(q.invoice!)
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
        <p>{toName} hasn’t added a Lightning address yet, so they can’t receive bitcoin. They can add one in Settings.</p>
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
              <dd>{satsText(phase.quote.sats)}</dd>
            </div>
            <div>
              <dt>Price</dt>
              <dd>
                {pricePerBitcoin(phase.quote.price, currency)} per bitcoin
                <span className="quote-source">{sourcesText(phase.quote.source)}</span>
              </dd>
            </div>
          </dl>
          {phase.at === 'external' && phase.quote.offer ? (
            <OfferExternal
              offer={phase.quote.offer}
              sats={phase.quote.sats}
              toName={toName}
              onPaid={() => void record(phase.quote)}
            />
          ) : phase.at === 'external' ? (
            <>
              <a className="button primary" href={`lightning:${phase.quote.invoice!.invoice}`}>
                Open in wallet app
              </a>
              <p className="muted">Or scan it with a wallet on another phone:</p>
              <a className="qr-link" href={`lightning:${phase.quote.invoice!.invoice}`} aria-label="Open in your wallet app">
                <QrCode text={`lightning:${phase.quote.invoice!.invoice.toUpperCase()}`} label="QR code to pay with a wallet app" />
              </a>
              <button
                type="button"
                className="button outline"
                onClick={() => void navigator.clipboard.writeText(phase.quote.invoice!.invoice)}
              >
                Copy invoice
              </button>
              {phase.quote.invoice!.verify ? (
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
              onNextTarget={
                phase.quote.offer && nextTarget(phase.quote) !== undefined && phase.at !== 'paying'
                  ? () => void quote(0, nextTarget(phase.quote)!)
                  : undefined
              }
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
  onNextTarget,
}: {
  phase: Extract<Phase, { at: 'ready' | 'paying' | 'failed' }>
  wallets: SendWallet[]
  onPay: (index: number) => void
  onExternal: () => void
  /** Paying an offer: switch to where they receive next (an address), for wallets that can't pay offers. */
  onNextTarget?: () => void
}) {
  const link = phase.quote.offer ? `bitcoin:?lno=${phase.quote.offer}` : `lightning:${phase.quote.invoice!.invoice}`
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
        href={link}
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
      {phase.quote.offer && (
        <p className="muted">
          This is a BOLT12 offer. Your wallet needs to support BOLT12 to pay it.
          {onNextTarget && (
            <>
              {' '}
              <button type="button" className="link" onClick={onNextTarget}>
                Pay their Lightning address instead
              </button>
            </>
          )}
        </p>
      )}
    </>
  )
}

/**
 * Paying an offer from another app. The amount has to be typed there (an
 * offer can be for any amount), and Footless can't see the payment, so the
 * person marks it paid.
 */
function OfferExternal({ offer, sats, toName, onPaid }: { offer: string; sats: number; toName: string; onPaid: () => void }) {
  const link = `bitcoin:?lno=${offer}`
  const [copied, setCopied] = useState(false)
  return (
    <>
      <p className="lead">
        Pay exactly <strong>{satsText(sats)}</strong>. You’ll type the amount in your wallet.
      </p>
      <a className="button primary" href={link}>
        Open in wallet app
      </a>
      <p className="muted">Or scan it with a wallet on another phone:</p>
      <a className="qr-link" href={link} aria-label="Open in your wallet app">
        <QrCode text={offer} label={`QR code of ${toName}’s BOLT12 offer`} />
      </a>
      <button
        type="button"
        className="button outline"
        onClick={() => void navigator.clipboard.writeText(offer).then(() => setCopied(true))}
      >
        {copied ? 'Offer copied' : 'Copy offer'}
      </button>
      <p>Footless can’t see payments to an offer. Once you’ve paid, mark it here.</p>
      <button type="button" className="button outline" onClick={onPaid}>
        I’ve paid it
      </button>
    </>
  )
}
