import { useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ArrowRightLeft, Eye, EyeOff, Star, Trash2, X } from 'lucide-react'
import { backend } from '../backend'
import { useCatalog, useCatalogHelpers } from '../hooks/data'
import { errorMessage, relativeDate } from '../lib/format'
import type { Part, ProcessedPhoto, StockStatus } from '../lib/types'
import { Modal, Notice, Spinner, ErrorState } from '../components/ui'
import { LocationLabel } from '../components/inventory'
import { LocationSelect, PhotoPicker, StatusPicker, getWorkingLocation, setWorkingLocation } from '../components/staff'
import { AiSuggestPanel, type AcceptedFields } from '../components/AiSuggestPanel'
import { EvidenceStrip } from '../components/EvidencePhoto'

interface StockRow {
  key: string
  locationId: string
  quantity: string
  status: StockStatus
  lastCheckedAt: string | null
  notes: string
  original: boolean
  dirty: boolean
}

interface Pending {
  photo: ProcessedPhoto
  publish: boolean
}

// Hand-off when staff choose "Update this part" from a photo suggestion on another screen.
let handoff: { partId: string; photo: ProcessedPhoto; fields: AcceptedFields } | null = null

function mergeFields<T extends { name: string; categoryId: string; description: string; partNumber: string; aliases: string }>(prev: T, f: AcceptedFields): T {
  return {
    ...prev,
    ...(f.name ? { name: f.name } : {}),
    ...(f.categoryId ? { categoryId: f.categoryId } : {}),
    ...(f.description ? { description: f.description } : {}),
    ...(f.partNumber ? { partNumber: f.partNumber } : {}),
    ...(f.aliases ? { aliases: [prev.aliases, ...f.aliases].filter(Boolean).join(', ') } : {}),
  }
}

/** Take the hand-off once, if it targets this part. */
function takeHandoff(partId: string | undefined) {
  if (!handoff || !partId || handoff.partId !== partId) return null
  const h = handoff
  handoff = null
  return h
}

const emptyForm = {
  name: '', value: '', partNumber: '', categoryId: '', manufacturer: '', package: '', aliases: '',
  description: '', datasheetUrl: '', published: true,
}

export function PartEditor() {
  const { id } = useParams()
  const isNew = !id
  const { data, error, isLoading, refetch } = useCatalog()
  const h = useCatalogHelpers(data)
  const part = id ? h?.catalog.parts.find((p) => p.id === id) : undefined
  const [version, setVersion] = useState(0)
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />
  if (isLoading || !h) return <Spinner className="py-10" />
  if (id && !part) return <Notice tone="error">Part not found. <Link to="/admin/inventory" className="underline">Back to inventory</Link></Notice>
  return <EditorForm key={`${id ?? 'new'}-${version}`} part={part} isNew={isNew} onReload={() => setVersion((v) => v + 1)} />
}

function EditorForm({ part, isNew, onReload }: { part?: Part; isNew: boolean; onReload: () => void }) {
  const { data } = useCatalog()
  const h = useCatalogHelpers(data)!
  const navigate = useNavigate()
  const qc = useQueryClient()

  const [incoming] = useState(() => takeHandoff(part?.id))
  const [form, setForm] = useState(() => {
    const base = part
      ? {
          name: part.name, value: part.value, partNumber: part.partNumber, categoryId: part.categoryId ?? '',
          manufacturer: part.manufacturer, package: part.package, aliases: part.aliases.join(', '),
          description: part.description, datasheetUrl: part.datasheetUrl, published: part.published,
        }
      : emptyForm
    return incoming ? mergeFields(base, incoming.fields) : base
  })
  const [working, setWorking] = useState(getWorkingLocation)
  const [rows, setRows] = useState<StockRow[]>(() =>
    part
      ? part.stock.map((s) => ({
          key: s.id, locationId: s.locationId, quantity: s.quantity === null ? '' : String(s.quantity), status: s.status,
          lastCheckedAt: s.lastCheckedAt, notes: s.notes, original: true, dirty: false,
        }))
      : working && h.locById.has(working)
        ? [{ key: 'new-0', locationId: working, quantity: '', status: 'in_stock', lastCheckedAt: new Date().toISOString(), notes: '', original: false, dirty: true }]
        : [],
  )
  const [removed, setRemoved] = useState<string[]>([])
  const [pending, setPending] = useState<Pending[]>(() => (incoming ? [{ photo: incoming.photo, publish: true }] : []))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const [moveRow, setMoveRow] = useState<StockRow | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const applyFields = (f: AcceptedFields) => setForm((prev) => mergeFields(prev, f))

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }))
  const updateRow = (key: string, patch: Partial<StockRow>, touchChecked = true) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch, dirty: true, ...(touchChecked ? { lastCheckedAt: new Date().toISOString() } : {}) } : r)))

  const usedLocations = rows.map((r) => r.locationId)
  const latestPhoto = pending[pending.length - 1]

  const save = async (e: FormEvent | null, addAnother = false) => {
    e?.preventDefault()
    setErr(null)
    setSaved(null)
    if (!form.name.trim()) return setErr('Name is required.')
    if (form.datasheetUrl && !/^https?:\/\//i.test(form.datasheetUrl)) return setErr('Datasheet link must start with http:// or https://')
    for (const r of rows) {
      if (!r.locationId) return setErr('Pick a location for every stock row, or remove the empty row.')
      if (r.quantity && !/^\d+$/.test(r.quantity)) return setErr('Counts must be whole numbers. Leave blank for uncounted bulk parts.')
    }
    if (new Set(usedLocations).size !== usedLocations.length) return setErr('The same location is listed twice.')
    setBusy(true)
    try {
      const savedPart = await backend.savePart({
        id: part?.id,
        name: form.name.trim(), value: form.value.trim(), partNumber: form.partNumber.trim(),
        categoryId: form.categoryId || null, manufacturer: form.manufacturer.trim(), package: form.package.trim(),
        aliases: form.aliases.split(',').map((a) => a.trim()).filter(Boolean),
        description: form.description.trim(), datasheetUrl: form.datasheetUrl.trim(), published: form.published,
      })
      for (const locationId of removed) await backend.removeStock(savedPart.id, locationId)
      for (const r of rows.filter((x) => x.dirty)) {
        await backend.setStock({
          partId: savedPart.id, locationId: r.locationId, quantity: r.quantity === '' ? null : Number(r.quantity),
          status: r.status, lastCheckedAt: r.lastCheckedAt, notes: r.notes.trim(),
        })
      }
      for (const p of pending) await backend.addPartPhoto(savedPart.id, p.photo, p.publish)
      await qc.invalidateQueries({ queryKey: ['catalog'] })
      if (addAnother) {
        setSaved(`Saved “${form.name}${form.value ? ' ' + form.value : ''}”. Ready for the next part.`)
        setForm({ ...emptyForm, categoryId: form.categoryId, published: form.published })
        setPending([])
        setRows(working ? [{ key: `new-${crypto.randomUUID()}`, locationId: working, quantity: '', status: 'in_stock', lastCheckedAt: new Date().toISOString(), notes: '', original: false, dirty: true }] : [])
        window.scrollTo({ top: 0 })
      } else {
        navigate(`/part/${savedPart.id}`)
      }
    } catch (e2) {
      setErr(errorMessage(e2))
    } finally {
      setBusy(false)
    }
  }

  const deletePart = async () => {
    if (!part) return
    setBusy(true)
    try {
      await backend.deletePart(part.id)
      await qc.invalidateQueries({ queryKey: ['catalog'] })
      navigate('/admin/inventory')
    } catch (e) {
      setErr(errorMessage(e))
      setBusy(false)
    }
  }

  const photoAction = async (fn: () => Promise<void>) => {
    try {
      await fn()
      await qc.invalidateQueries({ queryKey: ['catalog'] })
    } catch (e) {
      setErr(errorMessage(e))
    }
  }

  const sortedCats = useMemo(() => [...h.catalog.categories].sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name)), [h])

  return (
    <form onSubmit={(e) => save(e)} className="mx-auto max-w-3xl pb-24">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <Link to="/admin/inventory" className="btn btn-ghost btn-sm -ml-3"><ArrowLeft className="h-4 w-4" aria-hidden /> Inventory</Link>
        {part && <Link to={`/part/${part.id}`} className="text-sm font-semibold text-maroon underline">View public page</Link>}
      </div>
      <h1 className="mb-4 text-2xl font-bold">{isNew ? 'Add a part' : `Edit ${part!.name} ${part!.value}`}</h1>

      {part?.evidence && (
        <section className="card mb-4 space-y-2 p-4" aria-label="Photo evidence">
          <p className="text-sm">
            <span className="font-semibold">{part.reviewStatus === 'verified' ? 'Staff verified' : part.reviewStatus === 'rejected' ? 'Rejected' : 'Needs review (from photos)'}</span>
            <span className="text-ink-3"> · {part.evidence.confidence} confidence · {part.evidence.draftId}</span>
          </p>
          {part.evidence.labelText && <p className="text-sm text-ink-2">Label in photo: “{part.evidence.labelText}”</p>}
          <EvidenceStrip files={part.evidence.photos} size={64} />
          {part.reviewReasons.length > 0 && <p className="text-xs text-low">{part.reviewReasons.join(' · ')}</p>}
          <p className="text-xs text-ink-3">Edits here update the catalog right away and are logged. Use Inventory review to mark it staff verified.</p>
        </section>
      )}

      {isNew && (
        <div className="card mb-4 p-4">
          <label className="label" htmlFor="working">Working at (stays selected for the next part)</label>
          <LocationSelect
            id="working"
            locations={h.catalog.locations}
            value={working}
            onChange={(v) => {
              setWorking(v)
              setWorkingLocation(v)
              setRows((rs) => {
                const fresh = rs.filter((r) => r.original || r.locationId !== working)
                return v && !fresh.some((r) => r.locationId === v)
                  ? [{ key: `new-${crypto.randomUUID()}`, locationId: v, quantity: '', status: 'in_stock', lastCheckedAt: new Date().toISOString(), notes: '', original: false, dirty: true }, ...fresh]
                  : fresh
              })
            }}
            placeholder="No working location"
          />
        </div>
      )}

      {saved && <div className="mb-4"><Notice tone="ok">{saved}</Notice></div>}

      {/* Photos */}
      <section className="card mb-4 space-y-3 p-4" aria-labelledby="photos-h">
        <h2 id="photos-h" className="font-semibold">Photos</h2>
        {part && part.photos.length > 0 && (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {part.photos.map((ph) => (
              <li key={ph.id} className="overflow-hidden rounded-md border border-line">
                <img src={ph.thumbUrl} alt="" className="aspect-square w-full bg-label object-cover" />
                <div className="space-y-1 p-2 text-xs">
                  <p className="font-semibold">{ph.published ? 'Public' : 'Draft (staff only)'}{ph.isPrimary && ' · Main'}</p>
                  <div className="flex flex-wrap gap-1">
                    <button type="button" className="btn btn-ghost btn-sm !min-h-8 !px-2" onClick={() => photoAction(() => backend.updatePartPhoto(ph, { published: !ph.published }))} aria-label={ph.published ? 'Make photo staff-only' : 'Approve photo for public catalog'}>
                      {ph.published ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                    {!ph.isPrimary && (
                      <button type="button" className="btn btn-ghost btn-sm !min-h-8 !px-2" onClick={() => photoAction(() => backend.updatePartPhoto(ph, { isPrimary: true }))} aria-label="Use as main photo">
                        <Star className="h-4 w-4" />
                      </button>
                    )}
                    <button type="button" className="btn btn-ghost btn-sm !min-h-8 !px-2 text-out" onClick={() => confirm('Delete this photo?') && photoAction(() => backend.deletePartPhoto(ph))} aria-label="Delete photo">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
        {pending.length > 0 && (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {pending.map((p, i) => (
              <li key={p.photo.previewUrl} className="overflow-hidden rounded-md border-2 border-dashed border-line-strong">
                <img src={p.photo.previewUrl} alt="New photo, not yet saved" className="aspect-square w-full bg-label object-cover" />
                <div className="flex items-center justify-between gap-1 p-2 text-xs">
                  <label className="flex items-center gap-1.5">
                    <input type="checkbox" className="h-4 w-4 accent-maroon" checked={p.publish} onChange={(e) => setPending((ps) => ps.map((x, j) => (j === i ? { ...x, publish: e.target.checked } : x)))} />
                    Public
                  </label>
                  <button type="button" className="btn btn-ghost btn-sm !min-h-8 !px-2" onClick={() => setPending((ps) => ps.filter((_, j) => j !== i))} aria-label="Remove new photo">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <PhotoPicker onPhoto={(photo) => setPending((ps) => [...ps, { photo, publish: true }])} />
        <p className="text-xs text-ink-3">Photos are resized and location data is removed before upload. Untick “Public” to keep a photo staff-only.</p>
        {latestPhoto && (
          <AiSuggestPanel
            key={latestPhoto.photo.previewUrl}
            aiDataUrl={latestPhoto.photo.aiDataUrl}
            categories={sortedCats}
            index={h.index}
            currentPartId={part?.id}
            onApply={applyFields}
            onUseExisting={(target, fields) => {
              handoff = { partId: target.id, photo: latestPhoto.photo, fields }
              navigate(`/admin/parts/${target.id}`)
            }}
          />
        )}
      </section>

      {/* Details */}
      <section className="card mb-4 grid gap-4 p-4 sm:grid-cols-2" aria-labelledby="details-h">
        <h2 id="details-h" className="font-semibold sm:col-span-2">Details</h2>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="f-name">Name *</label>
          <input id="f-name" className="field" required maxLength={120} value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Resistor, Arduino Nano" />
        </div>
        <div>
          <label className="label" htmlFor="f-value">Value / key spec</label>
          <input id="f-value" className="field font-mono" value={form.value} onChange={(e) => set('value', e.target.value)} placeholder="220 Ω, 100 µF 25 V" />
        </div>
        <div>
          <label className="label" htmlFor="f-pn">Part number</label>
          <input id="f-pn" className="field font-mono" value={form.partNumber} onChange={(e) => set('partNumber', e.target.value)} placeholder="NE555P" />
        </div>
        <div>
          <label className="label" htmlFor="f-cat">Category</label>
          <select id="f-cat" className="field" value={form.categoryId} onChange={(e) => set('categoryId', e.target.value)}>
            <option value="">Uncategorized</option>
            {sortedCats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="f-pkg">Package</label>
          <input id="f-pkg" className="field" value={form.package} onChange={(e) => set('package', e.target.value)} placeholder="DIP-8, 1/4 W through-hole" />
        </div>
        <div>
          <label className="label" htmlFor="f-mfr">Manufacturer</label>
          <input id="f-mfr" className="field" value={form.manufacturer} onChange={(e) => set('manufacturer', e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="f-alias">Other names (comma separated)</label>
          <input id="f-alias" className="field" value={form.aliases} onChange={(e) => set('aliases', e.target.value)} placeholder="220R, red red brown" />
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="f-desc">Short description</label>
          <textarea id="f-desc" className="field min-h-20" value={form.description} onChange={(e) => set('description', e.target.value)} />
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="f-ds">Datasheet link</label>
          <input id="f-ds" className="field" type="url" value={form.datasheetUrl} onChange={(e) => set('datasheetUrl', e.target.value)} placeholder="https://…" />
        </div>
        <label className="flex items-center gap-3 sm:col-span-2">
          <input type="checkbox" className="h-5 w-5 accent-maroon" checked={form.published} onChange={(e) => set('published', e.target.checked)} />
          <span><strong>Show in student catalog</strong> <span className="text-sm text-ink-2">— untick to keep this part as a staff-only draft</span></span>
        </label>
      </section>

      {/* Stock */}
      <section className="card mb-4 space-y-3 p-4" aria-labelledby="stock-h">
        <div className="flex items-center justify-between gap-2">
          <h2 id="stock-h" className="font-semibold">Where it’s stocked</h2>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setRows((rs) => [...rs, { key: `new-${crypto.randomUUID()}`, locationId: '', quantity: '', status: 'unverified', lastCheckedAt: null, notes: '', original: false, dirty: true }])}
          >
            Add location
          </button>
        </div>
        {rows.length === 0 && <p className="text-sm text-ink-3">No locations yet. Students won’t know where to look.</p>}
        {rows.map((r) => (
          <div key={r.key} className="rounded-md border border-line p-3">
            <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
              {r.original ? (
                <LocationLabel locationId={r.locationId} locById={h.locById} size="sm" />
              ) : (
                <div className="w-full sm:max-w-sm">
                  <label className="label" htmlFor={`loc-${r.key}`}>Location</label>
                  <LocationSelect id={`loc-${r.key}`} locations={h.catalog.locations} value={r.locationId} onChange={(v) => updateRow(r.key, { locationId: v }, false)} exclude={usedLocations.filter((x) => x !== r.locationId)} />
                </div>
              )}
              <div className="flex gap-1">
                {r.original && (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMoveRow(r)}>
                    <ArrowRightLeft className="h-4 w-4" aria-hidden /> Move
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-ghost btn-sm text-out"
                  onClick={() => {
                    if (r.original) setRemoved((x) => [...x, r.locationId])
                    setRows((rs) => rs.filter((x) => x.key !== r.key))
                  }}
                  aria-label="Remove this location"
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                </button>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-[1fr_9rem]">
              <div>
                <p className="label">Status</p>
                <StatusPicker label="Stock status" value={r.status} onChange={(s) => updateRow(r.key, { status: s, ...(s === 'out' && r.quantity ? { quantity: '0' } : {}) })} />
              </div>
              <div>
                <label className="label" htmlFor={`qty-${r.key}`}>Count</label>
                <input
                  id={`qty-${r.key}`}
                  className="field font-mono"
                  inputMode="numeric"
                  pattern="\d*"
                  value={r.quantity}
                  placeholder="Not counted"
                  onChange={(e) => {
                    const q = e.target.value.replace(/[^\d]/g, '')
                    updateRow(r.key, { quantity: q, ...(q === '0' ? { status: 'out' as const } : q && (r.status === 'out' || r.status === 'unverified') ? { status: 'in_stock' as const } : {}) })
                  }}
                />
              </div>
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-ink-3">
              <span>Last checked {relativeDate(r.lastCheckedAt)}{r.dirty && ' (on save)'}</span>
              <button type="button" className="font-semibold text-maroon underline" onClick={() => updateRow(r.key, {})}>Mark checked now</button>
            </div>
            <input className="field mt-2 text-sm" placeholder="Note for this location (optional)" maxLength={300} value={r.notes} onChange={(e) => updateRow(r.key, { notes: e.target.value }, false)} aria-label="Location note" />
          </div>
        ))}
        <p className="text-xs text-ink-3">Leave Count blank for bulk parts nobody counts — students then see the status, never a made-up number.</p>
      </section>

      {err && <div className="mb-4"><Notice tone="error">{err}</Notice></div>}

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-canvas/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-2">
          <button className="btn btn-primary flex-1 sm:flex-none" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
          {isNew && (
            <button type="button" className="btn btn-secondary flex-1 sm:flex-none" disabled={busy} onClick={() => save(null, true)}>
              Save & add another{working ? ' here' : ''}
            </button>
          )}
          {part && (
            <button type="button" className="btn btn-ghost ml-auto text-out" onClick={() => setConfirmDelete(true)}>Delete part</button>
          )}
        </div>
      </div>

      {moveRow && part && (
        <MoveDialog part={part} row={moveRow} onClose={() => setMoveRow(null)} onDone={() => { setMoveRow(null); onReload() }} />
      )}
      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Delete this part?">
        <p className="text-ink-2">This removes the part, its stock records, photos, and restock requests. It can’t be undone.</p>
        <div className="mt-4 flex gap-2">
          <button type="button" className="btn btn-primary" onClick={deletePart} disabled={busy}>Delete</button>
          <button type="button" className="btn btn-secondary" onClick={() => setConfirmDelete(false)}>Cancel</button>
        </div>
      </Modal>
    </form>
  )
}

function MoveDialog({ part, row, onClose, onDone }: { part: Part; row: StockRow; onClose: () => void; onDone: () => void }) {
  const { data } = useCatalog()
  const h = useCatalogHelpers(data)!
  const qc = useQueryClient()
  const [to, setTo] = useState('')
  const [qty, setQty] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const counted = row.quantity !== '' && !row.dirty
  const submit = async () => {
    setBusy(true)
    setErr(null)
    try {
      await backend.moveStock(part.id, row.locationId, to, counted && qty ? Number(qty) : null)
      await qc.invalidateQueries({ queryKey: ['catalog'] })
      onDone()
    } catch (e) {
      setErr(errorMessage(e))
      setBusy(false)
    }
  }
  return (
    <Modal open onClose={onClose} title="Move stock">
      <div className="space-y-4">
        <div>
          <p className="label">From</p>
          <LocationLabel locationId={row.locationId} locById={h.locById} size="sm" />
        </div>
        <div>
          <label className="label" htmlFor="move-to">To</label>
          <LocationSelect id="move-to" locations={h.catalog.locations} value={to} onChange={setTo} exclude={[row.locationId]} />
        </div>
        {counted ? (
          <div>
            <label className="label" htmlFor="move-qty">How many? (blank = all {row.quantity})</label>
            <input id="move-qty" className="field font-mono" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value.replace(/\D/g, ''))} />
          </div>
        ) : (
          <p className="text-sm text-ink-2">This location isn’t counted, so the whole entry moves.</p>
        )}
        {row.dirty && <Notice tone="warn">Save your other changes first if you edited this row.</Notice>}
        {err && <Notice tone="error">{err}</Notice>}
        <button type="button" className="btn btn-primary w-full" disabled={!to || busy} onClick={submit}>{busy ? 'Moving…' : 'Move'}</button>
      </div>
    </Modal>
  )
}
