import { Link, useParams } from 'react-router-dom'
import { ChevronRight, ClipboardCheck, FolderOpen } from 'lucide-react'
import { useCatalog, useCatalogHelpers, useStaff } from '../hooks/data'
import { childrenOf, locationPath, subtreeIds } from '../lib/locations'
import { EmptyState, ErrorState, Spinner } from '../components/ui'
import { LocationLabel } from '../components/inventory'
import { PartCard } from '../components/PartCard'
import { DrawerPhoto } from '../components/DrawerPhoto'
import { drawerViewFor } from '../lib/locationPhotos'

export function LocationsPage() {
  const { id } = useParams()
  const { data, error, isLoading, refetch } = useCatalog()
  const h = useCatalogHelpers(data)
  const { data: staff } = useStaff()
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />
  if (isLoading || !h) return <Spinner className="py-10" />

  const loc = id ? h.locById.get(id) : null
  if (id && !loc) return <EmptyState title="Location not found"><Link to="/locations" className="text-maroon underline">See all locations</Link></EmptyState>

  const path = loc ? locationPath(loc.id, h.locById) : []
  // The single top-level room is implied: the library root lists the zones directly.
  const roots = childrenOf(null, h.catalog.locations)
  const kids = loc ? childrenOf(loc.id, h.catalog.locations) : roots.length === 1 ? childrenOf(roots[0].id, h.catalog.locations) : roots
  const ids = loc ? subtreeIds(loc.id, h.catalog.locations) : new Set<string>()
  const parts = loc
    ? h.catalog.parts.filter((p) => p.reviewStatus !== 'rejected' && p.stock.some((s) => ids.has(s.locationId))).sort((a, b) => a.name.localeCompare(b.name) || a.value.localeCompare(b.value))
    : []
  const countIn = (lid: string) => {
    const sub = subtreeIds(lid, h.catalog.locations)
    return h.catalog.parts.filter((p) => p.reviewStatus !== 'rejected' && p.stock.some((s) => sub.has(s.locationId))).length
  }

  return (
    <div>
      <nav aria-label="Breadcrumb" className="mb-3 flex flex-wrap items-center gap-1 text-sm text-ink-2">
        <Link to="/locations" className="hover:underline">Electronics Library</Link>
        {path.filter((p) => p.parentId !== null || roots.length > 1).map((p) => (
          <span key={p.id} className="flex items-center gap-1">
            <ChevronRight className="h-4 w-4 text-ink-3" aria-hidden />
            {p.id === loc?.id ? <span aria-current="page" className="font-semibold text-ink">{p.name}</span> : <Link to={`/locations/${p.id}`} className="hover:underline">{p.name}</Link>}
          </span>
        ))}
      </nav>

      {loc ? (
        <header className="mb-5 grid gap-4 sm:grid-cols-[1fr_auto] sm:items-start">
          <div>
            <LocationLabel locationId={loc.id} locById={h.locById} size="lg" />
            {staff && (
              <Link to={`/admin/review/${loc.id}`} className="btn btn-secondary btn-sm mt-3">
                <ClipboardCheck className="h-4 w-4" aria-hidden /> Check this {loc.kind.toLowerCase()}
              </Link>
            )}
            {loc.description && <p className="mt-2 text-ink-2">{loc.description}</p>}
          </div>
          {loc.photoUrl ? (
            <img src={loc.photoUrl} alt={`Photo of ${loc.kind} ${loc.code}`} className="max-h-56 w-full rounded-lg border border-line object-contain sm:w-72" />
          ) : (() => {
            const v = drawerViewFor(loc.id, h.locById)
            return v ? <DrawerPhoto view={v} caption={`Inside ${loc.code}`} className="w-full sm:w-80" /> : null
          })()}
        </header>
      ) : (
        <div className="mb-4">
          <h1 className="text-2xl font-extrabold tracking-tight">Electronics Library</h1>
          <p className="text-ink-2">Pick a zone, then a drawer, to see everything stored there.</p>
        </div>
      )}

      {kids.length > 0 && (
        <section className="mb-6" aria-label="Inside">
          {loc && <h2 className="eyebrow mb-2">Inside {loc.kind.toLowerCase()} {loc.code}</h2>}
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {kids.map((k) => (
              <li key={k.id}>
                <Link to={`/locations/${k.id}`} className="card flex items-center justify-between gap-3 p-3 hover:border-line-strong">
                  <LocationLabel locationId={k.id} locById={h.locById} size="sm" showPath={false} />
                  <span className="min-w-0 flex-1 truncate text-sm">{k.name}</span>
                  <span className="font-mono text-sm text-ink-3">{countIn(k.id)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {loc && (
        <section aria-label="Parts here">
          <h2 className="eyebrow mb-2">{parts.length} {parts.length === 1 ? 'part' : 'parts'} here</h2>
          {parts.length ? (
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
              {parts.map((p) => <PartCard key={p.id} part={p} h={h} matchedLocations={[...ids]} />)}
            </ul>
          ) : (
            <EmptyState title="Nothing recorded here" icon={<FolderOpen className="h-8 w-8" />} />
          )}
        </section>
      )}
      {!loc && kids.length === 0 && <EmptyState title="No locations yet">Staff can add rooms, cabinets, and drawers on the Locations page.</EmptyState>}
    </div>
  )
}
