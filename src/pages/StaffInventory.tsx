import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Plus, Search } from 'lucide-react'
import { backend } from '../backend'
import { useCatalog, useCatalogHelpers } from '../hooks/data'
import { search } from '../lib/search'
import { subtreeIds } from '../lib/locations'
import { errorMessage, relativeDate } from '../lib/format'
import type { Part, StockEntry, StockStatus } from '../lib/types'
import { EmptyState, ErrorState, Notice, SkeletonRows } from '../components/ui'
import { PartThumb, StockBadge } from '../components/inventory'
import { LocationSelect, StatusPicker, getWorkingLocation, setWorkingLocation } from '../components/staff'

export function StaffInventory() {
  const { data, error, isLoading, refetch } = useCatalog()
  const h = useCatalogHelpers(data)
  const [working, setWorking] = useState(getWorkingLocation)
  const [onlyHere, setOnlyHere] = useState(Boolean(getWorkingLocation()))
  const [filter, setFilter] = useState('')
  const [showDrafts, setShowDrafts] = useState(false)

  const parts = useMemo(() => {
    if (!h) return []
    let list: Part[] = filter.trim()
      ? search(h.index, filter).map((x) => x.part)
      : h.catalog.parts.filter((p) => p.reviewStatus !== 'rejected').sort((a, b) => a.name.localeCompare(b.name) || a.value.localeCompare(b.value))
    if (showDrafts) list = list.filter((p) => !p.published)
    if (onlyHere && working) {
      const ids = subtreeIds(working, h.catalog.locations)
      list = list.filter((p) => p.stock.some((s) => ids.has(s.locationId)))
    }
    return list
  }, [h, filter, onlyHere, working, showDrafts])

  if (error) return <ErrorState error={error} onRetry={() => refetch()} />

  const draftCount = h?.catalog.parts.filter((p) => !p.published).length ?? 0

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-bold">Inventory</h1>
        <Link to="/admin/parts/new" className="btn btn-primary"><Plus className="h-5 w-5" aria-hidden /> Add part{working ? ' here' : ''}</Link>
      </div>

      <div className="card mb-4 grid gap-3 p-4 sm:grid-cols-[1fr_1fr]">
        <div>
          <label className="label" htmlFor="working-loc">Working at</label>
          {h && (
            <LocationSelect
              id="working-loc"
              locations={h.catalog.locations}
              value={working}
              placeholder="Anywhere"
              onChange={(v) => {
                setWorking(v)
                setWorkingLocation(v)
                setOnlyHere(Boolean(v))
              }}
            />
          )}
          {working && (
            <label className="mt-2 flex items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4 accent-maroon" checked={onlyHere} onChange={(e) => setOnlyHere(e.target.checked)} />
              Only show parts stocked here (quick audit mode)
            </label>
          )}
        </div>
        <div>
          <label className="label" htmlFor="inv-filter">Find</label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" aria-hidden />
            <input id="inv-filter" type="search" className="field pl-9" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Name, value, part no., drawer" />
          </div>
          {draftCount > 0 && (
            <label className="mt-2 flex items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4 accent-maroon" checked={showDrafts} onChange={(e) => setShowDrafts(e.target.checked)} />
              Drafts only ({draftCount})
            </label>
          )}
        </div>
      </div>

      {isLoading || !h ? (
        <SkeletonRows />
      ) : parts.length === 0 ? (
        <EmptyState title={h.catalog.parts.length ? 'No parts match' : 'No parts yet'}>
          {h.catalog.parts.length ? 'Clear the filters or try another search.' : (
            <>Add one with <Link to="/admin/parts/new" className="font-semibold text-maroon underline">Add part</Link> or import a spreadsheet on the <Link to="/admin/import" className="font-semibold text-maroon underline">CSV</Link> page.</>
          )}
        </EmptyState>
      ) : (
        <>
          <p className="mb-2 text-sm text-ink-2">{parts.length} parts{onlyHere && working && ` in ${h.locById.get(working)?.code}`}</p>
          <ul className="space-y-2">
            {parts.slice(0, 300).map((p) => (
              <InventoryRow key={p.id} part={p} working={onlyHere ? working : ''} />
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

function InventoryRow({ part, working }: { part: Part; working: string }) {
  const { data } = useCatalog()
  const h = useCatalogHelpers(data)!
  const ids = working ? subtreeIds(working, h.catalog.locations) : null
  const here = ids ? part.stock.filter((s) => ids.has(s.locationId)) : []
  return (
    <li className="card p-3">
      <div className="flex items-center gap-3">
        <PartThumb part={part} size={48} />
        <Link to={`/admin/parts/${part.id}`} className="min-w-0 flex-1 hover:underline">
          <p className="truncate font-semibold">
            {part.name} {part.value && <span className="font-semibold">{part.value}</span>}
            {!part.published && <span className="ml-2 rounded bg-label px-1.5 py-0.5 text-xs">Draft</span>}
          </p>
          <p className="truncate text-sm text-ink-2">
            {part.partNumber && <span className="font-mono">{part.partNumber} · </span>}
            {part.stock.length ? part.stock.map((s) => h.locById.get(s.locationId)?.code).join(', ') : 'No location'}
            {part.photos.length === 0 && ' · no photo'}
          </p>
        </Link>
        {!working && part.stock[0] && <span className="hidden sm:block"><StockBadge entry={part.stock[0]} compact /></span>}
      </div>
      {here.map((s) => <QuickStock key={s.id} entry={s} code={h.locById.get(s.locationId)?.code ?? ''} />)}
    </li>
  )
}

/** One-tap status update for audit mode; saves immediately. */
function QuickStock({ entry, code }: { entry: StockEntry; code: string }) {
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [qty, setQty] = useState(entry.quantity === null ? '' : String(entry.quantity))
  const update = async (status: StockStatus, quantity: number | null) => {
    setBusy(true)
    setErr(null)
    try {
      await backend.setStock({ partId: entry.partId, locationId: entry.locationId, quantity, status, lastCheckedAt: new Date().toISOString(), notes: entry.notes })
      await qc.invalidateQueries({ queryKey: ['catalog'] })
    } catch (e) {
      setErr(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="mt-3 border-t border-line pt-3">
      <div className="grid gap-2 sm:grid-cols-[1fr_8rem_auto] sm:items-center">
        <StatusPicker label={`Status at ${code}`} value={entry.status} disabled={busy} onChange={(s) => update(s, s === 'out' && entry.quantity !== null ? 0 : entry.quantity)} />
        <input
          className="field font-mono"
          inputMode="numeric"
          aria-label={`Count at ${code}`}
          placeholder="Not counted"
          value={qty}
          disabled={busy}
          onChange={(e) => setQty(e.target.value.replace(/\D/g, ''))}
          onBlur={() => {
            const next = qty === '' ? null : Number(qty)
            if (next !== entry.quantity) update(entry.status, next)
          }}
        />
        <span className="text-xs text-ink-3">{code} · checked {relativeDate(entry.lastCheckedAt)}</span>
      </div>
      {err && <div className="mt-2"><Notice tone="error">{err}</Notice></div>}
    </div>
  )
}
