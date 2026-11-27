/**
 * Reads a receipt photo on the phone. Nothing leaves it: the photo is
 * shrunk and turned grey in a canvas, then Tesseract (WebAssembly, served
 * from this site) reads the text, and lib/receipt.ts picks out the shop,
 * total and date. The engine loads only when someone first scans, and the
 * browser keeps it for next time.
 */
import { readReceipt, type ReceiptGuess } from './receipt.ts'

/** Long side of the image Tesseract sees: enough for receipt print, small enough to be quick. */
const MAX_SIDE = 2000

async function prepare(file: Blob): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  // Grey, with the contrast stretched: thermal print is often faint.
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const px = image.data
  let lo = 255
  let hi = 0
  for (let i = 0; i < px.length; i += 4) {
    const v = Math.round(0.299 * px[i]! + 0.587 * px[i + 1]! + 0.114 * px[i + 2]!)
    px[i] = v
    if (v < lo) lo = v
    if (v > hi) hi = v
  }
  const range = Math.max(1, hi - lo)
  for (let i = 0; i < px.length; i += 4) {
    const v = Math.round(((px[i]! - lo) * 255) / range)
    px[i] = px[i + 1] = px[i + 2] = v
  }
  ctx.putImageData(image, 0, 0)
  return canvas
}

/** Reads a receipt photo. `onProgress` gets 0–1 while the engine loads and reads. */
export async function scanReceipt(file: Blob, onProgress?: (share: number) => void): Promise<ReceiptGuess & { text: string }> {
  const [{ createWorker }, canvas] = await Promise.all([import('tesseract.js'), prepare(file)])
  const worker = await createWorker(['jpn', 'eng'], 1, {
    workerPath: '/ocr/worker.min.js',
    corePath: '/ocr/',
    langPath: '/ocr',
    // Load the worker script itself, not a blob: copy (the page's security policy allows only this site).
    workerBlobURL: false,
    logger: (m: { status: string; progress: number }) => {
      if (!onProgress) return
      // Loading is the first half the first time; reading is the rest.
      onProgress(m.status === 'recognizing text' ? 0.5 + m.progress / 2 : Math.min(0.5, m.progress / 2))
    },
  })
  try {
    const { data } = await worker.recognize(canvas)
    return { ...readReceipt(data.text), text: data.text }
  } finally {
    await worker.terminate()
  }
}
