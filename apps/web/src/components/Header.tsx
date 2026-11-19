import type { ReactNode } from 'react'

export function Header({
  title,
  back,
  action,
}: {
  title: ReactNode
  back?: string
  action?: ReactNode
}) {
  return (
    <header className="header">
      {back ? (
        <a className="icon-button" href={`#${back}`} aria-label="Back">
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
            <path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </a>
      ) : (
        <span className="logo" aria-hidden="true">
          <svg viewBox="0 0 512 512" width="28" height="28">
            <rect width="512" height="512" rx="112" fill="var(--ink)" />
            <path d="M244 132a124 124 0 0 0 0 248z" fill="var(--paper)" />
            <path d="M268 132a124 124 0 0 1 0 248z" fill="var(--accent)" />
          </svg>
        </span>
      )}
      <h1>{title}</h1>
      <div className="header-action">{action}</div>
    </header>
  )
}
