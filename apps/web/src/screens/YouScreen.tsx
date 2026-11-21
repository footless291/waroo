import { isLightningAddress } from '@footless/ledger'
import { useEffect, useState, type FormEvent } from 'react'
import { Header } from '../components/Header.tsx'
import { NotificationsCard } from '../components/NotificationsCard.tsx'
import { WalletSetup } from '../components/WalletSetup.tsx'
import { myLightningAddress, setMyLightningAddress } from '../lib/db.ts'
import { connectNwc, connectWebln, connectedWallet, disconnectWallet, hasWebln, type WalletInfo } from '../lib/wallet.ts'

export function YouScreen() {
  const [address, setAddress] = useState('')
  const [savedAddress, setSavedAddress] = useState<string>()
  const [addressNote, setAddressNote] = useState('')
  const [wallet, setWallet] = useState<WalletInfo | null>()
  const [nwc, setNwc] = useState('')
  const [walletNote, setWalletNote] = useState('')
  const [busy, setBusy] = useState(false)
  // People with nothing set up get the guided Coinos setup; it stays while they work through it.
  const [guide, setGuide] = useState<boolean>()

  useEffect(() => {
    void Promise.all([myLightningAddress(), connectedWallet()]).then(([a, w]) => {
      setAddress(a)
      setSavedAddress(a)
      setWallet(w ?? null)
      setGuide(!a && !w)
    })
  }, [])

  const trimmed = address.trim()
  const addressValid = trimmed === '' || isLightningAddress(trimmed)

  async function saveAddress(e: FormEvent) {
    e.preventDefault()
    if (!addressValid) return
    await setMyLightningAddress(trimmed)
    setSavedAddress(trimmed.toLowerCase())
    setAddressNote(trimmed ? 'Saved. Your groups can now pay you in bitcoin.' : 'Removed.')
  }

  async function connect(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setWalletNote('Checking your wallet…')
    try {
      setWallet(await connectNwc(nwc))
      setNwc('')
      setWalletNote('Connected.')
    } catch (err) {
      setWalletNote((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function connectBrowser() {
    setBusy(true)
    try {
      setWallet(await connectWebln())
      setWalletNote('Connected.')
    } catch (err) {
      setWalletNote((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="screen">
      <Header title="You" back="/" />
      <div className="form">
        {guide && (
          <WalletSetup
            address={savedAddress ?? ''}
            wallet={wallet}
            onAddress={(a) => {
              setAddress(a)
              setSavedAddress(a)
            }}
            onWallet={setWallet}
            onOwnWallet={() => setGuide(false)}
          />
        )}
        {guide === false && (
        <>
        <form className="settings-card" onSubmit={saveAddress}>
          <h2>Get paid in bitcoin</h2>
          <p>
            When friends settle up with bitcoin, it goes straight to your Lightning address. It’s shared only with your
            groups.
          </p>
          <label className="field">
            <span>Your Lightning address</span>
            <input
              value={address}
              onChange={(e) => {
                setAddress(e.target.value)
                setAddressNote('')
              }}
              placeholder="you@walletofsatoshi.com"
              inputMode="email"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              aria-invalid={!addressValid}
            />
          </label>
          <p className="hint" aria-live="polite">
            {!addressValid ? 'That doesn’t look like a Lightning address. It looks like an email: name@provider.com' : addressNote}
          </p>
          <button className="button primary" disabled={!addressValid || trimmed.toLowerCase() === savedAddress}>
            Save
          </button>
        </form>

        <section className="settings-card">
          <h2>Pay with bitcoin</h2>
          {wallet ? (
            <>
              <p>
                Connected to <strong>{wallet.name}</strong>
                {wallet.kind === 'nwc' ? ' with Nostr Wallet Connect.' : ' in this browser.'} Footless only asks it to
                pay when you confirm a payment.
              </p>
              <button
                className="button outline"
                onClick={async () => {
                  await disconnectWallet()
                  setWallet(null)
                  setWalletNote('Disconnected.')
                }}
              >
                Disconnect
              </button>
            </>
          ) : (
            <>
              <p>
                Connect your own wallet to pay in one tap. In your wallet app (Alby Hub, Zeus, Primal, Coinos and others),
                make a new Nostr Wallet Connect connection for Footless, ideally with a monthly budget, and paste it here.
                It stays on this phone.
              </p>
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
                <button className="button primary" disabled={!nwc.trim() || busy}>
                  Connect wallet
                </button>
              </form>
              {hasWebln() && (
                <button className="button outline" disabled={busy} onClick={connectBrowser}>
                  Use my browser wallet
                </button>
              )}
              <p className="muted">No wallet to connect? You can still pay by scanning a QR code with any wallet app.</p>
            </>
          )}
          <p className="hint" aria-live="polite">
            {walletNote}
          </p>
        </section>

        </>
        )}

        <NotificationsCard />

        <section className="settings-card">
          <h2>Moving to a new phone</h2>
          <p>
            Move your groups to another phone, so you can keep adding expenses and settling up there. Have both phones
            with you.
          </p>
          <a className="button outline" href="#/move">
            Move to a new phone
          </a>
        </section>
      </div>
    </main>
  )
}
