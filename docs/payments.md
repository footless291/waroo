# Paying in bitcoin

Debts in Footless are in ordinary money (yen, dollars). Bitcoin is just how a debt can be paid: the amount in bitcoin is worked out at the moment of paying, sent straight from the payer's wallet to the receiver's, and recorded with the rate used and proof that it arrived. Footless never holds anyone's money, and its server is never in the middle of a payment.

## Setting up

- **To receive:** add a Lightning address under **You** (it looks like an email address, e.g. `you@walletofsatoshi.com`). It's published, encrypted, to your groups as a `member.updated` event. Only you can set or change your own address; the ledger rejects anyone else trying.
- **To pay in one tap:** connect your wallet under **You**, either by pasting a Nostr Wallet Connect string from your wallet app (ideally with a spending budget) or by using a browser wallet extension (WebLN). The connection is stored only on that phone and is never synced.
- **No wallet to connect:** you can still pay by scanning a QR code or opening the invoice in any wallet app.

## What happens when you pay

1. **Price.** The phone asks Footless's Worker for the bitcoin price (`/relay/rate`). The Worker asks exchanges with a real market in that currency (for yen: Kraken, bitFlyer, bitbank and Coincheck), plus a cross-check for any currency: bitcoin's US-dollar price from several exchanges times the ECB exchange rate. It answers only when at least two sources agree within 2%, using the middle one, and never trusts a single source. Each source's answer is included in the response and logged. Going through the Worker means the price sites never see who's paying.
2. **Amount.** `fiatToSats` converts with exact integer arithmetic and rounds up, so the receiver is never short.
3. **Invoice.** The phone asks the receiver's Lightning address provider (LNURL-pay) for an invoice for exactly that many sats. It talks to the provider directly.
4. **Checks before paying.** The invoice must be for exactly the amount asked, match the provider's description (its description hash), have a valid payment hash, and not be about to expire. Anything else is refused and nothing is paid.
5. **Paying.** The connected wallet pays the invoice and returns the preimage.
6. **Proof.** The SHA-256 of the preimage must equal the invoice's payment hash. Only then is the payment recorded, as a settlement in the group's currency with the sats, rate, rate source, payment hash and preimage attached. Everyone in the group sees it marked "verified".

If the wallet reports an error, or reports success with a proof that doesn't check out, nothing is recorded, and the app tells you to check your wallet before trying again, so nobody pays twice by accident.

**Paying from another wallet app:** the app shows the invoice as a QR code and a `lightning:` link. If the receiver's provider supports payment confirmation (LUD-21), the app checks every few seconds and records the payment, with proof, by itself. Otherwise you mark it as paid once you have, and it's recorded without a proof.

## Limits and known gaps

- **Lightning addresses that don't allow web apps.** Some providers don't send the headers browsers need, so the phone can't fetch an invoice. The app says so plainly. A server-side fallback was deliberately left out: it would put Footless in the middle of payments and could be abused as an open proxy.
- **Price sources.** If fewer than two sources agree, paying in bitcoin pauses with a message rather than risk a wrong price. On Nov 20, 2026, Coinbase's BTC-JPY "spot" price read ¥35.6M against a real ¥9.85M (Coinbase has no real yen market), and CoinGecko refuses requests from Cloudflare's servers; both were dropped for that reason. Currencies other than USD, EUR, GBP, JPY, CAD, AUD and CHF currently rely on the dollar cross-check alone, so they pause until a second source is added.
- **Tax records.** Every bitcoin settlement already carries what a tax record needs (date, amount in yen, sats, rate, source). An export screen is still to come.

## Testing

`e2e/bitcoin.cjs` runs the whole flow against a simulated Lightning world: a fake provider issuing real signed invoices and a fake wallet. It covers setting an address, connecting a wallet, a provider asking for the wrong amount, a wallet with a bad proof, a successful payment seen on both phones, and paying from another app with automatic confirmation. No real money is involved.
