import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react'
import { go } from '../lib/hooks.ts'

export interface Page {
  path: string
  content: ReactNode
}

/**
 * Tab pages side by side, moved by the finger. The browser does the
 * dragging, momentum and snapping (CSS scroll snap), so it feels like a
 * native app; this only keeps the address in step: tapping a tab scrolls to
 * its page, and landing on a page by swiping makes it the current tab.
 *
 * Each page scrolls up and down on its own. Pages you aren't on are inert,
 * so keyboards and screen readers stay on the one you see.
 */
export function Pager({
  pages,
  current,
  onChange = go,
  inline,
  label,
}: {
  pages: Page[]
  current: string
  /** Called with a page's path when someone swipes to it. Defaults to going there. */
  onChange?: (path: string) => void
  /** Inside a page (not the whole screen): as tall as the page shown, no scrolling of its own. */
  inline?: boolean
  label?: string
}) {
  const strip = useRef<HTMLDivElement>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const index = Math.max(0, pages.findIndex((p) => p.path === current))
  const currentRef = useRef(current)
  currentRef.current = current
  const shown = useRef(false)

  // Tab tapped (or address changed): go to that page.
  useLayoutEffect(() => {
    const el = strip.current
    if (!el) return
    const left = index * el.clientWidth
    if (Math.abs(el.scrollLeft - left) > 2) {
      const smooth = shown.current && !matchMedia('(prefers-reduced-motion: reduce)').matches
      el.scrollTo({ left, behavior: smooth ? 'smooth' : 'auto' })
    }
    if (shown.current && !inline) {
      // Like a new screen: start screen readers and keyboards at its title.
      el.children[index]?.querySelector<HTMLElement>('[data-page-title]')?.focus({ preventScroll: true })
    }
    shown.current = true
  }, [index])

  // Swiped to a page: make it the current tab once it settles.
  useEffect(() => {
    const el = strip.current
    if (!el) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const settled = () => {
      const page = pages[Math.round(el.scrollLeft / el.clientWidth)]
      if (page && page.path !== currentRef.current) onChangeRef.current(page.path)
    }
    const onScroll = () => {
      clearTimeout(timer)
      timer = setTimeout(settled, 140)
    }
    const hasScrollEnd = 'onscrollend' in window
    el.addEventListener(hasScrollEnd ? 'scrollend' : 'scroll', hasScrollEnd ? settled : onScroll)
    // Keep the current page lined up when the screen turns or resizes.
    const onResize = () => {
      const i = pages.findIndex((p) => p.path === currentRef.current)
      el.scrollTo({ left: Math.max(0, i) * el.clientWidth })
    }
    addEventListener('resize', onResize)
    return () => {
      clearTimeout(timer)
      el.removeEventListener(hasScrollEnd ? 'scrollend' : 'scroll', hasScrollEnd ? settled : onScroll)
      removeEventListener('resize', onResize)
    }
  }, [pages])

  // Inline: the strip is as tall as the page being shown, following it as it changes.
  useLayoutEffect(() => {
    const el = strip.current
    if (!inline || !el) return
    const page = el.children[index] as HTMLElement | undefined
    if (!page) return
    const fit = () => {
      el.style.height = `${page.offsetHeight}px`
    }
    fit()
    const watch = new ResizeObserver(fit)
    watch.observe(page)
    return () => watch.disconnect()
  }, [index, inline])

  return (
    <div className={`pager${inline ? ' inline' : ''}`} ref={strip} aria-label={label} role={label ? 'region' : undefined}>
      {pages.map((page, i) => (
        <div key={page.path} className="pager-page" inert={i !== index} aria-hidden={i !== index || undefined}>
          {page.content}
        </div>
      ))}
    </div>
  )
}
