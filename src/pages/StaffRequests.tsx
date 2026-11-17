import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Inbox } from 'lucide-react'
import clsx from 'clsx'
import { backend } from '../backend'
import { useCatalog, useCatalogHelpers, useRequests } from '../hooks/data'
import { errorMessage, relativeDate } from '../lib/format'
import type { RequestStatus, RestockRequest } from '../lib/types'
import { EmptyState, ErrorState, Modal, Notice, SkeletonRows } from '../components/ui'
import { LocationLabel, StockBadge } from '../components/inventory'

const TABS: Array<{ key: 'open' | 'acknowledged' | 'closed'; label: string }> = [
  { key: 'open', label: 'New' },
  { key: 'acknowledged', label: 'Acknowledged' },
  { key: 'closed', label: 'Resolved' },
]

export function StaffRequests() {
  const { data: requests, error, isLoading, refetch } = useRequests(true)
  const { data } = useCatalog()
  const h = useCatalogHelpers(data)
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('open')
  const [resolving, setResolving] = useState<RestockRequest | null>(null)

  const inTab = (r: RestockRequest) => (tab === 'closed' ? r.status === 'resolved' || r.status === 'dismissed' : r.status === tab)
  const list = (requests ?? []).filter(inTab)
  const count = (k: string) => (requests ?? []).filter((r) => (k === 'closed' ? r.status === 'resolved' || r.status === 'dismissed' : r.status === k)).length

  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold">Restock requests</h1>
      <div role="tablist" aria-label="Request status" className="mb-4 flex gap-1 border-b border-line">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={clsx('relative min-h-11 px-3 font-semibold', tab === t.key ? 'text-ink after:absolute after:inset-x-2 after:-bottom-px after:h-[3px] after:bg-maroon' : 'text-ink-2 hover:text-ink')}
          >
            {t.label} <span className="font-mono text-sm text-ink-3">{count(t.key)}</span>
          </button>
        ))}
      </div>

      {error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : isLoading || !h ? (
        <SkeletonRows count={3} />
      ) : list.length === 0 ? (
        <EmptyState title={tab === 'open' ? 'No new requests' : 'Nothing here'} icon={<Inbox className="h-8 w-8" />}>
          {tab === 'open' && 'Restock requests and requests for new parts show up here.'}
        </EmptyState>
      ) : (
        <ul className="space-y-3" role="tabpanel">
          {list.map((r) => <RequestCard key={r.id} r={r} onResolve={() => setResolving(r)} />)}
        </ul>
      )}
      {resolving && <ResolveDialog r={resolving} onClose={() => setResolving(null)} />}
    </div>
  )
}

function RequestCard({ r, onResolve }: { r: RestockRequest; onResolve: () => void }) {
  const { data } = useCatalog()
  const h = useCatalogHelpers(data)!
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const part = h.catalog.parts.find((p) => p.id === r.partId)
  const stock = part?.stock.find((s) => s.locationId === r.locationId)

  const set = async (status: RequestStatus) => {
    setBusy(true)
    setErr(null)
    try {
      await backend.updateRequest(r.id, status)
      await qc.invalidateQueries({ queryKey: ['requests'] })
    } catch (e) {
      setErr(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-lg font-semibold">
            {part ? (
              <Link to={`/admin/parts/${part.id}`} className="hover:underline">{part.name} {part.value && <span className="font-semibold">{part.value}</span>}</Link>
            ) : r.requestedPart ? (
              <>
                <span className="mr-2 rounded-lg bg-gold-tint px-2 py-0.5 align-middle text-xs font-bold text-gold-dark">Not in catalog</span>
                {r.requestedPart}
              </>
            ) : (
              'Deleted part'
            )}
          </p>
          {part?.partNumber && <p className="font-mono text-sm text-ink-2">{part.partNumber}</p>}
          <p className="mt-1 text-sm text-ink-2">
            {r.requestCount > 1 ? <strong className="text-ink">{r.requestCount} requests</strong> : '1 request'} · first {relativeDate(r.createdAt)}
            {r.requestCount > 1 && <> · latest {relativeDate(r.updatedAt)}</>}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          {r.locationId ? <LocationLabel locationId={r.locationId} locById={h.locById} size="sm" /> : r.partId ? <span className="text-sm text-ink-3">No location given</span> : null}
          {stock && <StockBadge entry={stock} compact />}
        </div>
      </div>
      {(r.note || r.requesterName || r.requesterContact) && (
        <div className="mt-3 rounded-md bg-canvas p-3 text-sm">
          {r.note && <p>“{r.note}”</p>}
          {(r.requesterName || r.requesterContact) && (
            <p className="mt-1 text-ink-2">
              — {r.requesterName || 'Anonymous'}
              {r.requesterContact && <> · <a className="underline" href={`mailto:${r.requesterContact}`}>{r.requesterContact}</a></>}
            </p>
          )}
        </div>
      )}
      {r.resolutionNote && <p className="mt-2 text-sm text-ink-2"><strong>Resolution:</strong> {r.resolutionNote}</p>}
      {err && <div className="mt-2"><Notice tone="error">{err}</Notice></div>}
      <div className="mt-3 flex flex-wrap gap-2">
        {r.status === 'open' && <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => set('acknowledged')}>Acknowledge</button>}
        {(r.status === 'open' || r.status === 'acknowledged') && (
          <>
            <button className="btn btn-primary btn-sm" disabled={busy} onClick={onResolve}>Resolve…</button>
            <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => set('dismissed')}>Dismiss</button>
          </>
        )}
        {(r.status === 'resolved' || r.status === 'dismissed') && (
          <span className="text-sm text-ink-3">{r.status === 'resolved' ? 'Resolved' : 'Dismissed'} {relativeDate(r.resolvedAt)}</span>
        )}
      </div>
    </li>
  )
}

function ResolveDialog({ r, onClose }: { r: RestockRequest; onClose: () => void }) {
  const { data } = useCatalog()
  const h = useCatalogHelpers(data)!
  const qc = useQueryClient()
  const part = h.catalog.parts.find((p) => p.id === r.partId)
  const stock = part?.stock.find((s) => s.locationId === r.locationId)
  const [note, setNote] = useState('')
  const [markInStock, setMarkInStock] = useState(Boolean(stock))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const submit = async () => {
    setBusy(true)
    setErr(null)
    try {
      if (markInStock && stock) {
        await backend.setStock({ ...stock, quantity: null, status: 'in_stock', lastCheckedAt: new Date().toISOString() })
      }
      await backend.updateRequest(r.id, 'resolved', note)
      await qc.invalidateQueries()
      onClose()
    } catch (e) {
      setErr(errorMessage(e))
      setBusy(false)
    }
  }
  return (
    <Modal open onClose={onClose} title="Resolve request">
      <div className="space-y-4">
        <p className="font-semibold">{part ? `${part.name} ${part.value}` : r.requestedPart}</p>
        <div>
          <label className="label" htmlFor="res-note">Note (optional)</label>
          <input id="res-note" className="field" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Refilled from overflow, ordered 100, …" />
        </div>
        {stock && (
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-1 h-4 w-4 accent-maroon" checked={markInStock} onChange={(e) => setMarkInStock(e.target.checked)} />
            <span>Mark <strong>{h.locById.get(stock.locationId)?.code}</strong> as In stock, checked now<span className="block text-xs text-ink-3">Clears any old count. Set an exact count in the editor if you counted.</span></span>
          </label>
        )}
        {err && <Notice tone="error">{err}</Notice>}
        <button className="btn btn-primary w-full" disabled={busy} onClick={submit}>{busy ? 'Saving…' : 'Resolve'}</button>
      </div>
    </Modal>
  )
}
