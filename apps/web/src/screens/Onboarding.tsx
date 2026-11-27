import { Trans } from '@lingui/react/macro'
import { t } from '@lingui/core/macro'
import { useEffect, useState, type ReactNode } from 'react'
import { Header } from '../components/Header.tsx'
import { Logo } from '../components/icons.tsx'
import { Segmented } from '../components/Segmented.tsx'
import { currentLocale, LANGUAGES, setLanguage, type Locale } from '../lib/i18n.ts'
import {
  canPromptInstall,
  externalBrowserLink,
  finishOnboarding,
  guessPlatform,
  inAppBrowser,
  iosNotSafari,
  isInstalled,
  justInstalled,
  onInstallChange,
  promptInstall,
  savedStep,
  saveStep,
  type Platform,
  type Step,
} from '../lib/install.ts'

/**
 * The first time Waroo opens: pick a language, a word about what it is, and
 * how to put it on the Home Screen. Whatever link brought them here (an
 * invite, a move) opens once they're through.
 */
export function Onboarding({ onDone }: { onDone: () => void }) {
  const installed = isInstalled()
  const [step, setStep] = useState<Step>(() => {
    const saved = savedStep()
    return saved === 'install' && installed ? 'welcome' : saved
  })
  const steps: Step[] = installed ? ['language', 'welcome'] : ['language', 'welcome', 'install']

  function to(next: Step) {
    saveStep(next)
    setStep(next)
    window.scrollTo(0, 0)
  }
  function finish() {
    finishOnboarding()
    onDone()
  }

  return (
    <main className="screen onboarding">
      <div className="onboarding-top">
        <span className="join-brand">
          <Logo size={28} />
          <span>waroo</span>
        </span>
        <ol className="onboarding-dots" aria-label={t`Step ${steps.indexOf(step) + 1} of ${steps.length}`}>
          {steps.map((s) => (
            <li key={s} className={s === step ? 'on' : steps.indexOf(s) < steps.indexOf(step) ? 'past' : ''} />
          ))}
        </ol>
      </div>
      {step === 'language' && <LanguageStep onNext={() => to('welcome')} />}
      {step === 'welcome' && <WelcomeStep onNext={() => (installed ? finish() : to('install'))} last={installed} />}
      {step === 'install' && (
        <section className="onboarding-step">
          <h1>{t`Put Waroo on your Home Screen`}</h1>
          <InstallGuide />
          <div className="onboarding-actions">
            <button className="button outline" onClick={finish}>
              {isInvite() ? t`Continue to the invite in the browser` : t`Continue in the browser`}
            </button>
          </div>
        </section>
      )}
    </main>
  )
}

const isInvite = () => /^#\/(join|move-in)\b/.test(location.hash)

function LanguageStep({ onNext }: { onNext: () => void }) {
  const current = currentLocale()
  function pick(code: Locale) {
    if (code === current) return onNext()
    // Changing language reloads the app; carry on from the next step.
    saveStep('welcome')
    setLanguage(code)
  }
  return (
    <section className="onboarding-step">
      {/* In both languages: whoever's reading may not read the current one. */}
      <h1 lang="en">Choose your language</h1>
      <p className="onboarding-alt" lang="ja">
        言語を選んでください
      </p>
      <div className="language-choices">
        {LANGUAGES.map((l) => (
          <button key={l.code} className={l.code === current ? 'language-choice on' : 'language-choice'} lang={l.code} onClick={() => pick(l.code)}>
            <span>{l.name}</span>
            {l.code === current && <span className="language-check" aria-hidden="true">✓</span>}
          </button>
        ))}
      </div>
      <p className="muted">{t`You can change this later in Settings.`}</p>
    </section>
  )
}

function WelcomeStep({ onNext, last }: { onNext: () => void; last: boolean }) {
  return (
    <section className="onboarding-step">
      <div className="welcome-card">
        <h1>{t`Welcome to Waroo`}</h1>
        <p>
          <Trans>
            A bill-splitting app for trips, flats and dinners. Everyone adds what they paid from their own phone, and Waroo
            works out who owes whom.
          </Trans>
        </p>
        <p>
          <Trans>Connect a digital wallet, and you can settle up with friends instantly, right from the app.</Trans>
        </p>
      </div>
      <ul className="welcome-points">
        <li>{t`No account and no sign-up.`}</li>
        <li>{t`Your groups are end-to-end encrypted: our server passes them along but can’t read them.`}</li>
        <li>{t`Amounts in your own currency.`}</li>
      </ul>
      <div className="onboarding-actions">
        <button className="button primary" onClick={onNext}>
          {last ? t`Get started` : t`Next`}
        </button>
      </div>
    </section>
  )
}

/** Why and how to install, for the platform the person picks. Also on its own screen from Settings. */
export function InstallGuide() {
  const [platform, setPlatform] = useState<Platform>(guessPlatform)
  const [, refresh] = useState(0)
  useEffect(() => onInstallChange(() => refresh((n) => n + 1)), [])
  const inApp = inAppBrowser()

  if (isInstalled()) return <p className="notice">{t`Waroo is already on this phone’s Home Screen.`}</p>

  return (
    <div className="install-guide">
      {inApp && (
        <div className="notice">
          {inApp === 'line' ? (
            <>
              <p>{t`You’re in LINE’s browser, which can’t add apps to your Home Screen.`}</p>
              <a className="button primary" href={externalBrowserLink()}>
                {t`Open in your browser`}
              </a>
            </>
          ) : (
            <p>
              {t`You’re in an app’s own browser, which can’t add apps to your Home Screen. Open its menu (often ⋯ or ⋮) and choose Open in browser, or open getwaroo.app in Safari or Chrome.`}
            </p>
          )}
        </div>
      )}
      <ul className="welcome-points">
        <li>{t`It opens like any app, full screen.`}</li>
        <li>{t`You get notified when friends add expenses or pay you.`}</li>
        <li>{t`Your groups stay put: browsers can clear the data of sites you haven’t opened for a while.`}</li>
      </ul>
      <Segmented
        label={t`Your device`}
        options={[
          { value: 'ios', label: t`iPhone or iPad` },
          { value: 'android', label: t`Android` },
          { value: 'computer', label: t`Computer` },
        ]}
        value={platform}
        onChange={setPlatform}
      />
      {justInstalled() ? (
        <p className="notice" role="status">
          {t`Installed. Open Waroo from your Home Screen to carry on there.`}
        </p>
      ) : (
        <Instructions platform={platform} />
      )}
      {platform === 'ios' && isInvite() && <CopyInvite />}
    </div>
  )
}

function Instructions({ platform }: { platform: Platform }) {
  if (platform !== 'ios' && canPromptInstall()) {
    return (
      <div className="install-now">
        <button className="button primary" onClick={() => void promptInstall()}>
          {t`Install Waroo`}
        </button>
      </div>
    )
  }
  if (platform === 'ios') {
    const where = iosNotSafari() ? t`at the top right, in the address bar` : t`at the bottom of Safari (at the top on iPad)`
    return (
      <Steps>
        <li>
          <Trans>
            Tap the Share button <ShareIcon /> {where}.
          </Trans>
        </li>
        <li>{t`Scroll down and tap “Add to Home Screen”.`}</li>
        <li>{t`Tap “Add”, then open Waroo from your Home Screen.`}</li>
      </Steps>
    )
  }
  if (platform === 'android') {
    return (
      <Steps>
        <li>{t`In Chrome, tap the menu ⋮ at the top right.`}</li>
        <li>{t`Tap “Add to Home screen” or “Install app”.`}</li>
        <li>{t`Tap “Install”, then open Waroo from your Home Screen.`}</li>
      </Steps>
    )
  }
  return (
    <div className="install-computer">
      <p>{t`Waroo is made for phones, but works on a computer too:`}</p>
      <ul className="welcome-points">
        <li>{t`Chrome or Edge: click the install icon at the right of the address bar, or find “Install” in the browser’s menu.`}</li>
        <li>{t`Safari on a Mac: choose File, then Add to Dock.`}</li>
        <li>{t`Firefox can’t install apps, but Waroo works fine in a tab.`}</li>
      </ul>
    </div>
  )
}

const Steps = ({ children }: { children: ReactNode }) => <ol className="install-steps">{children}</ol>

/**
 * On iPhone the Home Screen app doesn't share Safari's storage, so an invite
 * opened here should be joined from there: copy it, paste it in the app.
 */
function CopyInvite() {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(location.href)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }
  return (
    <div className="notice">
      <p>
        {t`On iPhone, the Home Screen app keeps its own data, apart from Safari. To join from there: copy this link, then in the app tap “Join with a QR code” and paste it.`}
      </p>
      <button className="button outline small" onClick={() => void copy()}>
        {copied ? t`Link copied` : t`Copy the link`}
      </button>
    </div>
  )
}

function ShareIcon() {
  return (
    <svg className="inline-icon" viewBox="0 0 24 24" width="18" height="18" aria-label={t`Share`} role="img">
      <path
        d="M12 3v12M7.5 7.5 12 3l4.5 4.5M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** Settings → install: the same guide on its own screen. */
export function InstallScreen() {
  return (
    <main className="screen">
      <Header title={t`Add to Home Screen`} back="/settings" />
      <section className="onboarding-step">
        <InstallGuide />
      </section>
    </main>
  )
}
