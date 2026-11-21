import { useState, type FormEvent } from 'react'
import { payParams } from '../lib/lightning.ts'
import { setMyLightningAddress } from '../lib/db.ts'
import { connectNwc, type WalletInfo } from '../lib/wallet.ts'

/** The wallet we suggest to people who don't have one: free, username and password, no email. */
const COINOS = { name: 'Coinos', signup: 'https://coinos.io/register', site: 'https://coinos.io', domain: 'coinos.io' }

/** "anna" or "anna@coinos.io" → "anna@coinos.io"; null if it can't be a Coinos username. */
function coinosAddress(text: string): string | null {
  const clean = text.trim().toLowerCase().replace(/@coinos\.io$/, '')
  return /^[a-z0-9._-]{1,64}$/.test(clean) ? `${clean}@${COINOS.domain}` : null
}

/**
 * Three steps for someone with no bitcoin wallet: make a Coinos account, tell
 * Footless the username (that's the Lightning address), then optionally
 * connect it for one-tap payments. Wallet sites open in the phone's own
 * browser sheet; they can't be shown inside Footless's page.
 */
export function WalletSetup({
  address,
  wallet,
  onAddress,
  onWallet,
  onOwnWallet,
}: {
  address: string
  wallet: WalletInfo | null | undefined
  onAddress: (address: string) => void
  onWallet: (wallet: WalletInfo) => void
  onOwnWallet: () => void
}) {
  const [username, setUsername] = useState('')
  const [nwc, setNwc] = useState('')
  const [note, setNote] = useState('')
  const [connectNote, setConnectNote] = useState('')
  const [busy, setBusy] = useState(false)
  const candidate = coinosAddress(username)
  const step = !address ? 2 : !wallet ? 3 : 4

  async function saveUsername(e: FormEvent) {
    e.preventDefault()
    if (!candidate) return
    setBusy(true)
    setNote('Checking…')
    try {
      await payParams(candidate)
      await setMyLightningAddress(candidate)
      onAddress(candidate)
      setNote('')
    } catch {
      setNote(`Couldn’t find ${candidate}. Check the username is exactly as you chose it in Coinos.`)
    } finally {
      setBusy(false)
    }
  }

  async function paste() {
    try {
      setNwc((await navigator.clipboard.readText()).trim())
    } catch {
      setConnectNote('Footless couldn’t read what you copied. Press and hold the box below, then choose Paste.')
    }
  }

  async function connect(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setConnectNote('Checking your wallet…')
    try {
      onWallet(await connectNwc(nwc))
      setNwc('')
      setConnectNote('')
    } catch (err) {
      setConnectNote((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="settings-card setup">
      <h2>Set up bitcoin</h2>
      <p>
        To get paid back and pay others in bitcoin, you need a bitcoin wallet. If you don’t have one, {COINOS.name} is
        free and takes a minute: just a username and a password.
      </p>
      <ol className="setup-steps">
        <li className={step > 2 ? 'done' : 'current'}>
          <h3>Make a {COINOS.name} account</h3>
          <p>Choose a username and a password. Write the password down: it’s the only way back into your wallet.</p>
          <a className="button outline small" href={COINOS.signup} target="_blank" rel="noopener noreferrer">
            Open {COINOS.name}
          </a>
        </li>

        <li className={step > 2 ? 'done' : 'current'}>
          <h3>Tell Footless your username</h3>
          {address ? (
            <p>
              Friends can pay you at <strong>{address}</strong>.
            </p>
          ) : (
            <form className="field-stack" onSubmit={saveUsername}>
              <label className="field">
                <span>Your {COINOS.name} username</span>
                <input
                  value={username}
                  onChange={(e) => {
                    setUsername(e.target.value)
                    setNote('')
                  }}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  aria-describedby="coinos-address"
                />
              </label>
              <p id="coinos-address" className="hint" aria-live="polite">
                {note || (candidate ? `Friends will pay you at ${candidate}` : '')}
              </p>
              <button className="button primary" disabled={!candidate || busy}>
                Save
              </button>
            </form>
          )}
        </li>

        <li className={step === 3 ? 'current' : step > 3 ? 'done' : ''}>
          <h3>Pay in one tap (optional)</h3>
          {step < 3 ? (
            <p className="muted">After step 2.</p>
          ) : wallet ? (
            <p>Connected. Footless asks {wallet.name} to pay only when you confirm a payment.</p>
          ) : (
            <>
              <p>
                Without this, paying opens {COINOS.name} so you can approve it there, which works fine. To pay without
                switching apps: in {COINOS.name}, open your account settings, find <strong>Nostr Wallet Connect</strong>,
                copy the connection (it starts with nostr+walletconnect://) and paste it here.
              </p>
              <a className="button outline small" href={COINOS.site} target="_blank" rel="noopener noreferrer">
                Open {COINOS.name}
              </a>
              <form className="field-stack" onSubmit={connect}>
                <label className="field">
                  <span>Wallet connection</span>
                  <input
                    type="password"
                    value={nwc}
                    onChange={(e) => setNwc(e.target.value)}
                    placeholder="nostr+walletconnect://…"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                  />
                </label>
                <div className="button-row">
                  <button type="button" className="button outline" onClick={paste}>
                    Paste
                  </button>
                  <button className="button primary" disabled={!nwc.trim() || busy}>
                    Connect
                  </button>
                </div>
                <p className="hint" aria-live="polite">
                  {connectNote}
                </p>
              </form>
            </>
          )}
        </li>
      </ol>
      <button type="button" className="link" onClick={onOwnWallet}>
        I already have a wallet
      </button>
    </section>
  )
}
