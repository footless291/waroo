# How sync works

Footless groups sync between phones through a relay that stores and forwards encrypted changes. The relay can't read a group, can't change it, and can't pretend to be anyone in it. The money itself never touches any of this: it moves from wallet to wallet.

## The pieces

| Piece | Where | What it knows |
| --- | --- | --- |
| Group key | Each member's phone, and invite links after the `#` | Everything: it decrypts the group |
| Signing key | One per person per group, on their phone; the private half can't be exported, even by Footless | Proves "this change came from Bob's phone" |
| Relay room | Cloudflare Durable Object (`worker/index.ts`) | A list of encrypted blobs, their ids and arrival order. Nothing readable |
| Event log | Each phone, in IndexedDB | The group's full history, verified |

## What happens when you…

**Create a group.** The phone makes a random 256-bit group key and a signing key pair. The first event in the log adds you, with your public key. Nothing leaves the phone yet.

**Invite people.** The group is marked shared, and its whole history is encrypted and sent to the relay room. The room's name is a SHA-256 hash of the group key, so the relay never learns the key. The invite link is `/#/join?g=<group id>&k=<group key>&from=<your id>`. Browsers never send the part after `#` to any server, Cloudflare included.

**Open an invite.** The phone derives the room name from the key, downloads everything, decrypts it and checks every signature, then shows the group name and the people in it (no money). Joining as an existing person adds a `member.claimed` event with the new phone's public key. Joining as someone new adds a `member.added` event for yourself, with your key. Either way the event is signed with that same key.

**Add an expense.** The phone writes an event, signs it with its private key, encrypts it with the group key (AES-GCM, fresh random IV) and sends it. Other phones in the group get it within a second if they're open, or the next time they open the app.

**Go offline.** Changes are saved on the phone and queued. When the connection comes back, the phone catches up on what it missed and sends what it queued. The event log's ordering (Lamport clocks) means every phone ends up with the same result, whatever order things arrive in. If two people edit the same expense at once, the later edit wins and the app says so.

## What the rules guarantee

Every phone checks every event when it rebuilds the group (`packages/ledger/src/events.ts`):

- Each event's signature must match the public key recorded for its author. A change can't be forged in someone else's name, even by someone who has the invite link.
- A person added by someone else can be claimed by one phone only: the first claim wins.
- Only a phone adding itself can attach a key to a new person.
- Anything that fails to decrypt, fails its signature check, or breaks a rule is ignored and doesn't affect anything else.

## What it doesn't protect against (yet)

- **Anyone with the invite link can join.** The link is the key. Expiring and one-time links are in the backlog.
- **Removing someone** would need a new group key. Not built yet.
- **A lost phone** loses that phone's key; the person can't write as themselves again until moving to a new phone is built (in the backlog). The group's data is safe on everyone else's phone.
- **Metadata.** The relay sees when blobs arrive, roughly how big they are, and the IP addresses connecting to a room. It can't read anything else.
- **Deleting everything.** A malicious relay could refuse to store or forward changes. It can't fake or alter them, and every phone keeps its own full copy.

## The relay protocol

A WebSocket at `/relay/rooms/<room id>`, JSON messages:

| From | Message | Meaning |
| --- | --- | --- |
| Phone | `{ "t": "hello", "since": <seq> }` | Send me everything after this position |
| Relay | `{ "t": "items", "items": [{ "seq", "id", "data" }], "upTo", "done" }` | Backlog, in pages; `done` on the last |
| Relay | `{ "t": "items", "items": [...], "live": true }` | Something new from another phone |
| Phone | `{ "t": "push", "items": [{ "id", "data" }] }` | Store these (up to 200, 64 KB each) |
| Relay | `{ "t": "ack", "ids": [...] }` | Stored (duplicates are ignored) |
| Relay | `{ "t": "error", "message" }` | Something was refused |

Anyone can run their own relay: it's one small Worker with no secrets.

## Testing

`pnpm relay` runs the app and relay locally on port 8787. `pnpm e2e` then drives several browser profiles as different phones: inviting, joining, live updates, offline changes, upgrading groups made before sharing existed, and garbage or forged data at the relay.
