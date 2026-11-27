# Waroo

At [getwaroo.app](https://getwaroo.app).

Split bills any way you like, track who owes whom, and settle up in bitcoin, all shown in your own currency. No one ever holds your money, and the server can't read your groups.

Status: early, experimental, and **not audited**. Real bitcoin moves, so please use small amounts. You can create groups, invite friends with a link, and everyone adds expenses from their own phone, with changes syncing live and end-to-end encrypted. Splits can be equal, by shares, by percentage, exact, adjusted or itemized, with one or several payers. Debts can be settled in bitcoin straight from your wallet to theirs (Lightning addresses and BOLT12 offers), or marked as paid in cash or by bank transfer. There are notifications, moving to a new phone, removing members and recovering a lost phone. English and Japanese.

## Principles

- **Non-custodial.** Payments go straight from one person's wallet to another's. Nothing we run holds keys, balances or anything that can spend.
- **Private by design.** A group's history is a signed, encrypted event log. The sync relay stores and forwards it but can't read it. The group key travels in the invite link.
- **Debts stay in fiat.** If you owe ¥4,800, you owe ¥4,800 whatever bitcoin does. Bitcoin amounts are worked out only at the moment you pay, and the rate is recorded with the payment.
- **Bitcoin is optional.** Cash and bank transfers are first-class, so the app works for groups where nobody uses bitcoin.
- **A PWA, not an app-store app.** One codebase that installs from the browser and works offline.

## Security

What it's designed to guarantee, and what it doesn't (yet). Details in [docs/sync.md](docs/sync.md) and [docs/payments.md](docs/payments.md); to report a problem, see [SECURITY.md](SECURITY.md).

**Designed to hold:**
- The relay stores and forwards encrypted, signed events. It can't read a group, change an entry or write as anyone, and every phone keeps its own full copy.
- Payments go wallet to wallet. Before paying, the app checks the invoice is for exactly the amount and matches the receiver's Lightning address, and the payer's phone checks the preimage the wallet returns. Only the payer can record a bitcoin payment.
- Invite links carry a one-time secret, not the group key. They can expire, be single-use, or be turned off. Removing someone rotates the group key.

**Known limits:**
- **Metadata.** The relay sees when encrypted blobs arrive, roughly how big they are, and the IP addresses connecting. Today there's one relay, run by us.
- **Wallet connections** (Nostr Wallet Connect strings) are stored unencrypted in the browser's storage on your phone. Anyone with your unlocked phone, or code running on the page, could spend up to the connection's budget, so set a budget.
- **Removal is forward-only.** A removed member keeps everything they'd already seen. For 60 days phones still read the old room for anyone who missed the change, but nothing written there can add, restore or vouch for anyone, and only people who were in the group at the change are handed the new key there.
- **Recovery trusts the voucher.** Any member can vouch for someone's new phone after a loss. Everyone sees who did it, but a malicious member could misuse it.
- **A bitcoin receipt is the payer's word.** The receiver's phone sees the payer's preimage but can't check it against an invoice it never saw, so the app says "over Lightning", not "verified". Check your wallet for the real thing.
- **Members are trusted with the ledger.** Anyone in a group (or holding a working invite) can add or delete expenses, as in any shared-ledger app. A malicious member with a modified app can also make trouble that's hard to undo: claim a place nobody has joined as yet, hand some people a group key that doesn't open, or race their own copy of history into a new room. Nothing in Waroo stops a friend from being a bad friend; it stops strangers, the relay, and removed members.
- **Joining trusts the invite.** A phone joining learns who's who from the inviter's phone. Clocks are chosen by whoever writes an event, so a phone that has already seen someone join rejects a back-dated claim to be them, but a phone joining fresh with an old invite only knows what that invite told it.
- **Lightning address comments.** When the receiver's address takes comments, the payment's comment ("Waroo: <group name>") goes to their Lightning provider.
- **₿names (BIP-353)** are looked up once, through Cloudflare's DNS-over-HTTPS resolver, trusting its DNSSEC check instead of validating locally.
- **Bitcoin prices** come from our Worker, which asks several exchanges and only answers when at least two agree within 2%.
- **Feedback and the updates list** are the one part the server can read: reports are emailed, and opted-in addresses are stored.

## Layout

| Path | What |
| --- | --- |
| `packages/ledger` | Pure TypeScript ledger with no runtime dependencies: money handling, split methods, balances, settlements, suggested transfers, and the event-log replay. |
| `apps/web` | The PWA: Vite + React, stores each group's event log in IndexedDB, installable and works offline. |
| `worker` | The Cloudflare Worker: serves the app, runs the sync relay (one Durable Object per group) and the bitcoin price endpoint. |
| `docs` | [How sync works](docs/sync.md), [paying in bitcoin](docs/payments.md), [design system](docs/design.md). |
| `e2e` | Browser tests that act as several phones at once. |

## Development

Requires Node 22.18 or later (for built-in TypeScript type stripping) and pnpm.

```sh
pnpm install
pnpm dev         # the app alone at http://localhost:5173 (no sync)
pnpm build       # production build of the app in apps/web/dist
pnpm relay       # app + sync relay at http://127.0.0.1:8787 (serves the last build)
pnpm test        # unit tests
pnpm typecheck
pnpm e2e         # multi-phone browser tests; needs `pnpm relay` running
pnpm splash      # remake the iOS launch images after changing the logo
```

The ledger's tests also run with nothing installed: `cd packages/ledger && node --test "test/**/*.test.ts"`.

## License

MIT, for everything: see [LICENSE](LICENSE). Parts of `packages/ledger` are adapted from [Spliit](https://github.com/spliit-app/spliit), also under the MIT License; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
