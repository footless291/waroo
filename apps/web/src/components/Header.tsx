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
