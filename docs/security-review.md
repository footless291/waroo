# Security review, November 2026

A Claude Security scan of commit `91bc557` (medium effort) was stopped before its verification panel ran. It left 81 unverified candidates. Each was then checked against the code by hand. This page records what happened to each one. "Fixed" means changed and covered by a test. "By design" and "Accepted" are listed under Known limits in the README.

Nothing here has been independently audited.

## Fixed

| Theme | Candidates | What changed |
|---|---|---|
| A malformed event could crash replay or a screen for everyone in a group | C1, C5, C13, C14, C24, C25, C31–C37, C41, C43, C61, C77, C81 | Every event's shape is checked before replay uses it (`packages/ledger/src/shape.ts`): ids, clocks, times, titles, dates, currency codes (three ASCII capitals), split kinds and amounts, which are capped at 10¹² minor units so sums stay exact. Replay catches anything left over and rejects it. A clock that jumps more than a million ahead is rejected. Ids can't contain `/`, `?` or `#`. The app also has an error boundary, so one screen failing can't blank the app. |
| A back-dated unsigned founding event could switch signatures off | C4 | An unsigned founding event is rejected in any group that has a signed event. |
| A back-dated join or claim could take over someone's identity | C6, C7 | Phones keep the key each person first joined with (`pins`) and reject a conflicting join or claim. Invites and moves carry the pins along. This doesn't cover a phone joining fresh with an old invite (see Known limits). |
| A removed member could get the new key back through the old room | C2, C3, C8, C11, C12 | The old room's watcher drops adds, claims, recoveries, removals and moves. The current key is handed over there only to people who were in the group, on the same key, when this phone moved. |
| Moving phones or recovery sent group keys and wallet connections readable by anyone with the QR secret or link | C9, C10, C18, C27, C69 | The new phone sends a one-off box key in its hello, and the 4-digit code covers it. The hand-over is locked to that key. The old phone accepts `done` only with proof that the new phone opened it. A test checks that a passive reader with the secret learns nothing. |
| A second hello could slip in before the screen updated | C53, C54 | The first hello is recorded before anything else happens; any second one stops the move. |
| A move-in link could plant addresses, wallets or bad records | C15, C19, C20, C26, C52 | Everything in a hand-over is validated. It's accepted once only. Wallets come along only to a phone that has none of its own. Joining checks that a stored group with the same id has the same key. |
| Payment "verified" labels and forged payment records | C16, C21, C23, C29, C46, C51 | Only the payer can record a bitcoin payment. Only the people in a payment, or whoever recorded it, can undo it. The "verified" label is gone; the app now says "over Lightning". |
| Someone adding a person could set where that person gets paid | C17 | Only people themselves can set addresses, offers or box keys. |
| Renaming people who had left or been removed | C72 | Refused. Names are limited to 80 characters. |
| Notifications and banners described rejected events, or credited the wrong person | C28, C30, C40, C59, C60, C70 | Only events the ledger accepted become news. Payment notices name whoever recorded the payment. |
| Invites: rejected hand-offs blocked joining; one group could take over another's id | C67, C68, C75 | The check for an out-of-date invite looks only at accepted hand-offs. A group id must match the key it was saved with. |
| Invite links could be brought back to life | C64 | Used, stopped and expired invites are kept (without their contents) for good. |
| The relay could be made to build huge pages, or to resend everything in a loop | C38, C50, C56, C78 | Pages are capped at 2 MB. Items must be base64url. Each connection can ask for the backlog once every 2 seconds. |
| Anyone could fill storage or send many notifications | C44, C62, C65 | All `/relay/` requests are limited to 300 a minute per IP (per /64 for IPv6). A room's size check includes the incoming push. Notifications go out at most every 3 seconds per room, with one trailing round. |
| Fake push addresses could block real phones | C66 | An address is dropped after 5 failures in a row. |
| A one-off move-room wipe could be asked for on a real group's room | C63 | The wipe is skipped for any room with more than 20 items or any phones subscribed. |
| Repeated price lookups | C71 | Failed answers are cached for 30 seconds. |
| Unbounded request bodies | C73, C74 | Bodies are read with a byte cap. |
| Feedback: header characters, flooding, re-subscribing someone who unsubscribed | C22 (part), C45, C80 | Control characters are stripped from the subject. Sends are capped at 300 a day overall and accepted only from the app's own pages as JSON. Signing up again no longer clears an unsubscribe. |
| NWC errors said "nothing was paid" when it might have been | C58 | Errors that can happen after sending now say it may or may not have paid. |
| The group name was sent as a comment even when the Lightning address doesn't take comments | C76 (part) | A comment is sent only when the address takes one, and no longer than it allows. |

## By design, documented

| Candidates | Why |
|---|---|
| C49, C57 | Any one member can vouch for someone's new phone. That's the recovery design. Everyone is told, including the person. |
| C48 | Anyone holding a working invite can claim a place nobody holds a key for, including someone removed. That's how a removed person rejoins. |
| C76 (rest) | When the address takes comments, the group name goes to the receiver's Lightning provider, so they can tell what a payment was for. |

## Accepted for now (Known limits)

| Candidates | Why |
|---|---|
| C39, C42 | The relay keeps the first item for each event id. A current member who knows a new room first could put their own copy in it. Needs a malicious member with a modified app. A fix would change the relay's storage. |
| C47 | Event ids are unique across all groups on a phone. A member of one group could hide an event of another group the victim later joins. Needs that member to know the other group's ids. |
| C55 | A member can hand someone a group key that doesn't open. Needs a malicious member. |
| C22 (rest) | Anyone can sign any address up for updates. Confirming by email (double opt-in) is required before the first newsletter, and is on the roadmap. |
| C79 | Opening an invite page uses up a one-person invite before anyone taps Join. Link previews (LINE and others) fetch the page without the `#` part, so they can't open it. |
