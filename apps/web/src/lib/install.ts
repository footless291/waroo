/**
 * Installing Waroo to the Home Screen, and the first-run guide.
 *
 * On iPhone, the Home Screen app keeps its own storage, apart from Safari's:
 * groups joined in Safari stay in Safari. So the guide asks people to
 * install before anything else, and an invite opened in the browser can be
 * copied and pasted into the installed app.
 */

export type Platform = 'ios' | 'android' | 'computer'

/** The browser's install prompt (Chrome, Edge, Samsung Internet), caught as early as possible. */
interface InstallPrompt extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let deferred: InstallPrompt | undefined
let installed = false
const listeners = new Set<() => void>()
const changed = () => listeners.forEach((l) => l())

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault()
  deferred = e as InstallPrompt
  changed()
})
window.addEventListener('appinstalled', () => {
  installed = true
  deferred = undefined
  changed()
})

export function onInstallChange(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** True if this browser offers a one-tap install right now. */
export const canPromptInstall = () => deferred !== undefined
export const justInstalled = () => installed

/** Shows the browser's own install dialog. True if the person installed. */
export async function promptInstall(): Promise<boolean> {
  const prompt = deferred
  if (!prompt) return false
  deferred = undefined
  await prompt.prompt()
  const { outcome } = await prompt.userChoice
  changed()
  return outcome === 'accepted'
}

/** Opened from the Home Screen (or as an installed desktop app). */
export function isInstalled(): boolean {
  return matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true
}

export function guessPlatform(): Platform {
  const ua = navigator.userAgent
  // iPads say they're Macs; a touch screen gives them away.
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ios'
  if (/Android/.test(ua)) return 'android'
  return 'computer'
}

/**
 * Apps that open links in their own browser, which can't install anything:
 * LINE, Instagram, Facebook and friends. LINE can be asked to open a link in
 * the phone's real browser instead.
 */
export function inAppBrowser(): 'line' | 'other' | undefined {
  const ua = navigator.userAgent
  if (/\bLine\//i.test(ua)) return 'line'
  if (/FBAN|FBAV|Instagram|Twitter|MicroMessenger|KAKAOTALK|TikTok|BytedanceWebview/i.test(ua)) return 'other'
  return undefined
}

/** The same page, with LINE's flag to open it in the phone's browser. */
export function externalBrowserLink(): string {
  return `${location.origin}/?openExternalBrowser=1${location.hash}`
}

/** True on iPhone, in a browser other than Safari (Chrome, Firefox, Edge on iOS). */
export const iosNotSafari = () => /CriOS|FxiOS|EdgiOS/.test(navigator.userAgent)

const DONE = 'waroo-onboarded'
const STEP = 'waroo-onboarding-step'

export type Step = 'language' | 'welcome' | 'install'

export function onboarded(): boolean {
  try {
    return localStorage.getItem(DONE) === '1'
  } catch {
    return true
  }
}

export function finishOnboarding() {
  try {
    localStorage.setItem(DONE, '1')
    localStorage.removeItem(STEP)
  } catch {
    // Private browsing: it shows again next time, which is fine.
  }
}

export function savedStep(): Step {
  try {
    const step = localStorage.getItem(STEP)
    return step === 'welcome' || step === 'install' ? step : 'language'
  } catch {
    return 'language'
  }
}

export function saveStep(step: Step) {
  try {
    localStorage.setItem(STEP, step)
  } catch {
    // As above.
  }
}
