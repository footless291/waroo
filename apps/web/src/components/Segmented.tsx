import { useId } from 'react'

/**
 * A row of mutually exclusive options, built on native radio inputs so
 * keyboards (arrow keys, one tab stop) and screen readers get the standard
 * radio-group behaviour for free.
 */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: { value: T; label: string }[]
  value: T
  onChange: (value: T) => void
}) {
  const name = useId()
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <label key={o.value}>
          <input
            type="radio"
            name={name}
            value={o.value}
            checked={value === o.value}
            onChange={() => onChange(o.value)}
          />
          <span>{o.label}</span>
        </label>
      ))}
    </div>
  )
}
