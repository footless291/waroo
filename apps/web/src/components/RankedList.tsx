import { useRef, useState, type ReactNode, type PointerEvent } from 'react'

/**
 * A list people put in order: drag a row by its handle, or use the up and
 * down buttons (which also work with a keyboard or screen reader). Removing
 * takes two taps.
 */
export function RankedList<T extends { id: string }>({
  items,
  label,
  render,
  onChange,
  onRemove,
}: {
  items: T[]
  /** Short name for a row, for button labels: "Move Coinos up". */
  label: (item: T) => string
  render: (item: T, index: number) => ReactNode
  onChange: (items: T[]) => void
  onRemove: (item: T) => void
}) {
  const [drag, setDrag] = useState<{ id: string; from: number; startY: number; dy: number; step: number }>()
  const [confirm, setConfirm] = useState<string>()
  const [announce, setAnnounce] = useState('')
  const rows = useRef(new Map<string, HTMLLIElement>())

  function move(from: number, to: number) {
    if (to < 0 || to >= items.length || from === to) return
    const next = [...items]
    const [item] = next.splice(from, 1)
    next.splice(to, 0, item!)
    onChange(next)
    setAnnounce(`${label(item!)} is now number ${to + 1} of ${items.length}.`)
  }

  function start(e: PointerEvent<HTMLButtonElement>, item: T, index: number) {
    const row = rows.current.get(item.id)
    if (!row) return
    e.currentTarget.setPointerCapture(e.pointerId)
    // Rows are the same height, so one row's height plus the gap is a step.
    const gap = parseFloat(getComputedStyle(row.parentElement!).rowGap || '0') || 0
    setDrag({ id: item.id, from: index, startY: e.clientY, dy: 0, step: row.offsetHeight + gap })
  }
  const target = drag ? Math.max(0, Math.min(items.length - 1, drag.from + Math.round(drag.dy / drag.step))) : -1

  return (
    <>
      <ol className="ranked">
        {items.map((item, index) => {
          const dragging = drag?.id === item.id
          // Rows between where the dragged one started and where it is now slide out of its way.
          let shift = 0
          if (drag && !dragging) {
            if (index > drag.from && index <= target) shift = -drag.step
            if (index < drag.from && index >= target) shift = drag.step
          }
          return (
            <li
              key={item.id}
              ref={(el) => {
                if (el) rows.current.set(item.id, el)
                else rows.current.delete(item.id)
              }}
              className={`ranked-row${dragging ? ' dragging' : ''}`}
              style={{ transform: `translateY(${dragging ? drag.dy : shift}px)` }}
            >
              <button
                type="button"
                className="drag-handle"
                aria-hidden="true"
                tabIndex={-1}
                onPointerDown={(e) => start(e, item, index)}
                onPointerMove={(e) => drag && setDrag({ ...drag, dy: e.clientY - drag.startY })}
                onPointerUp={() => {
                  if (drag) move(drag.from, target)
                  setDrag(undefined)
                }}
                onPointerCancel={() => setDrag(undefined)}
              >
                <svg viewBox="0 0 24 24" width="20" height="20">
                  <path d="M8 6h.01M16 6h.01M8 12h.01M16 12h.01M8 18h.01M16 18h.01" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                </svg>
              </button>
              <span className="ranked-number" aria-hidden="true">
                {index + 1}
              </span>
              <span className="ranked-main">{render(item, index)}</span>
              <span className="ranked-actions">
                <button
                  type="button"
                  className="icon-button small"
                  aria-label={`Move ${label(item)} up`}
                  disabled={index === 0}
                  onClick={() => move(index, index - 1)}
                >
                  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                    <path d="M6 15l6-6 6 6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                <button
                  type="button"
                  className="icon-button small"
                  aria-label={`Move ${label(item)} down`}
                  disabled={index === items.length - 1}
                  onClick={() => move(index, index + 1)}
                >
                  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                    <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                <button
                  type="button"
                  className="link remove"
                  aria-label={confirm === item.id ? `Tap again to remove ${label(item)}` : `Remove ${label(item)}`}
                  onClick={() => {
                    if (confirm === item.id) {
                      setConfirm(undefined)
                      onRemove(item)
                      setAnnounce(`Removed ${label(item)}.`)
                    } else setConfirm(item.id)
                  }}
                >
                  {confirm === item.id ? 'Sure?' : 'Remove'}
                </button>
              </span>
            </li>
          )
        })}
      </ol>
      <p className="visually-hidden" aria-live="polite">
        {announce}
      </p>
    </>
  )
}
