import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle, Camera, Check, CheckCircle2, ChevronRight, ClipboardCheck, ExternalLink, FileUp, GitMerge,
  Lightbulb, Pencil, Search, Upload, X,
} from 'lucide-react'
import clsx from 'clsx'
import { backend, isDemo } from '../backend'
import { useCatalog, useCatalogHelpers, type CatalogHelpers } from '../hooks/data'
import { childrenOf, locationPath, subtreeIds } from '../lib/locations'
import { ITEM_TYPE_LABEL, partsIn, progressOf, type ReviewProgress } from '../lib/review'
import { search } from '../lib/search'
import { errorMessage, relativeDate } from '../lib/format'
import type { Confidence, ItemType, Location, Part, PhotoDraft, StockEntry, StockStatus } from '../lib/types'
import { EmptyState, ErrorState, Modal, Notice, Spinner } from '../components/ui'
import { LocationLabel, ReviewBadge, StockBadge } from '../components/inventory'
import { LocationSelect, StatusPicker } from '../components/staff'
import { EvidenceStrip } from '../components/EvidencePhoto'

// ------------------------------------------------------------------ shared bits

function ProgressBar({ p, className }: { p: ReviewProgress; className?: string }) {
  const pct = (n: number) => (p.total ? (n / p.total) * 100 : 0)
  return (
    <div className={clsx('space-y-1', className)}>
      <div
        className="flex h-2.5 overflow-hidden rounded-full bg-label"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={p.total}
        aria-valuenow={p.verified + p.rejected}
        aria-label="Review progress"
      >
        <span className="bg-ok" style={{ width: `${pct(p.verified)}%` }} />
        <span className="bg-line-strong" style={{ width: `${pct(p.rejected)}%` }} />
      </div>
      <p className="text-xs text-ink-3">
        {p.total === 0 ? 'Nothing proposed here' : (
          <>
            <strong className="text-ink">{p.verified + p.rejected}</strong> of {p.total} checked
            {p.needsReview > 0 && <> · {p.needsReview} need review</>}
            {p.rejected > 0 && <> · {p.rejected} rejected</>}
          </>
        )}
      </p>
    </div>
  )
}

const CONF: Record<Confidence, string> = {
  high: 'bg-ok-bg text-ok',
  medium: 'bg-low-bg text-low',
  low: 'bg-out-bg text-out',
}
function ConfidenceBadge({ c }: { c: Confidence }) {
  return <span className={clsx('rounded-md px-1.5 py-0.5 text-[0.7rem] font-bold uppercase tracking-wide', CONF[c])}>{c} confidence</span>
}

function ReviewedBadge({ loc }: { loc: Location }) {
  if (!loc.reviewedAt) return null
  return (
    <span className="inline-flex items-center gap-1 rounded-lg bg-ok-bg px-2 py-0.5 text-xs font-semibold text-ok">
      <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Checked {relativeDate(loc.reviewedAt)}
      {loc.reviewedByName && <> by {loc.reviewedByName}</>}
    </span>
  )
}

// ------------------------------------------------------------------ overview

export function AdminReview() {
  const { data, error, isLoading, refetch } = useCatalog()
  const h = useCatalogHelpers(data)
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />
  if (isLoading || !h) return <Spinner className="py-10" />

  const hasDraft = h.catalog.parts.some((p) => p.evidence)
  const all = progressOf(h.catalog.parts.filter((p) => p.evidence && !p.mergedInto))
  const roots = childrenOf(null, h.catalog.locations)
  const top = roots.length === 1 ? childrenOf(roots[0].id, h.catalog.locations) : roots

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-5 flex items-start gap-4">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-maroon-tint text-maroon">
          <ClipboardCheck className="h-6 w-6" aria-hidden />
        </span>
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Inventory review</h1>
          <p className="mt-1 text-ink-2">The catalog is already live from the drawer photos, with every record marked Needs review. Walk each drawer to verify, correct, merge or reject records.</p>
        </div>
      </div>

      <DraftLoader hasDraft={hasDraft} />

      {hasDraft && (
        <>
          <section className="card mb-6 p-5">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="eyebrow">Physically verified</p>
                <p className="text-3xl font-extrabold tracking-tight">{Math.round(all.done * 100)}%</p>
              </div>
              <dl className="flex gap-5 text-sm">
                <div><dt className="text-ink-3">Needs review</dt><dd className="text-lg font-bold text-low">{all.needsReview}</dd></div>
                <div><dt className="text-ink-3">With a concern</dt><dd className="text-lg font-bold">{all.flagged}</dd></div>
                <div><dt className="text-ink-3">Verified</dt><dd className="text-lg font-bold text-ok">{all.verified}</dd></div>
                <div><dt className="text-ink-3">Rejected</dt><dd className="text-lg font-bold text-ink-2">{all.rejected}</dd></div>
              </dl>
            </div>
            <ProgressBar p={all} className="mt-3" />
          </section>

          <div className="space-y-4">
            {top.map((zone) => <ZoneCard key={zone.id} zone={zone} h={h} />)}
          </div>
        </>
      )}
    </div>
  )
}

function ZoneCard({ zone, h }: { zone: Location; h: CatalogHelpers }) {
  const kids = childrenOf(zone.id, h.catalog.locations)
  const p = progressOf(partsIn(zone.id, h.catalog))
  return (
    <section className="card overflow-hidden" aria-labelledby={`zone-${zone.id}`}>
      <Link to={`/admin/review/${zone.id}`} className="flex flex-wrap items-center gap-4 p-4 hover:bg-gold-tint/50">
        <span className="drawer-label px-3 py-1 font-mono text-lg font-bold">{zone.code}</span>
        <span className="min-w-0 flex-1">
          <span id={`zone-${zone.id}`} className="block font-bold">{zone.name}</span>
          <ProgressBar p={p} className="mt-1.5 max-w-sm" />
        </span>
        <ChevronRight className="h-5 w-5 text-ink-3" aria-hidden />
      </Link>
      {kids.length > 0 && (
        <ul className="divide-y divide-line border-t border-line">
          {kids.map((d) => <DrawerRow key={d.id} loc={d} h={h} />)}
        </ul>
      )}
    </section>
  )
}

function DrawerRow({ loc, h }: { loc: Location; h: CatalogHelpers }) {
  const p = progressOf(partsIn(loc.id, h.catalog))
  const ev = h.catalog.locationEvidence?.[loc.id]
  const ops = ev?.opportunities.length ?? 0
  return (
    <li>
      <Link to={`/admin/review/${loc.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-gold-tint/50">
        <span className="w-20 shrink-0 font-mono text-sm font-bold text-maroon-dark">{loc.code}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{loc.name}</span>
          <span className="mt-1 flex flex-wrap items-center gap-2">
            <span className="w-32"><ProgressBar p={p} /></span>
            <ReviewedBadge loc={loc} />
            {ops > 0 && (
              <span className="inline-flex items-center gap-1 text-xs text-gold-dark"><Lightbulb className="h-3.5 w-3.5" aria-hidden />{ops} note{ops > 1 ? 's' : ''}</span>
            )}
          </span>
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-ink-3" aria-hidden />
      </Link>
    </li>
  )
}

function DraftLoader({ hasDraft }: { hasDraft: boolean }) {
  const qc = useQueryClient()
  const [draft, setDraft] = useState<PhotoDraft | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [open, setOpen] = useState(!hasDraft)

  const fromProject = async () => {
    setErr(null)
    setBusy(true)
    const d = await backend.fetchBundledDraft()
    setBusy(false)
    if (!d) setErr('The draft file isn’t served here (only the local dev server serves it). Choose inventory/inventory-draft.json instead.')
    else setDraft(d)
  }
  const fromFile = async (file: File | undefined) => {
    if (!file) return
    setErr(null)
    try {
      const d = JSON.parse(await file.text()) as PhotoDraft
      if (!Array.isArray(d.items) || !Array.isArray(d.locations)) throw new Error('bad')
      setDraft(d)
    } catch {
      setErr('That isn’t an inventory-draft.json file.')
    }
  }
  const importIt = async () => {
    if (!draft) return
    setBusy(true)
    setErr(null)
    try {
      const r = await backend.importPhotoDraft(draft)
      await qc.invalidateQueries({ queryKey: ['catalog'] })
      setDone(`Added ${r.locations} new locations and ${r.parts} new records (${r.deduplicated} folded into existing records, ${r.already_present} already present). New records are live as Needs review.`)
      setDraft(null)
      setOpen(false)
    } catch (e) {
      setErr(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        {done ? <Notice tone="ok">{done}</Notice> : <span />}
        <button className="btn btn-ghost btn-sm" onClick={() => setOpen(true)}><Upload className="h-4 w-4" aria-hidden /> Load an updated draft</button>
      </div>
    )
  }

  return (
    <section className="card mb-6 p-5">
      <h2 className="font-bold">{hasDraft ? 'Load an updated photo draft' : 'Load the photo inventory draft'}</h2>
      <p className="mt-1 text-sm text-ink-2">
        Adds the locations and proposed records from <code>inventory/inventory-draft.json</code> as <strong>drafts</strong>. Nothing becomes public. Re-loading only adds new records; anything already reviewed is left alone.
      </p>
      {isDemo && !hasDraft && (
        <div className="mt-3"><Notice tone="warn">In this local preview, loading the draft replaces the made-up demo parts and drawers with the Hatchery layout from the photos.</Notice></div>
      )}
      {draft ? (
        <div className="mt-4 rounded-xl border border-line bg-canvas p-4">
          <p className="font-semibold">Photo snapshot {draft.snapshot}</p>
          <p className="text-sm text-ink-2">{draft.locations.length} locations · {draft.items.length} proposed records</p>
          <p className="mt-2 text-xs text-ink-3">{draft.notice}</p>
          <div className="mt-3 flex gap-2">
            <button className="btn btn-primary" disabled={busy} onClick={importIt}>{busy ? 'Loading…' : 'Load as drafts'}</button>
            <button className="btn btn-ghost" onClick={() => setDraft(null)}>Cancel</button>
          </div>
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap gap-2">
          <button className="btn btn-primary" disabled={busy} onClick={fromProject}><Upload className="h-4 w-4" aria-hidden /> Use this project’s draft</button>
          <label className="btn btn-secondary">
            <FileUp className="h-4 w-4" aria-hidden /> Choose file…
            <input type="file" accept="application/json,.json" className="sr-only" onChange={(e) => { fromFile(e.target.files?.[0]); e.target.value = '' }} />
          </label>
          {hasDraft && <button className="btn btn-ghost" onClick={() => setOpen(false)}>Close</button>}
        </div>
      )}
      {err && <div className="mt-3"><Notice tone="error">{err}</Notice></div>}
    </section>
  )
}

// ------------------------------------------------------------------ one location

type Tab = 'needs_review' | 'verified' | 'rejected'
const TAB_LABEL: Record<Tab, string> = { needs_review: 'Needs review', verified: 'Verified', rejected: 'Rejected' }

export function ReviewLocation() {
  const { id } = useParams()
  const { data, error, isLoading, refetch } = useCatalog()
  const h = useCatalogHelpers(data)
  const [tab, setTab] = useState<Tab | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const qc = useQueryClient()

  if (error) return <ErrorState error={error} onRetry={() => refetch()} />
  if (isLoading || !h) return <Spinner className="py-10" />
  const loc = id ? h.locById.get(id) : undefined
  if (!loc) return <EmptyState title="Location not found"><Link to="/admin/review" className="text-maroon underline">Back to review</Link></EmptyState>

  const path = locationPath(loc.id, h.locById)
  const ev = h.catalog.locationEvidence?.[loc.id]
  const parts = partsIn(loc.id, h.catalog)
  const p = progressOf(parts)
  const counts: Record<Tab, number> = { needs_review: p.needsReview, verified: p.verified, rejected: p.rejected }
  const activeTab: Tab = tab ?? (counts.needs_review ? 'needs_review' : 'verified')
  const list = parts
    .filter((x) => x.reviewStatus === activeTab)
    // records with a specific concern first
    .sort((a, b) => Number(b.reviewReasons.length > 0) - Number(a.reviewReasons.length > 0))
    .sort((a, b) => (a.evidence?.draftId ?? a.name).localeCompare(b.evidence?.draftId ?? b.name, undefined, { numeric: true }))
  const kids = childrenOf(loc.id, h.catalog.locations)

  const markReviewed = async () => {
    setBusy(true)
    setErr(null)
    try {
      await backend.markLocationReviewed(loc.id)
      await qc.invalidateQueries({ queryKey: ['catalog'] })
    } catch (e) {
      setErr(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-3xl pb-10">
      <nav aria-label="Breadcrumb" className="mb-3 flex flex-wrap items-center gap-1 text-sm text-ink-2">
        <Link to="/admin/review" className="hover:underline">Review</Link>
        {path.slice(1).map((l) => (
          <span key={l.id} className="flex items-center gap-1">
            <ChevronRight className="h-4 w-4 text-ink-3" aria-hidden />
            {l.id === loc.id ? <span aria-current="page" className="font-semibold text-ink">{l.code}</span> : <Link to={`/admin/review/${l.id}`} className="hover:underline">{l.code}</Link>}
          </span>
        ))}
      </nav>

      <header className="card mb-4 space-y-3 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <LocationLabel locationId={loc.id} locById={h.locById} size="lg" />
          <Link to={`/locations/${loc.id}`} className="btn btn-ghost btn-sm"><ExternalLink className="h-4 w-4" aria-hidden /> Student view</Link>
        </div>
        {ev?.frontLabel && <p className="text-sm"><span className="text-ink-3">Front label:</span> <strong>{ev.frontLabel}</strong></p>}
        {ev?.observedState && (
          <p className={clsx('text-sm', /NEEDS CONFIRMATION|not seen|closed in every/i.test(ev.observedState) ? 'font-semibold text-out' : 'text-ink-2')}>
            {/NEEDS CONFIRMATION|not seen|closed in every/i.test(ev.observedState) && <AlertTriangle className="mr-1 inline h-4 w-4" aria-hidden />}
            {ev.observedState}
          </p>
        )}
        {ev && ev.photos.length > 0 && (
          <div>
            <p className="eyebrow mb-1.5 flex items-center gap-1.5"><Camera className="h-3.5 w-3.5" aria-hidden /> Photos of this location</p>
            <EvidenceStrip files={ev.photos} size={96} />
          </div>
        )}
        <ProgressBar p={p} />
        <div className="flex flex-wrap items-center gap-3 border-t border-line pt-3">
          <button className="btn btn-primary" disabled={busy} onClick={markReviewed}>
            <ClipboardCheck className="h-4 w-4" aria-hidden /> {loc.reviewedAt ? 'Mark checked again' : `Mark ${loc.kind.toLowerCase()} checked`}
          </button>
          {loc.reviewedAt ? <ReviewedBadge loc={loc} /> : <span className="text-sm text-ink-3">Not checked yet</span>}
          {p.draft > 0 && !loc.reviewedAt && <span className="text-xs text-ink-3">{p.draft} records still to decide — you can mark it checked anyway.</span>}
        </div>
        {err && <Notice tone="error">{err}</Notice>}
      </header>

      {ev && ev.opportunities.length > 0 && (
        <section className="card mb-4 p-4" aria-labelledby="ops-h">
          <h2 id="ops-h" className="mb-2 flex items-center gap-2 font-semibold"><Lightbulb className="h-4 w-4 text-gold-dark" aria-hidden /> Storage notes from the photos</h2>
          <ul className="space-y-2">
            {ev.opportunities.map((o) => (
              <li key={o.id} className="rounded-xl bg-gold-tint/60 p-3 text-sm">
                <p>{o.description}</p>
                <p className="mt-1 text-xs text-ink-3">{o.state}{o.needsConfirmation && ' · needs a look'} · {o.photos.map((f) => f.replace('.HEIC', '')).join(', ')}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {kids.length > 0 && (
        <section className="mb-4" aria-label="Inside">
          <p className="eyebrow mb-2">Inside {loc.code}</p>
          <ul className="flex flex-wrap gap-2">
            {kids.map((k) => {
              const kp = progressOf(partsIn(k.id, h.catalog))
              return (
                <li key={k.id}>
                  <Link to={`/admin/review/${k.id}`} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-line bg-surface px-3 text-sm hover:border-gold-light hover:bg-gold-tint">
                    <span className="font-mono font-bold text-maroon-dark">{k.code.replace(`${loc.code}-`, '')}</span>
                    <span className="max-w-40 truncate text-ink-2">{k.name}</span>
                    {kp.draft > 0 ? <span className="rounded-full bg-low-bg px-1.5 text-xs font-bold text-low">{kp.draft}</span> : kp.total > 0 ? <Check className="h-4 w-4 text-ok" aria-label="all reviewed" /> : null}
                  </Link>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      <div role="tablist" aria-label="Records" className="mb-4 flex gap-1 rounded-2xl bg-label/70 p-1">
        {(['needs_review', 'verified', 'rejected'] as Tab[]).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={activeTab === t}
            onClick={() => setTab(t)}
            className={clsx('min-h-10 flex-1 rounded-xl px-1.5 text-xs font-semibold sm:text-sm', activeTab === t ? 'bg-surface text-ink shadow-sm' : 'text-ink-2 hover:text-ink')}
          >
            {TAB_LABEL[t]} <span className="text-ink-3">{counts[t]}</span>
          </button>
        ))}
      </div>

      {list.length === 0 ? (
        <EmptyState title={activeTab === 'verified' || activeTab === 'rejected' ? 'Nothing here yet' : 'Nothing left in this list'} icon={<CheckCircle2 className="h-8 w-8" />}>
          {activeTab !== 'rejected' && (
            <>Found something in the drawer that isn’t listed? <Link to="/admin/parts/new" className="font-semibold text-maroon underline">Add it</Link> (set this location as your working location first).</>
          )}
        </EmptyState>
      ) : (
        <ul className="space-y-3" role="tabpanel">
          {list.map((part) => <ReviewCard key={part.id} part={part} here={loc} h={h} />)}
        </ul>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ one record

const TYPES: ItemType[] = ['component', 'module', 'assortment', 'kit', 'tool', 'consumable', 'equipment', 'container']

function ReviewCard({ part, here, h }: { part: Part; here: Location; h: CatalogHelpers }) {
  const qc = useQueryClient()
  const ids = useMemo(() => subtreeIds(here.id, h.catalog.locations), [here.id, h.catalog.locations])
  const entry: StockEntry | undefined = part.stock.find((s) => ids.has(s.locationId))
  const ev = part.evidence
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(part.name)
  const [categoryId, setCategoryId] = useState(part.categoryId ?? '')
  const [itemType, setItemType] = useState<ItemType>(part.itemType)
  const [partNumber, setPartNumber] = useState(part.partNumber)
  const [locationId, setLocationId] = useState(entry?.locationId ?? '')
  const [status, setStatus] = useState<StockStatus>(entry?.status ?? 'unverified')
  const [qty, setQty] = useState(entry?.quantity === null || entry?.quantity === undefined ? '' : String(entry.quantity))
  const [stockTouched, setStockTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [merging, setMerging] = useState(false)

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setErr(null)
    try {
      await fn()
      await qc.invalidateQueries({ queryKey: ['catalog'] })
    } catch (e) {
      setErr(errorMessage(e))
      setBusy(false)
    }
  }

  /** Save a correction immediately without verifying (the catalog updates right away; edits are audited). */
  const saveCorrection = () =>
    run(async () => {
      if (!name.trim()) throw new Error('Name can’t be empty.')
      await backend.savePart({
        id: part.id, name: name.trim(), categoryId: categoryId || null, value: part.value, partNumber: partNumber.trim(),
        manufacturer: part.manufacturer, package: part.package, aliases: part.aliases, description: part.description,
        datasheetUrl: part.datasheetUrl, published: part.published, itemType, reviewStatus: part.reviewStatus,
      })
      if (entry && locationId && locationId !== entry.locationId) await backend.moveStock(part.id, entry.locationId, locationId, null)
      setEditing(false)
    })

  /** Save any edits, then set the review decision. */
  const decide = (decision: 'verified' | 'rejected', publish = false) =>
    run(async () => {
      if (!name.trim()) throw new Error('Name can’t be empty.')
      const edited = name !== part.name || categoryId !== (part.categoryId ?? '') || itemType !== part.itemType || partNumber !== part.partNumber
      if (decision === 'verified' && edited) {
        await backend.savePart({
          id: part.id, name: name.trim(), categoryId: categoryId || null, value: part.value, partNumber: partNumber.trim(),
          manufacturer: part.manufacturer, package: part.package, aliases: part.aliases, description: part.description,
          datasheetUrl: part.datasheetUrl, published: part.published, itemType, reviewStatus: part.reviewStatus,
        })
      }
      if (decision === 'verified' && entry) {
        if (locationId && locationId !== entry.locationId) await backend.moveStock(part.id, entry.locationId, locationId, null)
        if (stockTouched) {
          if (qty && !/^\d+$/.test(qty)) throw new Error('Count must be a whole number, or blank if not counted.')
          await backend.setStock({
            partId: part.id, locationId: locationId || entry.locationId, quantity: qty === '' ? null : Number(qty), status,
            lastCheckedAt: new Date().toISOString(), notes: entry.notes,
          })
        }
      }
      await backend.setReviewStatus(part.id, decision, publish)
    })

  const decided = part.reviewStatus === 'verified' || part.reviewStatus === 'rejected'

  return (
    <li className={clsx('card p-4', part.reviewStatus === 'rejected' && 'opacity-75')}>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {ev && <ConfidenceBadge c={ev.confidence} />}
        <span className="rounded-md bg-label px-1.5 py-0.5 font-semibold text-ink-2">{ITEM_TYPE_LABEL[part.itemType]}</span>
        {ev?.isAssortment && <span className="rounded-md bg-label px-1.5 py-0.5 font-semibold text-ink-2">Assortment</span>}
        {ev?.contentsUnknown && <span className="rounded-md bg-out-bg px-1.5 py-0.5 font-semibold text-out">Contents not seen</span>}
        <ReviewBadge status={part.reviewStatus} compact />
        {part.reviewStatus !== 'rejected' && (
          <span className={clsx('rounded-md px-1.5 py-0.5 font-semibold', part.published ? 'bg-ok-bg text-ok' : 'bg-label text-ink-2')}>
            {part.published ? 'In catalog' : 'Hidden from students'}
          </span>
        )}
        {ev && <span className="ml-auto font-mono text-ink-3">{ev.draftId}</span>}
      </div>

      {editing && !decided ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="label" htmlFor={`n-${part.id}`}>Name</label>
            <input id={`n-${part.id}`} className="field" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
          </div>
          <div>
            <label className="label" htmlFor={`c-${part.id}`}>Category</label>
            <select id={`c-${part.id}`} className="field" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">Uncategorized</option>
              {h.catalog.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor={`t-${part.id}`}>Kind of item</label>
            <select id={`t-${part.id}`} className="field" value={itemType} onChange={(e) => setItemType(e.target.value as ItemType)}>
              {TYPES.map((t) => <option key={t} value={t}>{ITEM_TYPE_LABEL[t]}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor={`pn-${part.id}`}>Part number</label>
            <input id={`pn-${part.id}`} className="field font-mono" value={partNumber} onChange={(e) => setPartNumber(e.target.value)} placeholder="Only if printed on it" />
          </div>
          {entry && (
            <div>
              <label className="label" htmlFor={`l-${part.id}`}>Location</label>
              <LocationSelect id={`l-${part.id}`} locations={h.catalog.locations} value={locationId} onChange={setLocationId} />
            </div>
          )}
        </div>
      ) : (
        <div className="mt-2">
          <p className="text-lg font-semibold leading-snug">{part.name}</p>
          <p className="text-sm text-ink-3">
            {h.catById.get(part.categoryId ?? '') ?? 'Uncategorized'}
            {part.manufacturer && <> · {part.manufacturer}</>}
            {part.partNumber && <> · <span className="font-mono">{part.partNumber}</span></>}
          </p>
        </div>
      )}

      <div className="mt-3 space-y-1.5 text-sm">
        {entry && !editing && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-lg bg-gold-tint px-2 py-0.5 font-mono font-bold text-maroon-dark">{h.locById.get(entry.locationId)?.code}</span>
            <StockBadge entry={entry} compact />
            {entry.notes && <span className="text-ink-3">{entry.notes}</span>}
          </div>
        )}
        {ev?.labelText && <p><span className="text-ink-3">Label in photo:</span> “{ev.labelText}”</p>}
        {part.description && <p className="text-ink-2">{part.description}</p>}
        {(ev?.visibleQty || ev?.qtyNote) && (
          <p className="text-ink-3">
            Seen in photo: {ev.visibleQty ? <strong className="text-ink">{ev.visibleQty}</strong> : null}{ev.visibleQty && ev.qtyNote ? ' — ' : ''}{ev.qtyNote}
            <span className="ml-1 text-xs">(not a stock count)</span>
          </p>
        )}
        {ev?.possibleDuplicateOf && (
          <p className="text-low"><GitMerge className="mr-1 inline h-4 w-4" aria-hidden />Possibly the same product as <span className="font-mono">{ev.possibleDuplicateOf}</span> — merge or keep both locations.</p>
        )}
        {part.reviewReasons.length > 0 && part.reviewStatus !== 'verified' && (
          <p className="text-low"><AlertTriangle className="mr-1 inline h-4 w-4" aria-hidden />{part.reviewReasons.join(' · ')}</p>
        )}
        {part.verifiedAt && <p className="text-xs text-ink-3">Verified {relativeDate(part.verifiedAt)}{part.verifiedByName && <> by {part.verifiedByName}</>}</p>}
      </div>

      {ev && ev.photos.length > 0 && <div className="mt-3"><EvidenceStrip files={ev.photos} size={64} /></div>}

      {!decided && entry && (
        <div className="mt-3 rounded-xl border border-line p-3">
          <p className="label">Stock in the drawer right now</p>
          <div className="grid gap-2 sm:grid-cols-[1fr_8rem]">
            <StatusPicker label="Stock status" value={status} onChange={(s) => { setStatus(s); setStockTouched(true) }} />
            <input
              className="field font-mono"
              inputMode="numeric"
              aria-label="Count"
              placeholder="Not counted"
              value={qty}
              onChange={(e) => {
                const v = e.target.value.replace(/\D/g, '')
                setQty(v)
                setStockTouched(true)
                if (v === '0') setStatus('out')
                else if (v && (status === 'out' || status === 'unverified')) setStatus('in_stock')
              }}
            />
          </div>
          <p className="mt-1 text-xs text-ink-3">Leave blank for bulk items. Unchanged = stays “Unverified”.</p>
        </div>
      )}

      {err && <div className="mt-3"><Notice tone="error">{err}</Notice></div>}

      <div className="mt-4 flex flex-wrap gap-2">
        {!decided ? (
          <>
            <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => decide('verified', true)}><Check className="h-4 w-4" aria-hidden /> Verify — checked in drawer</button>
            <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setEditing((e) => !e)}><Pencil className="h-4 w-4" aria-hidden /> {editing ? 'Done editing' : 'Correct'}</button>
            {editing && <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => saveCorrection()}>Save correction</button>}
            <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setMerging(true)}><GitMerge className="h-4 w-4" aria-hidden /> Merge…</button>
            <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => run(() => backend.setReviewStatus(part.id, part.reviewStatus, !part.published))}>
              {part.published ? 'Hide' : 'Show in catalog'}
            </button>
            <button className="btn btn-ghost btn-sm ml-auto text-out" disabled={busy} onClick={() => decide('rejected')}><X className="h-4 w-4" aria-hidden /> Not there / wrong</button>
          </>
        ) : part.reviewStatus === 'verified' ? (
          <>
            <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => run(() => backend.setReviewStatus(part.id, 'verified', !part.published))}>
              {part.published ? 'Hide from students' : 'Show in catalog'}
            </button>
            <Link to={`/admin/parts/${part.id}`} className="btn btn-ghost btn-sm"><Pencil className="h-4 w-4" aria-hidden /> Full editor</Link>
            <button className="btn btn-ghost btn-sm ml-auto" disabled={busy} onClick={() => run(() => backend.setReviewStatus(part.id, 'needs_review'))}>Un-verify</button>
          </>
        ) : (
          <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => run(() => backend.setReviewStatus(part.id, 'needs_review', true))}>Undo reject</button>
        )}
      </div>

      {merging && <MergeDialog part={part} h={h} onClose={() => setMerging(false)} />}
    </li>
  )
}

function MergeDialog({ part, h, onClose }: { part: Part; h: CatalogHelpers; onClose: () => void }) {
  const qc = useQueryClient()
  const suggested = part.evidence?.possibleDuplicateOf
    ? h.catalog.parts.find((p) => p.evidence?.draftId === part.evidence?.possibleDuplicateOf)
    : undefined
  const [q, setQ] = useState('')
  const [target, setTarget] = useState<Part | null>(suggested && !suggested.mergedInto ? suggested : null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const results = useMemo(
    () => (q.trim() ? search(h.index, q).map((x) => x.part) : []).filter((p) => p.id !== part.id && p.reviewStatus !== 'rejected').slice(0, 8),
    [q, h.index, part.id],
  )
  const merge = async () => {
    if (!target) return
    setBusy(true)
    setErr(null)
    try {
      await backend.mergeParts(part.id, target.id)
      await qc.invalidateQueries({ queryKey: ['catalog'] })
      onClose()
    } catch (e) {
      setErr(errorMessage(e))
      setBusy(false)
    }
  }
  const where = (p: Part) => p.stock.map((s) => h.locById.get(s.locationId)?.code).filter(Boolean).join(', ')
  return (
    <Modal open onClose={onClose} title="Merge duplicate">
      <p className="text-sm text-ink-2">
        <strong className="text-ink">{part.name}</strong> will be folded into the record you pick. Its locations and photos move over, and this copy is marked rejected.
      </p>
      <div className="relative mt-4">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" aria-hidden />
        <input className="field pl-9" placeholder="Find the record to keep" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find the record to keep" autoFocus />
      </div>
      <ul className="mt-3 max-h-64 space-y-1.5 overflow-y-auto">
        {(results.length ? results : suggested && !suggested.mergedInto ? [suggested] : []).map((p) => (
          <li key={p.id}>
            <button
              type="button"
              onClick={() => setTarget(p)}
              aria-pressed={target?.id === p.id}
              className={clsx('w-full rounded-xl border px-3 py-2 text-left text-sm', target?.id === p.id ? 'border-maroon bg-maroon-tint' : 'border-line hover:bg-gold-tint')}
            >
              <span className="font-semibold">{p.name}</span> <span className="text-ink-3">· {where(p) || 'no location'} · {p.reviewStatus}</span>
            </button>
          </li>
        ))}
      </ul>
      {err && <div className="mt-3"><Notice tone="error">{err}</Notice></div>}
      <button className="btn btn-primary mt-4 w-full" disabled={!target || busy} onClick={merge}>
        {busy ? 'Merging…' : target ? `Merge into “${target.name}”` : 'Pick a record'}
      </button>
    </Modal>
  )
}
