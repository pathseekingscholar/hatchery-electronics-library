import { useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { CheckCircle2 } from 'lucide-react'
import { backend } from '../backend'
import { errorMessage } from '../lib/format'
import type { Location, Part } from '../lib/types'
import { Modal, Notice } from './ui'
import { LocationLabel } from './inventory'

export function RestockDialog({
  part, locationId, locById, open, onClose,
}: { part: Part; locationId: string | null; locById: Map<string, Location>; open: boolean; onClose: () => void }) {
  const [note, setNote] = useState('')
  const [name, setName] = useState('')
  const [contact, setContact] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<'created' | 'duplicate' | null>(null)
  const qc = useQueryClient()

  const close = () => {
    onClose()
    setTimeout(() => {
      setResult(null)
      setError(null)
      setNote('')
    }, 200)
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const r = await backend.submitRestock({ partId: part.id, locationId, note, requesterName: name, requesterContact: contact })
      setResult(r.status)
      qc.invalidateQueries({ queryKey: ['requests'] })
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={close} title="Request restock">
      {result ? (
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-ok" aria-hidden />
            <div>
              <p className="font-semibold">{result === 'created' ? 'Thanks — staff have been notified.' : 'Already on the list — we added your +1.'}</p>
              <p className="mt-1 text-sm text-ink-2">The electronics team checks requests regularly. You don’t need to submit again.</p>
            </div>
          </div>
          <button className="btn btn-primary w-full" onClick={close}>Done</button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <div className="rounded-md border border-line bg-canvas p-3">
            <p className="font-semibold">
              {part.name} {part.value && <span className="font-semibold">{part.value}</span>}
            </p>
            {part.partNumber && <p className="font-mono text-sm text-ink-2">{part.partNumber}</p>}
            {locationId && (
              <div className="mt-2">
                <LocationLabel locationId={locationId} locById={locById} size="sm" />
              </div>
            )}
          </div>
          <div>
            <label className="label" htmlFor="rs-note">What did you find? <span className="font-normal normal-case">(optional)</span></label>
            <textarea id="rs-note" className="field min-h-20" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. bin is empty, only 2 left" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="rs-name">Your name <span className="font-normal normal-case">(optional)</span></label>
              <input id="rs-name" className="field" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
            </div>
            <div>
              <label className="label" htmlFor="rs-contact">Email <span className="font-normal normal-case">(optional)</span></label>
              <input id="rs-contact" className="field" type="email" maxLength={120} value={contact} onChange={(e) => setContact(e.target.value)} autoComplete="email" />
            </div>
          </div>
          <p className="text-xs text-ink-3">Your name and email are only visible to Hatchery staff.</p>
          {error && <Notice tone="error">{error}</Notice>}
          <button className="btn btn-primary w-full" disabled={busy}>{busy ? 'Sending…' : 'Send request'}</button>
        </form>
      )}
    </Modal>
  )
}
