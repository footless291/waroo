import { encode } from 'uqr'

/** A QR code drawn as SVG, dark on white so every camera reads it in either theme. */
export function QrCode({ text, label }: { text: string; label: string }) {
  const { data, size } = encode(text, { border: 2 })
  const cells: string[] = []
  data.forEach((row, y) => row.forEach((dark, x) => dark && cells.push(`M${x} ${y}h1v1h-1z`)))
  return (
    <svg className="qr" viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label}>
      <rect width={size} height={size} fill="#ffffff" />
      <path d={cells.join('')} fill="#16121f" shapeRendering="crispEdges" />
    </svg>
  )
}
