import { useRef, useState, type PointerEvent, type ReactNode } from 'react'

/**
 * A list people put in order: drag a card by its handle, or use the small up
 * and down arrows (which also work with a keyboard or screen reader). The X
 * asks before removing. Anything in `after` follows as plain, unranked cards
 * in the same list.
 */
export function RankedList<T extends { id: string }>({
  items,
  label,
  render,
  removeQuestion,
  onChange,
  onRemove,
  after,
}: {
  items: T[]
  /** Short name for a card, for button labels: "Move Coinos up". */
  label: (item: T) => string
  render: (item: T) => ReactNode
  /** "Remove Coinos from paying?" */
  removeQuestion: (item: T) => string
  onChange: (items: T[]) => void
  onRemove: (item: T) => void
  after?: ReactNode
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
    const gap = parseFloat(getComputedStyle(row.parentElement!).rowGap || '0') || 0
    setDrag({ id: item.id, from: index, startY: e.clientY, dy: 0, step: row.offsetHeight + gap })
  }
  const target = drag ? Math.max(0, Math.min(items.length - 1, drag.from + Math.round(drag.dy / drag.step))) : -1

  return (
    <>
      <ul className="wallet-list">
        {items.map((item, index) => {
          const dragging = drag?.id === item.id
          // Cards between where the dragged one started and where it is now slide out of its way.
          let shift = 0
          if (drag && !dragging) {
            if (index > drag.from && index <= target) shift = -drag.step
            if (index < drag.from && index >= target) shift = drag.step
          }
          const asking = confirm === item.id
          return (
            <li
              key={item.id}
              ref={(el) => {
                if (el) rows.current.set(item.id, el)
                else rows.current.delete(item.id)
              }}
              className={`wallet-card ranked-row${dragging ? ' dragging' : ''}`}
              style={{ transform: `translateY(${dragging ? drag.dy : shift}px)` }}
            >
              <div className="ranked-line">
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
                  <svg viewBox="0 0 24 24" width="18" height="18">
                    <path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                  </svg>
                </button>
                <span className="ranked-number" aria-hidden="true">
                  {index + 1}
                </span>
                <span className="ranked-main">{render(item)}</span>
                <span className="ranked-arrows">
                  <button
                    type="button"
                    aria-label={`Move ${label(item)} up`}
                    disabled={index === 0}
                    onClick={() => move(index, index - 1)}
                  >
                    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                      <path d="M6 15l6-6 6 6" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${label(item)} down`}
                    disabled={index === items.length - 1}
                    onClick={() => move(index, index + 1)}
                  >
                    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                      <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                </span>
                <button
                  type="button"
                  className="remove-x"
                  aria-label={`Remove ${label(item)}`}
                  aria-expanded={asking}
                  onClick={() => setConfirm(asking ? undefined : item.id)}
                >
                  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                    <path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
              {asking && (
                <div className="confirm-remove" role="alert">
                  <p>{removeQuestion(item)}</p>
                  <div className="button-row">
                    <button type="button" className="button small outline" onClick={() => setConfirm(undefined)}>
                      Keep it
                    </button>
                    <button
                      type="button"
                      className="button small danger-fill"
                      onClick={() => {
                        setConfirm(undefined)
                        onRemove(item)
                        setAnnounce(`Removed ${label(item)}.`)
                      }}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              )}
            </li>
          )
        })}
        {after}
      </ul>
      <p className="visually-hidden" aria-live="polite">
        {announce}
      </p>
    </>
  )
}
