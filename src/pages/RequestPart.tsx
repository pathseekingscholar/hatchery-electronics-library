import { useMemo, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { CheckCircle2, PackagePlus } from 'lucide-react'
import { backend } from '../backend'
import { useCatalog, useCatalogHelpers } from '../hooks/data'
import { search } from '../lib/search'
import { errorMessage } from '../lib/format'
import { Notice } from '../components/ui'
import { StockBadge, sortedStock } from '../components/inventory'

/** Ask for a part the library doesn't have (restock requests for existing parts live on each part page). */
export function RequestPart() {
  const [params] = useSearchParams()
  const [part, setPart] = useState(params.get('part') ?? '')
  const [note, setNote] = useState('')
  const [name, setName] = useState('')
  const [contact, setContact] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<'created' | 'duplicate' | null>(null)
  const { data } = useCatalog()
  const h = useCatalogHelpers(data)

  const matches = useMemo(() => (h && part.trim().length >= 2 ? search(h.index, part).slice(0, 3) : []), [h, part])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const r = await backend.submitPartRequest({ requestedPart: part, note, requesterName: name, requesterContact: contact })
      setResult(r.status)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  if (result) {
    return (
      <div className="card mx-auto max-w-xl p-8 text-center">
        <CheckCircle2 className="mx-auto h-12 w-12 text-ok" aria-hidden />
        <h1 className="mt-3 text-2xl font-bold">{result === 'created' ? 'Request sent' : 'Already requested — we added your +1'}</h1>
        <p className="mt-2 text-ink-2">The electronics team reviews requests regularly. Thanks for helping us stock the right parts.</p>
        <div className="mt-6 flex justify-center gap-2">
          <Link to="/" className="btn btn-primary">Back to search</Link>
          <button
            className="btn btn-secondary"
            onClick={() => {
              setResult(null)
              setPart('')
              setNote('')
            }}
          >
            Request another
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-xl">
      <div className="mb-6 flex items-start gap-4">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-maroon-tint text-maroon">
          <PackagePlus className="h-6 w-6" aria-hidden />
        </span>
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Request a part</h1>
          <p className="mt-1 text-ink-2">Can’t find something? Tell the electronics team what you need.</p>
        </div>
      </div>

      <form onSubmit={submit} className="card space-y-5 p-5 sm:p-6">
        <div>
          <label className="label" htmlFor="rp-part">What part do you need?</label>
          <input id="rp-part" className="field" required minLength={2} maxLength={120} value={part} onChange={(e) => setPart(e.target.value)} placeholder="e.g. Hall effect sensor, 12 V relay module" />
          {matches.length > 0 && h && (
            <div className="mt-3 rounded-xl border border-gold-light bg-gold-tint p-3">
              <p className="text-sm font-semibold text-gold-dark">We might already have it:</p>
              <ul className="mt-2 space-y-1.5">
                {matches.map(({ part: p }) => {
                  const s = sortedStock(p)[0]
                  return (
                    <li key={p.id} className="flex items-center justify-between gap-2 text-sm">
                      <Link to={`/part/${p.id}`} className="font-semibold text-maroon-dark underline-offset-2 hover:underline">
                        {p.name} {p.value} {p.partNumber && <span className="font-mono font-normal text-ink-3">{p.partNumber}</span>}
                      </Link>
                      {s && <StockBadge entry={s} compact />}
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
        </div>
        <div>
          <label className="label" htmlFor="rp-note">What’s it for? <span className="font-normal text-ink-3">(optional)</span></label>
          <textarea id="rp-note" className="field min-h-24" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="A link, a quantity, or the project helps us choose the right part." />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="rp-name">Your name <span className="font-normal text-ink-3">(optional)</span></label>
            <input id="rp-name" className="field" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
          </div>
          <div>
            <label className="label" htmlFor="rp-contact">Email <span className="font-normal text-ink-3">(optional)</span></label>
            <input id="rp-contact" className="field" type="email" maxLength={120} value={contact} onChange={(e) => setContact(e.target.value)} autoComplete="email" />
          </div>
        </div>
        <p className="text-xs text-ink-3">Your name and email are only visible to Hatchery staff.</p>
        {error && <Notice tone="error">{error}</Notice>}
        <button className="btn btn-primary w-full" disabled={busy}>{busy ? 'Sending…' : 'Send request'}</button>
      </form>
    </div>
  )
}
