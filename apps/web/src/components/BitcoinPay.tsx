import { Trans } from '@lingui/react/macro'
import { t } from '@lingui/core/macro'
import { fiatToSats, isOffer, receiveTargets, type GroupState } from '@waroo/ledger'
import { useEffect, useState } from 'react'
import { append, newId, type GroupMeta } from '../lib/db.ts'
import { money, satsText } from '../lib/format.ts'
import { locale } from '../lib/hooks.ts'
import { btcPrice, checkPaid, getInvoice, payParams, provesPayment, type CheckedInvoice } from '../lib/lightning.ts'
import { payOfferWithWallet, payWithWallet, WalletPayError } from '../lib/wallet.ts'
import { sendLabel, sendWallets, walletKey, walletNames, type SendWallet } from '../lib/wallets.ts'
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


/** "from Kraken, bitFlyer and 2 more" */
const sourcesText = (source: string) => {
  const names = source.split('+')
  return names.length <= 3
    ? fromList(names)
    : fromSome(names.slice(0, 2), names.length - 2)
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

  const [names, setNames] = useState<Record<string, string>>({})
  useEffect(() => {
    void sendWallets().then(setWallets)
    void walletNames().then(setNames)
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
        const invoice = await getInvoice(await payParams(addr), sats, `Waroo: ${state.name ?? meta.name}`)
        setPhase({ at: 'ready', quote: { invoice, sats: invoice.sats, price: rate.price, source: rate.source, target }, next })
        return
      } catch (err) {
        const why = (err as Error).message
        problems.push(t`${addr}: ${why}`)
      }
    }
    setPhase({
      at: 'error',
      message:
        tried.length === 1
          ? (problems[0]!.split(': ').slice(1).join(': '))
          : noneWorked(toName, problems.join(' ')),
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
        reason: (err as Error).message || t`the payment didn’t go through`,
        certain: err instanceof WalletPayError && err.certain,
      })
      return
    }
    // An offer's wallet may not report the proof; when it does, it has to check out.
    if ((preimage || !q.offer) && !(paymentHash && preimage && (await provesPayment(paymentHash, preimage)))) {
      setPhase({
        at: 'error',
        message: t`Your wallet reported the payment, but its proof didn’t check out.`,
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
      <h2 id="bitcoin-title">{t`Pay with bitcoin`}</h2>

      {!address ? (
        <p>{t`${toName} hasn’t added a Lightning address yet, so they can’t receive bitcoin. They can add one in Settings.`}</p>
      ) : phase.at === 'paid' ? (
        <>
          <p className="bitcoin-done" role="status">
            <Trans>
              Paid {money(amount, currency)} to {toName} ({satsText(phase.sats)}).
            </Trans>
          </p>
          <button type="button" className="button primary" onClick={onPaid}>
            {t`Done`}
          </button>
        </>
      ) : phase.at === 'ready' || phase.at === 'paying' || phase.at === 'external' || phase.at === 'failed' ? (
        <>
          <dl className="quote">
            <div>
              <dt>{t`You pay`}</dt>
              <dd>{money(amount, currency)}</dd>
            </div>
            <div>
              <dt>{t`In bitcoin`}</dt>
              <dd>{satsText(phase.quote.sats)}</dd>
            </div>
            <div>
              <dt>{t`Price`}</dt>
              <dd>
                {perBitcoin(pricePerBitcoin(phase.quote.price, currency))}
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
                {t`Open in wallet app`}
              </a>
              <p className="muted">{t`Or scan it with a wallet on another phone:`}</p>
              <a className="qr-link" href={`lightning:${phase.quote.invoice!.invoice}`} aria-label={t`Open in your wallet app`}>
                <QrCode text={`lightning:${phase.quote.invoice!.invoice.toUpperCase()}`} label={t`QR code to pay with a wallet app`} />
              </a>
              <button
                type="button"
                className="button outline"
                onClick={() => void navigator.clipboard.writeText(phase.quote.invoice!.invoice)}
              >
                {t`Copy invoice`}
              </button>
              {phase.quote.invoice!.verify ? (
                <p role="status">{t`Waiting for the payment… This updates by itself once it goes through.`}</p>
              ) : (
                <>
                  <p>{t`${toName}’s provider can’t confirm payments automatically. Once you’ve paid, mark it here.`}</p>
                  <button type="button" className="button outline" onClick={() => void record(phase.quote)}>
                    {t`I’ve paid it`}
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
              label={(w) => names[walletKey(w)] ?? sendLabel(w)}
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
          <p>{straightFrom(toName, currency === 'JPY' ? t`yen` : currency)}</p>
          {phase.at === 'error' && (
            <p className="bitcoin-error" role="alert">
              {phase.message}
              {phase.checkWallet && ` ${t`Check your wallet to see whether it went through before trying again.`}`}
            </p>
          )}
          <button
            type="button"
            className="button primary"
            disabled={amount <= 0 || phase.at === 'quoting'}
            onClick={() => void quote()}
          >
            {phase.at === 'quoting' ? t`Getting the price…` : amount > 0 ? payWithBitcoin(money(amount, currency)) : t`Pay with bitcoin`}
          </button>
          {wallets?.length === 0 && (
            <p className="muted">
              <Trans>
                Tip: <a href="#/settings?open=wallet">set up one-tap payments</a>, so you don’t have to switch apps.
              </Trans>
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
  label,
}: {
  /** A wallet's name: yours, or its own. */
  label: (w: SendWallet) => string
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
            <Trans>
              <strong>{label(failed)} couldn’t pay:</strong> {phase.reason}.
            </Trans>
          </p>
          {phase.certain ? (
            <p>{t`Nothing was paid.`}</p>
          ) : (
            <p>
              <Trans>
                It may still have paid. Check {label(failed)} before trying again, so you don’t pay twice.
              </Trans>
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
            ? t`Paying with ${label(next)}…`
            : phase.at === 'failed'
              ? phase.certain
                ? t`Try ${label(next)}`
                : t`It didn’t pay. Try ${label(next)}`
              : t`Pay with ${label(next)}`}
        </button>
      )}
      {/* Hands the invoice to whatever wallet app is installed, and waits for it here. */}
      <a
        className={`button ${next ? 'outline' : 'primary'}`}
        href={link}
        aria-disabled={phase.at === 'paying'}
        onClick={onExternal}
      >
        {wallets.length > 0 ? t`Open another wallet app` : t`Open in wallet app`}
      </a>
      {wallets.length === 0 && (
        <button type="button" className="link" onClick={onExternal}>
          {t`Paying from another phone? Show a QR code`}
        </button>
      )}
      {phase.quote.offer && (
        <p className="muted">
          {t`This is a BOLT12 offer. Your wallet needs to support BOLT12 to pay it.`}
          {onNextTarget && (
            <>
              {' '}
              <button type="button" className="link" onClick={onNextTarget}>
                {t`Pay their Lightning address instead`}
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
 * offer can be for any amount), and Waroo can't see the payment, so the
 * person marks it paid.
 */
function OfferExternal({ offer, sats, toName, onPaid }: { offer: string; sats: number; toName: string; onPaid: () => void }) {
  const link = `bitcoin:?lno=${offer}`
  const [copied, setCopied] = useState(false)
  return (
    <>
      <p className="lead">
        <Trans>
          Pay exactly <strong>{satsText(sats)}</strong>. You’ll type the amount in your wallet.
        </Trans>
      </p>
      <a className="button primary" href={link}>
        {t`Open in wallet app`}
      </a>
      <p className="muted">{t`Or scan it with a wallet on another phone:`}</p>
      <a className="qr-link" href={link} aria-label={t`Open in your wallet app`}>
        <QrCode text={offer} label={t`QR code of ${toName}’s BOLT12 offer`} />
      </a>
      <button
        type="button"
        className="button outline"
        onClick={() => void navigator.clipboard.writeText(offer).then(() => setCopied(true))}
      >
        {copied ? t`Offer copied` : t`Copy offer`}
      </button>
      <p>{t`Waroo can’t see payments to an offer. Once you’ve paid, mark it here.`}</p>
      <button type="button" className="button outline" onClick={onPaid}>
        {t`I’ve paid it`}
      </button>
    </>
  )
}

function fromList(names: string[]) {
  const list = new Intl.ListFormat(locale(), { type: 'conjunction' }).format(names)
  return t`from ${list}`
}

function fromSome(names: string[], more: number) {
  const list = names.join(t`, `)
  return t`from ${list} and ${more} more`
}

function noneWorked(name: string, problems: string) {
  return t`None of ${name}’s addresses could take a payment right now. ${problems}`
}

function payWithBitcoin(amount: string) {
  return t`Pay ${amount} with bitcoin`
}

function perBitcoin(price: string) {
  return t`${price} per bitcoin`
}

function straightFrom(name: string, currency: string) {
  return t`Straight from your wallet to ${name}’s, at today’s price. The payment is checked automatically and recorded in ${currency}.`
}
