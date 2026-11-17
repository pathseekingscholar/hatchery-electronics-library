import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Camera, Pencil, Plus, Trash2 } from 'lucide-react'
import { backend } from '../backend'
import { useCatalog, useCatalogHelpers } from '../hooks/data'
import { childrenOf, flattenTree, subtreeIds } from '../lib/locations'
import { errorMessage } from '../lib/format'
import type { Location, LocationInput, ProcessedPhoto } from '../lib/types'
import { EmptyState, ErrorState, Modal, Notice, Spinner } from '../components/ui'
import { LocationSelect, PhotoPicker } from '../components/staff'

const KIND_SUGGESTIONS = ['Room', 'Cabinet', 'Shelf', 'Drawer', 'Bin', 'Box', 'Pegboard']

export function StaffLocations() {
  const { data, error, isLoading, refetch } = useCatalog()
  const h = useCatalogHelpers(data)
  const [editing, setEditing] = useState<LocationInput | null>(null)
  const [photoFor, setPhotoFor] = useState<Location | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const qc = useQueryClient()

  if (error) return <ErrorState error={error} onRetry={() => refetch()} />
  if (isLoading || !h) return <Spinner className="py-10" />

  const partCount = (id: string) => {
    const ids = subtreeIds(id, h.catalog.locations)
    return h.catalog.parts.filter((p) => p.stock.some((s) => ids.has(s.locationId))).length
  }
  const nextKind = (parent: Location | null) => {
    if (!parent) return 'Room'
    const siblings = childrenOf(parent.id, h.catalog.locations)
    if (siblings[0]) return siblings[0].kind
    const i = KIND_SUGGESTIONS.indexOf(parent.kind)
    return i >= 0 && i < KIND_SUGGESTIONS.length - 1 ? KIND_SUGGESTIONS[i + 1] : 'Drawer'
  }
  const add = (parent: Location | null) =>
    setEditing({ parentId: parent?.id ?? null, kind: nextKind(parent), name: '', code: parent ? `${parent.code}-` : '', description: '', sort: childrenOf(parent?.id ?? null, h.catalog.locations).length + 1 })

  const remove = async (l: Location) => {
    if (!confirm(`Delete ${l.kind.toLowerCase()} ${l.code}?`)) return
    setErr(null)
    try {
      await backend.deleteLocation(l.id)
      await qc.invalidateQueries({ queryKey: ['catalog'] })
    } catch (e) {
      setErr(errorMessage(e))
    }
  }

  const tree = flattenTree(h.catalog.locations)

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-bold">Locations</h1>
        <button className="btn btn-primary" onClick={() => add(null)}><Plus className="h-5 w-5" aria-hidden /> Add top-level location</button>
      </div>
      <p className="mb-4 max-w-2xl text-sm text-ink-2">
        Build your own hierarchy — rooms, cabinets, drawers, bins, or whatever matches the space. The <strong>label code</strong> is what students look for on the physical drawer, so make it match the printed label.
      </p>
      {err && <div className="mb-3"><Notice tone="error">{err}</Notice></div>}
      {tree.length === 0 ? (
        <EmptyState title="No locations yet">Start with a room or a cabinet, then add drawers inside it.</EmptyState>
      ) : (
        <ul className="card divide-y divide-line">
          {tree.map(({ location: l, depth }) => (
            <li key={l.id} className="flex flex-wrap items-center gap-2 py-2 pr-2" style={{ paddingLeft: `${0.75 + depth * 1.25}rem` }}>
              <span className="drawer-label px-3 py-0.5 font-mono text-sm font-bold">{l.code}</span>
              <span className="min-w-0 flex-1">
                <span className="font-medium">{l.name}</span> <span className="text-xs text-ink-3">{l.kind} · {partCount(l.id)} parts{l.photoUrl ? ' · photo' : ''}</span>
              </span>
              <span className="flex gap-0.5">
                <button className="btn btn-ghost btn-sm !px-2" onClick={() => add(l)} aria-label={`Add inside ${l.code}`} title="Add inside"><Plus className="h-4 w-4" /></button>
                <button className="btn btn-ghost btn-sm !px-2" onClick={() => setPhotoFor(l)} aria-label={`Photo for ${l.code}`} title="Drawer photo"><Camera className="h-4 w-4" /></button>
                <button className="btn btn-ghost btn-sm !px-2" onClick={() => setEditing({ id: l.id, parentId: l.parentId, kind: l.kind, name: l.name, code: l.code, description: l.description, sort: l.sort })} aria-label={`Edit ${l.code}`} title="Edit"><Pencil className="h-4 w-4" /></button>
                <button className="btn btn-ghost btn-sm !px-2 text-out" onClick={() => remove(l)} aria-label={`Delete ${l.code}`} title="Delete"><Trash2 className="h-4 w-4" /></button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-sm text-ink-2">Students browse these on <Link to="/locations" className="font-semibold text-maroon underline">Browse drawers</Link>.</p>

      {editing && <LocationDialog value={editing} locations={h.catalog.locations} onClose={() => setEditing(null)} />}
      {photoFor && <LocationPhotoDialog location={photoFor} onClose={() => setPhotoFor(null)} />}
    </div>
  )
}

function LocationDialog({ value, locations, onClose }: { value: LocationInput; locations: Location[]; onClose: () => void }) {
  const [v, setV] = useState(value)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const qc = useQueryClient()
  const exclude = value.id ? [...subtreeIds(value.id, locations)] : []
  const save = async () => {
    setBusy(true)
    setErr(null)
    try {
      await backend.saveLocation(v)
      await qc.invalidateQueries({ queryKey: ['catalog'] })
      onClose()
    } catch (e) {
      setErr(errorMessage(e))
      setBusy(false)
    }
  }
  return (
    <Modal open onClose={onClose} title={value.id ? 'Edit location' : 'Add location'}>
      <form onSubmit={(e) => { e.preventDefault(); save() }} className="space-y-3">
        <div>
          <label className="label" htmlFor="l-parent">Inside</label>
          <LocationSelect id="l-parent" locations={locations} value={v.parentId ?? ''} onChange={(p) => setV({ ...v, parentId: p || null })} placeholder="(top level)" exclude={exclude} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="l-kind">Type</label>
            <input id="l-kind" className="field" list="kinds" required maxLength={30} value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value })} />
            <datalist id="kinds">{KIND_SUGGESTIONS.map((k) => <option key={k} value={k} />)}</datalist>
          </div>
          <div>
            <label className="label" htmlFor="l-code">Label code</label>
            <input id="l-code" className="field font-mono font-bold" required maxLength={24} value={v.code} onChange={(e) => setV({ ...v, code: e.target.value })} placeholder="A-03" />
          </div>
        </div>
        <div>
          <label className="label" htmlFor="l-name">Name</label>
          <input id="l-name" className="field" required maxLength={80} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="Drawer 3 — capacitors" />
        </div>
        <div>
          <label className="label" htmlFor="l-desc">How to find it (optional)</label>
          <input id="l-desc" className="field" value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} placeholder="Left wall, under the soldering stations" />
        </div>
        <div>
          <label className="label" htmlFor="l-sort">Order</label>
          <input id="l-sort" className="field w-24" type="number" value={v.sort} onChange={(e) => setV({ ...v, sort: Number(e.target.value) || 0 })} />
        </div>
        {err && <Notice tone="error">{err}</Notice>}
        <button className="btn btn-primary w-full" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
      </form>
    </Modal>
  )
}

function LocationPhotoDialog({ location, onClose }: { location: Location; onClose: () => void }) {
  const [photo, setPhoto] = useState<ProcessedPhoto | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const qc = useQueryClient()
  const save = async (p: ProcessedPhoto | null) => {
    setBusy(true)
    setErr(null)
    try {
      await backend.setLocationPhoto(location.id, p)
      await qc.invalidateQueries({ queryKey: ['catalog'] })
      onClose()
    } catch (e) {
      setErr(errorMessage(e))
      setBusy(false)
    }
  }
  return (
    <Modal open onClose={onClose} title={`Photo for ${location.code}`}>
      <div className="space-y-3">
        <p className="text-sm text-ink-2">A photo of the drawer front or label helps students recognize it. Drawer photos are public once saved.</p>
        {(photo?.previewUrl || location.photoUrl) && <img src={photo?.previewUrl ?? location.photoUrl!} alt="" className="max-h-64 w-full rounded border border-line object-contain" />}
        <PhotoPicker onPhoto={setPhoto} label="Drawer photo" />
        {err && <Notice tone="error">{err}</Notice>}
        <div className="flex gap-2">
          <button className="btn btn-primary flex-1" disabled={!photo || busy} onClick={() => save(photo)}>{busy ? 'Saving…' : 'Save photo'}</button>
          {location.photoUrl && <button className="btn btn-ghost text-out" disabled={busy} onClick={() => save(null)}>Remove</button>}
        </div>
      </div>
    </Modal>
  )
}
