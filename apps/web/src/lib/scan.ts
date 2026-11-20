/**
 * Reading QR codes from the camera, inside the app.
 *
 * An installed PWA can't rely on the phone's camera app: that opens links in
 * the browser, which on iOS is a separate app with its own storage, so the
 * person would join on the wrong "device". Scanning here keeps them in Footless.
 *
 * The browser's own BarcodeDetector is used where it exists (Android Chrome).
 * Elsewhere, notably iOS Safari, jsQR decodes frames; it's loaded only then.
 */

type Decoder = (source: HTMLVideoElement, canvas: HTMLCanvasElement) => Promise<string | null>

interface NativeDetector {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>
}
interface NativeDetectorClass {
  new (options: { formats: string[] }): NativeDetector
  getSupportedFormats?(): Promise<string[]>
}

export async function makeDecoder(): Promise<Decoder> {
  const Native = (globalThis as { BarcodeDetector?: NativeDetectorClass }).BarcodeDetector
  if (Native) {
    try {
      const formats = (await Native.getSupportedFormats?.()) ?? ['qr_code']
      if (formats.includes('qr_code')) {
        const detector = new Native({ formats: ['qr_code'] })
        return async (video) => (await detector.detect(video))[0]?.rawValue ?? null
      }
    } catch {
      // Fall through to jsQR.
    }
  }
  const { default: jsQR } = await import('jsqr')
  return async (video, canvas) => {
    // Downscale: QR codes on a phone screen decode fine at this size, and it's
    // much faster than full resolution.
    const scale = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight))
    const width = Math.round(video.videoWidth * scale)
    const height = Math.round(video.videoHeight * scale)
    if (!width || !height) return null
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) return null
    context.drawImage(video, 0, 0, width, height)
    const image = context.getImageData(0, 0, width, height)
    return jsQR(image.data, width, height, { inversionAttempts: 'attemptBoth' })?.data ?? null
  }
}

/**
 * Turns scanned or pasted text into an in-app route, or null if it isn't a
 * Footless code: an invite ("#/join?g=…&k=…") or a move from another phone
 * ("#/move-in?t=…"). Accepts the full link or just the part after "#".
 */
export function inviteRoute(text: string): string | null {
  const trimmed = text.trim()
  const match = /#\/(join|move-in)\?/.exec(trimmed)
  if (!match) return null
  const before = trimmed.slice(0, match.index)
  if (before && !/^https?:\/\/[^\s#]+$/i.test(before)) return null
  const route = trimmed.slice(match.index + 1)
  const params = new URLSearchParams(route.split('?')[1])
  if (match[1] === 'join' && !params.get('i') && (!params.get('g') || !params.get('k'))) return null
  if (match[1] === 'move-in' && !params.get('t')) return null
  return route
}

export function cameraProblem(error: unknown): string {
  const name = (error as { name?: string })?.name
  if (name === 'NotAllowedError' || name === 'SecurityError')
    return 'Footless can’t use the camera. Allow camera access for Footless in your phone’s settings, or paste the link below.'
  if (name === 'NotFoundError' || name === 'OverconstrainedError')
    return 'No camera found on this device. Paste the invite link below instead.'
  if (name === 'NotReadableError') return 'The camera is busy in another app. Close it and try again.'
  return 'The camera didn’t start. Paste the invite link below instead.'
}
