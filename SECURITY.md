# Security

Waroo is early and hasn't been audited. Reports are very welcome.

## Reporting a vulnerability

Email **hello@getwaroo.app** with what you found, how to reproduce it, and what an attacker could do with it. Please don't open a public issue for anything that could put people's money or privacy at risk until it's fixed. Expect a reply within a few days.

## What matters most

- Anything that lets someone **spend, redirect or fake a payment**: e.g. getting a payer to pay the wrong invoice or amount, or marking an unpaid debt as paid in bitcoin.
- Anything that lets the **relay, a removed member or an outsider read or change a group**, or write as someone else.
- **Invite, move-phone and recovery** flows: taking over someone's place in a group.
- Cross-site scripting or anything else that runs code in the app's page, since the page holds wallet connections.
- Abuse of the relay or the feedback endpoint (storage, push or email flooding).

Known limits are listed in the README under "Security, honestly". The threat model and protocol are in [docs/sync.md](docs/sync.md) and [docs/payments.md](docs/payments.md).
