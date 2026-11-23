import { locale } from '../lib/hooks.ts'

/** "Nov 23", or "Nov 23, 2025" for another year. */
function shortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(d.getTime())) return iso
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return new Intl.DateTimeFormat(locale(), {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  }).format(d)
}

/**
 * A date that always fits on one line. Phones draw their own date boxes,
 * which can wrap in a narrow column; here the date is shown as plain text
 * and the phone's own picker sits invisibly on top, so tapping it still
 * opens the native picker.
 */
export function DateField({ label, value, onChange }: { label: string; value: string; onChange: (iso: string) => void }) {
  return (
    <label className="field grow date-field">
      <span>{label}</span>
      <span className="date-box">
        <span className="date-text" aria-hidden="true">
          {shortDate(value)}
        </span>
        <svg className="date-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="5" width="18" height="16" rx="3" />
          <path d="M3 10h18M8 3v4M16 3v4" />
        </svg>
        <input
          type="date"
          value={value}
          onChange={(e) => e.target.value && onChange(e.target.value)}
          onClick={(e) => {
            try {
              e.currentTarget.showPicker?.()
            } catch {
              // Some browsers only allow it from certain gestures; the field still works.
            }
          }}
        />
      </span>
    </label>
  )
}
