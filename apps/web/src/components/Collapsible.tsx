import { useId, useRef, useState, type ReactNode } from 'react'

/**
 * A settings section that opens and closes. Closing a long one could leave
 * the screen showing whatever came after it, so the section's title is
 * scrolled back into view.
 */
export function Collapsible({
  title,
  className = '',
  defaultOpen = false,
  children,
}: {
  title: string
  className?: string
  defaultOpen?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  const section = useRef<HTMLElement>(null)
  const body = useId()
  return (
    <section ref={section} className={`settings-card collapsible ${open ? 'open' : ''} ${className}`}>
      <h2>
        <button
          type="button"
          className="collapsible-toggle"
          aria-expanded={open}
          aria-controls={body}
          onClick={() => {
            const closing = open
            setOpen(!open)
            if (closing) {
              requestAnimationFrame(() => {
                const el = section.current
                if (!el) return
                // The top of what's visible: the page's own top when it scrolls under a fixed
                // header, otherwise the bottom of the screen's header.
                const page = el.closest('.pager-page')
                const top = page
                  ? page.getBoundingClientRect().top
                  : (document.querySelector('.header')?.getBoundingClientRect().bottom ?? 0)
                if (el.getBoundingClientRect().top < top) {
                  const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches
                  el.scrollIntoView({ block: 'start', behavior: smooth ? 'smooth' : 'auto' })
                }
              })
            }
          }}
        >
          {title}
          <svg className="collapsible-chevron" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
            <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </h2>
      {open && (
        <div id={body} className="collapsible-body">
          {children}
        </div>
      )}
    </section>
  )
}
