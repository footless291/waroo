import { useEffect, useRef, type ReactNode } from 'react'
import { Logo } from './icons.tsx'

let firstScreen = true

export function Header({
  title,
  back,
  action,
  inPager,
}: {
  title: ReactNode
  back?: string
  action?: ReactNode
  /** On a swipeable page: the pager moves focus here when the page is shown, not on mount. */
  inPager?: boolean
}) {
  // Move focus to the new screen's heading so screen readers announce it and
  // keyboard users start from the top, as they would on a page load.
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    // Not on the very first screen: there the browser's own page-load
    // announcement already does this job.
    if (firstScreen) firstScreen = false
    else if (!inPager) heading.current?.focus({ preventScroll: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <header className="header">
      {back ? (
        <a className="icon-button" href={`#${back}`} aria-label="Back">
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
            <path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </a>
      ) : (
        <span className="logo">
          <Logo size={34} />
        </span>
      )}
      <h1 ref={heading} tabIndex={-1} data-page-title>
        {title}
      </h1>
      <div className="header-action">{action}</div>
    </header>
  )
}

/**
 * A swipeable page's name, for screen readers only: the header above the
 * pages stays the same, so this is what's announced when a page is shown.
 */
export function PageTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="visually-hidden" tabIndex={-1} data-page-title>
      {children}
    </h2>
  )
}

/** The header shared by Groups, Activity and Settings: name, logo, and the scanner. */
export function AppHeader() {
  return (
    <Header
      title="Footless"
      action={
        <a className="icon-button" href="#/scan" aria-label="Scan a code">
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" />
            <path d="M8 12h8" />
          </svg>
        </a>
      }
    />
  )
}
