import { Trans } from '@lingui/react/macro'
import { t } from '@lingui/core/macro'
import { cleanOffer, isLightningAddress, isOffer } from '@waroo/ledger'
import { useState, type FormEvent } from 'react'
import { looksLikeName, resolveOffer } from '../lib/bip353.ts'
import { payParams } from '../lib/lightning.ts'
import { exchangeRizfulCode, RIZFUL } from '../lib/rizful.ts'
import { checkNwc, checkWebln, hasWebln } from '../lib/wallet.ts'
import { addReceive, addReceiveNamed, addSend, type ReceiveWallet, type SendWallet } from '../lib/wallets.ts'

/**
 * Step-by-step setup for wallets we know, made as short as each allows, and
 * a plain form for any other wallet. Wallet sites open in the phone's own
 * browser sheet; they can't be shown inside Waroo's page.
 */

const COINOS = {
  signup: 'https://coinos.io/register',
  nostrSettings: 'https://coinos.io/settings/nostr',
  domain: 'coinos.io',
}

export interface GuideProps {
  receive: ReceiveWallet[]
  send: SendWallet[]
  onChange: () => void
}

/** "anna" or "anna@coinos.io" → "anna@coinos.io"; null if it can't be a Coinos username. */
function coinosAddress(text: string): string | null {
  const clean = text.trim().toLowerCase().replace(/@coinos\.io$/, '')
  return /^[a-z0-9._-]{1,64}$/.test(clean) ? `${clean}@${COINOS.domain}` : null
}

async function pasted(): Promise<string> {
  return (await navigator.clipboard.readText()).trim()
}

/** A paste box with a Paste button, for connection strings and codes. */
function PasteField({
  label,
  value,
  onChange,
  placeholder,
  secret,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder: string
  secret?: boolean
}) {
  const [note, setNote] = useState('')
  return (
    <>
      <div className="paste-row">
        <label className="field grow">
          <span>{label}</span>
          <input
            type={secret ? 'password' : 'text'}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
        </label>
        <button
          type="button"
          className="button outline"
          onClick={async () => {
            try {
              onChange(await pasted())
              setNote('')
            } catch {
              setNote(t`Waroo couldn’t read what you copied. Press and hold the box, then choose Paste.`)
            }
          }}
        >
          {t`Paste`}
        </button>
      </div>
      {note && <p className="hint">{note}</p>}
    </>
  )
}

/** Coinos: account, username (that's the address), then optionally a connection to pay. */
export function CoinosGuide({ receive, send, onChange, onDone }: GuideProps & { onDone?: () => void }) {
  const address = receive.find((w) => w.provider === 'coinos')?.address
  const paying = send.some((w) => w.provider === 'coinos')
  const [username, setUsername] = useState('')
  const [nwc, setNwc] = useState('')
  const [note, setNote] = useState('')
  const [connectNote, setConnectNote] = useState('')
  const [busy, setBusy] = useState(false)
  const candidate = coinosAddress(username)

  async function saveUsername(e: FormEvent) {
    e.preventDefault()
    if (!candidate) return
    setBusy(true)
    setNote(t`Checking…`)
    try {
      await payParams(candidate)
      await addReceive(candidate)
      setNote('')
      onChange()
    } catch {
      setNote(t`Couldn’t find ${candidate}. Check the username is exactly as you chose it in Coinos.`)
    } finally {
      setBusy(false)
    }
  }

  async function connect(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setConnectNote(t`Checking your wallet…`)
    try {
      const { url } = await checkNwc(nwc)
      await addSend({ provider: 'coinos', name: 'Coinos', kind: 'nwc', url })
      setNwc('')
      setConnectNote('')
      onChange()
      // Everything's set up: the guide has done its job.
      onDone?.()
    } catch (err) {
      setConnectNote((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <ol className="setup-steps">
      <li className={address ? 'done' : 'current'}>
        <h3>{t`Make a Coinos account`}</h3>
        <p>{t`Choose a username and a password. Write the password down: it’s the only way back into your wallet.`}</p>
        <a className="button outline small" href={COINOS.signup} target="_blank" rel="noopener noreferrer">
          {t`Open Coinos`}
        </a>
      </li>
      <li className={address ? 'done' : 'current'}>
        <h3>{t`Tell Waroo your username`}</h3>
        {address ? (
          <p>
            <Trans>
              Friends can pay you at <strong>{address}</strong>.
            </Trans>
          </p>
        ) : (
          <form className="field-stack" onSubmit={saveUsername}>
            <label className="field">
              <span>{t`Your Coinos username`}</span>
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
              {note || (candidate ? t`Friends will pay you at ${candidate}` : '')}
            </p>
            <button className="button primary" disabled={!candidate || busy}>
              {t`Save`}
            </button>
          </form>
        )}
      </li>
      <li className={paying ? 'done' : 'current'}>
        <h3>{address ? t`Pay in one tap` : t`Pay in one tap (optional)`}</h3>
        {paying ? (
          <p>{t`Connected. Waroo asks Coinos to pay only when you confirm a payment.`}</p>
        ) : (
          <>
            <p>{t`Without this, paying opens Coinos so you can approve it there. To pay without switching apps:`}</p>
            <ol className="substeps">
              <li>
                <Trans>
                  Open Coinos’s Nostr settings, then tap <strong>New connection</strong>, name it Waroo, and set a budget
                  if you like.
                </Trans>
              </li>
              <li>
                <Trans>
                  Tap <strong>Submit</strong>, then <strong>Copy NWC</strong>.
                </Trans>
              </li>
              <li>{t`Come back here and tap Paste.`}</li>
            </ol>
            <a className="button outline small" href={COINOS.nostrSettings} target="_blank" rel="noopener noreferrer">
              {t`Open Coinos settings`}
            </a>
            <form className="field-stack" onSubmit={connect}>
              <PasteField label={t`Wallet connection`} value={nwc} onChange={setNwc} placeholder="nostr+walletconnect://…" secret />
              <button className="button primary" disabled={!nwc.trim() || busy}>
                {t`Connect`}
              </button>
              <p className="hint" aria-live="polite">
                {connectNote}
              </p>
            </form>
          </>
        )}
      </li>
    </ol>
  )
}

/** Rizful: account, then one code that sets up both getting paid and paying. */
export function RizfulGuide({ receive, send, onChange }: GuideProps) {
  const done = receive.some((w) => w.provider === 'rizful') && send.some((w) => w.provider === 'rizful')
  const [code, setCode] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  async function connect(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setNote(t`Connecting…`)
    try {
      const { nwc, address } = await exchangeRizfulCode(code)
      await addReceive(address)
      await addSend({ provider: 'rizful', name: 'Rizful', kind: 'nwc', url: nwc })
      setCode('')
      setNote(t`Connected. Friends can pay you at ${address}.`)
      onChange()
    } catch (err) {
      setNote((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <ol className="setup-steps">
      <li className={done ? 'done' : 'current'}>
        <h3>{t`Make a Rizful account`}</h3>
        <p>{t`Sign up with an email and a password. The email is how you get back in if you forget the password.`}</p>
        <a className="button outline small" href={RIZFUL.signup} target="_blank" rel="noopener noreferrer">
          {t`Open Rizful`}
        </a>
      </li>
      <li className={done ? 'done' : 'current'}>
        <h3>{t`Get a code and paste it here`}</h3>
        {done ? (
          <p>{t`Connected for getting paid and for paying.`}</p>
        ) : (
          <>
            <p>
              <Trans>
                In Rizful, tap <strong>Get code</strong> and copy it. That one code sets up both getting paid and paying.
              </Trans>
            </p>
            <a className="button outline small" href={RIZFUL.code} target="_blank" rel="noopener noreferrer">
              {t`Get a code in Rizful`}
            </a>
            <form className="field-stack" onSubmit={connect}>
              <PasteField label={t`Code from Rizful`} value={code} onChange={setCode} placeholder={t`Paste the code`} />
              <button className="button primary" disabled={!code.trim() || busy}>
                {t`Connect`}
              </button>
            </form>
          </>
        )}
        <p className="hint" aria-live="polite">
          {note}
        </p>
      </li>
    </ol>
  )
}

/** Any other wallet: an address to get paid at, or a connection to pay with. */
export function OtherWallet({ tab, onChange }: { tab: 'send' | 'receive'; onChange: () => void }) {
  const [address, setAddress] = useState('')
  const [nwc, setNwc] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  /**
   * Takes a Lightning address, a BOLT12 offer (lno1…), or a ₿name that
   * points to an offer. A plain address that isn't a Lightning address may
   * still be a ₿name without the ₿, so that's tried too.
   */
  async function saveAddress(e: FormEvent) {
    e.preventDefault()
    const offer = cleanOffer(address)
    if (isOffer(offer)) {
      await addReceiveNamed([offer])
      setAddress('')
      setNote(t`Added your BOLT12 offer.`)
      onChange()
      return
    }
    const clean = address.trim().toLowerCase().replace(/^₿/, '')
    if (!isLightningAddress(clean)) {
      setNote(t`That doesn’t look like a Lightning address (name@provider.com) or a BOLT12 offer (lno1…).`)
      return
    }
    setBusy(true)
    setNote(t`Checking…`)
    const named = async () => {
      const found = await resolveOffer(clean)
      await addReceiveNamed([found.offer], { [found.offer]: found.name })
      setAddress('')
      setNote(t`Added ${found.name}, a BOLT12 offer.`)
      onChange()
    }
    try {
      if (looksLikeName(address)) {
        await named()
        return
      }
      try {
        await payParams(clean)
      } catch (err) {
        try {
          await named()
          return
        } catch {
          throw err
        }
      }
      await addReceive(clean)
      setAddress('')
      setNote(t`Added ${clean}.`)
      onChange()
    } catch (err) {
      setNote(
        looksLikeName(address)
          ? t`${address.trim()} didn’t work: ${(err as Error).message}`
          : t`${clean} didn’t answer: ${(err as Error).message}`,
      )
    } finally {
      setBusy(false)
    }
  }

  async function connect(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setNote(t`Checking your wallet…`)
    try {
      const { url, name } = await checkNwc(nwc)
      await addSend({ provider: 'other', name, kind: 'nwc', url })
      setNwc('')
      setNote(t`Connected ${name}.`)
      onChange()
    } catch (err) {
      setNote((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function browser() {
    setBusy(true)
    try {
      const { name } = await checkWebln()
      await addSend({ provider: 'other', name, kind: 'webln' })
      setNote(t`Connected ${name}.`)
      onChange()
    } catch (err) {
      setNote((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return tab === 'receive' ? (
    <form className="field-stack" onSubmit={saveAddress}>
      <p>
        {t`Any wallet with a Lightning address works, like Wallet of Satoshi. Or paste a BOLT12 offer (lno1…) or a ₿name that has one, like Phoenix gives you.`}
      </p>
      <label className="field">
        <span>{t`Lightning address or BOLT12 offer`}</span>
        <input
          value={address}
          onChange={(e) => {
            setAddress(e.target.value)
            setNote('')
          }}
          placeholder="you@walletofsatoshi.com"
          inputMode="email"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
        />
      </label>
      <button className="button primary" disabled={!address.trim() || busy}>
        {t`Add`}
      </button>
      <p className="hint" aria-live="polite">
        {note}
      </p>
    </form>
  ) : (
    <div className="field-stack">
      <p>
        {t`In your wallet app (Alby Hub, Zeus, Primal and others), make a new Nostr Wallet Connect connection for Waroo, ideally with a budget, and paste it here. It stays on this phone.`}
      </p>
      <form className="field-stack" onSubmit={connect}>
        <PasteField label={t`Wallet connection`} value={nwc} onChange={setNwc} placeholder="nostr+walletconnect://…" secret />
        <button className="button primary" disabled={!nwc.trim() || busy}>
          {t`Connect`}
        </button>
      </form>
      {hasWebln() && (
        <button type="button" className="button outline" disabled={busy} onClick={browser}>
          {t`Use my browser wallet`}
        </button>
      )}
      <p className="hint" aria-live="polite">
        {note}
      </p>
    </div>
  )
}
