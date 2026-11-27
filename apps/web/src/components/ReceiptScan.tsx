import { t } from '@lingui/core/macro'
import { useState } from 'react'
import type { ReceiptGuess } from '../lib/receipt.ts'

/**
 * "Scan a receipt": take a photo (or pick one), read it on the phone, and
 * hand back what was found. The form shows it for checking before saving.
 */
export function ReceiptScan({ onRead }: { onRead: (guess: ReceiptGuess) => string }) {
  const [progress, setProgress] = useState<number>()
  const [note, setNote] = useState('')

  async function read(file: File | undefined) {
    if (!file) return
    setNote('')
    setProgress(0)
    try {
      const { scanReceipt } = await import('../lib/ocr.ts')
      const guess = await scanReceipt(file, setProgress)
      setNote(onRead(guess))
    } catch (err) {
      console.warn('receipt', err)
      setNote(t`Couldn’t read that photo. Try again, or fill it in by hand.`)
    } finally {
      setProgress(undefined)
    }
  }

  const busy = progress !== undefined
  return (
    <div className="receipt-scan">
      <label className={`button outline${busy ? ' disabled' : ''}`} aria-disabled={busy}>
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 2h12v20l-3-2-3 2-3-2-3 2V2M9 7h6M9 11h6M9 15h4" />
        </svg>
        {busy ? t`Reading the receipt…` : t`Scan a receipt`}
        <input
          type="file"
          accept="image/*"
          className="visually-hidden"
          disabled={busy}
          onChange={(e) => {
            void read(e.target.files?.[0])
            e.target.value = ''
          }}
        />
      </label>
      {busy && <progress value={progress} max={1} aria-label={t`Reading the receipt`} />}
      <p className="hint pad" aria-live="polite">
        {busy ? t`Read on this phone. The photo isn’t sent anywhere.` : note}
      </p>
    </div>
  )
}
