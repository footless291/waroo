export function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  )
}

export function Logo({ size = 32 }: { size?: number }) {
  return (
    <svg viewBox="0 0 512 512" width={size} height={size} aria-hidden="true">
      <rect width="512" height="512" rx="140" fill="#2a1f38" />
      <path d="M244 132a124 124 0 0 0 0 248z" fill="#fff5ee" />
      <path d="M268 132a124 124 0 0 1 0 248z" fill="#ffb38a" />
    </svg>
  )
}
