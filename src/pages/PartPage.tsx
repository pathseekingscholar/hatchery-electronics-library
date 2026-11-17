import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Cpu, ExternalLink, Pencil } from 'lucide-react'
import { useCatalog, useCatalogHelpers, useStaff } from '../hooks/data'
import { nearestPhoto } from '../lib/locations'
import { shortDate } from '../lib/format'
import { EmptyState, ErrorState, Spinner } from '../components/ui'
import { CheckedLine, LocationLabel, LocationTrail, ReviewBadge, StockBadge, primaryPhoto, reviewHelp, sortedStock } from '../components/inventory'
import { RestockDialog } from '../components/RestockDialog'
import { DrawerPhoto } from '../components/DrawerPhoto'
import { drawerViewFor, pinFor } from '../lib/locationPhotos'
import { CATALOG_ONLY } from '../lib/release'

export function PartPage() {
  const { id } = useParams()
  const { data, error, isLoading, refetch } = useCatalog()
  const h = useCatalogHelpers(data)
  const { data: staff } = useStaff()
  const [restockFor, setRestockFor] = useState<string | null | undefined>(undefined)
  const [photoIdx, setPhotoIdx] = useState(0)
  const navigate = useNavigate()

  if (error) return <ErrorState error={error} onRetry={() => refetch()} />
  if (isLoading || !h) return <Spinner className="py-10" />
  const part = h.catalog.parts.find((p) => p.id === id)
  if (!part) {
    return (
      <EmptyState title="Part not found">
        It may have been removed or renamed. <Link to="/" className="font-semibold text-maroon underline">Search the catalog</Link>.
      </EmptyState>
    )
  }

  const photos = [...part.photos].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary))
  const photo = photos[photoIdx] ?? primaryPhoto(part)
  const stock = sortedStock(part)
  const category = h.catById.get(part.categoryId ?? '')

  return (
    <article>
      <div className="mb-4 flex items-center justify-between gap-2">
        <button onClick={() => ((window.history.state?.idx ?? 0) > 0 ? navigate(-1) : navigate('/'))} className="btn btn-ghost btn-sm -ml-3">
          <ArrowLeft className="h-4 w-4" aria-hidden /> Back
        </button>
        {staff && (
          <Link to={`/admin/parts/${part.id}`} className="btn btn-secondary btn-sm">
            <Pencil className="h-4 w-4" aria-hidden /> Edit part
          </Link>
        )}
      </div>

      <header className="mb-5">
            <p className="eyebrow">{category ?? 'Uncategorized'}</p>
            <h1 className="mt-1 text-3xl font-bold leading-tight">
              {part.name}
              {part.value && <span className="ml-2 text-maroon-dark">{part.value}</span>}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <ReviewBadge status={part.reviewStatus} />
              <span className="text-sm text-ink-3">{reviewHelp(part.reviewStatus)}</span>
            </div>
            {part.reviewStatus === 'needs_review' && part.reviewReasons.length > 0 && (
              <p className="mt-1 text-sm text-low">{part.reviewReasons.join(' · ')}</p>
            )}
            {!part.published && <p className="mt-2 inline-block rounded bg-label px-2 py-0.5 text-sm font-semibold">Hidden — only staff can see this record</p>}
          </header>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        {/* Details + photo (after location on phones) */}
        <section className="min-w-0 lg:order-1" aria-label="Details">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[0.95rem]">
            {part.partNumber && (<><dt className="text-ink-3">Part no.</dt><dd className="font-mono font-semibold">{part.partNumber}</dd></>)}
            {part.manufacturer && (<><dt className="text-ink-3">Maker</dt><dd>{part.manufacturer}</dd></>)}
            {part.package && (<><dt className="text-ink-3">Package</dt><dd>{part.package}</dd></>)}
            {part.aliases.length > 0 && (<><dt className="text-ink-3">Also called</dt><dd>{part.aliases.join(', ')}</dd></>)}
            {Object.entries(part.evidence?.specifications ?? {}).map(([k, v]) => (
              <span key={k} className="contents"><dt className="text-ink-3 capitalize">{k.replace(/_/g, ' ')}</dt><dd>{v}</dd></span>
            ))}
            {part.evidence?.labelText && (<><dt className="text-ink-3">Label reads</dt><dd>“{part.evidence.labelText}”</dd></>)}
          </dl>
          {part.description && <p className="mt-3 max-w-prose text-ink-2">{part.description}</p>}
          {part.datasheetUrl && (
            <a href={part.datasheetUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 font-semibold text-maroon underline underline-offset-2">
              Datasheet <ExternalLink className="h-4 w-4" aria-hidden /><span className="sr-only">(opens in new tab)</span>
            </a>
          )}

          <div className="mt-5">
            {photo ? (
              <figure>
                <img src={photo.fullUrl || photo.thumbUrl} alt={`Photo of ${part.name} ${part.value}`} width={560} height={350} className="aspect-[16/10] w-full rounded-lg border border-line bg-label object-cover" />
                {'source' in photo && photo.source !== 'representative' && (
                  <figcaption className="mt-1.5 text-xs text-ink-3">
                    {photo.source === 'closeup'
                      ? 'Close-up from our drawer photo (2026-11-16).'
                      : 'Location reference: this shows the drawer it’s stored in, not the part itself. No close-up yet.'}
                  </figcaption>
                )}
                {photo.attribution && (
                  <figcaption className="mt-1.5 text-xs text-ink-3">
                    Representative photo of this kind of part, not our exact unit.{' '}
                    <a href={photo.attribution.sourceUrl} target="_blank" rel="noreferrer" className="underline">“{photo.attribution.title}”</a> by {photo.attribution.author},{' '}
                    {photo.attribution.licenseUrl ? <a href={photo.attribution.licenseUrl} target="_blank" rel="noreferrer" className="underline">{photo.attribution.license}</a> : photo.attribution.license}, via Wikimedia Commons; cropped and resized.
                  </figcaption>
                )}
                {photos.length > 1 && (
                  <div className="mt-2 flex gap-2" role="group" aria-label="Photos">
                    {photos.map((ph, i) => (
                      <button key={ph.id} onClick={() => setPhotoIdx(i)} aria-label={`Photo ${i + 1}`} aria-pressed={i === photoIdx} className="overflow-hidden rounded border-2 border-transparent aria-pressed:border-maroon">
                        <img src={ph.thumbUrl} alt="" className="h-14 w-14 object-cover" />
                      </button>
                    ))}
                  </div>
                )}
              </figure>
            ) : (
              <div className="flex aspect-[16/10] w-full flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-line-strong bg-label/50 text-ink-3">
                <Cpu className="h-8 w-8" aria-hidden />
                <span className="text-sm">No photo yet</span>
              </div>
            )}
          </div>
        </section>

        {/* Where to find it */}
        <section aria-labelledby="where-h" className="order-first min-w-0 lg:order-2">
          <h2 id="where-h" className="eyebrow mb-2">Where to find it</h2>
          {stock.length === 0 ? (
            <EmptyState title="No location recorded">Ask staff at the desk.</EmptyState>
          ) : (
            <ul className="space-y-3">
              {stock.map((s) => {
                const drawer = nearestPhoto(s.locationId, h.locById)
                return (
                  <li key={s.id} className="card overflow-hidden">
                    <div className="flex flex-wrap items-start justify-between gap-3 p-4">
                      <div className="min-w-0">
                        <LocationLabel locationId={s.locationId} locById={h.locById} size="lg" showPath={false} />
                        <LocationTrail locationId={s.locationId} locById={h.locById} className="mt-2" />
                      </div>
                      <div className="flex flex-col items-start gap-1 sm:items-end">
                        <StockBadge entry={s} />
                        <CheckedLine entry={s} />
                      </div>
                    </div>
                    {s.notes && <p className="px-4 pb-3 text-sm text-ink-2">{s.notes}</p>}
                    {drawer?.photoUrl ? (
                      <figure className="border-t border-line bg-label/40 p-3">
                        <img src={drawer.photoUrl} alt={`Photo of ${drawer.kind.toLowerCase()} ${drawer.code}`} loading="lazy" className="max-h-64 w-full rounded object-contain" />
                        <figcaption className="mt-1 text-xs text-ink-3">{drawer.kind} {drawer.code} — {drawer.name}</figcaption>
                      </figure>
                    ) : (() => {
                      const v = drawerViewFor(s.locationId, h.locById)
                      if (!v) return null
                      const loc = h.locById.get(s.locationId)
                      return (
                        <div className="border-t border-line bg-label/40 p-3">
                          <DrawerPhoto view={v} pin={pinFor(part, v.key)} label={part.name} caption={`Inside ${loc?.code ?? 'this location'}`} />
                        </div>
                      )
                    })()}
                    {!CATALOG_ONLY && <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-2">
                      <span className="text-xs text-ink-3">
                        {s.status === 'out' || s.status === 'low' ? 'Running out here?' : 'Empty when you got there?'}
                      </span>
                      <button className="btn btn-secondary btn-sm" onClick={() => setRestockFor(s.locationId)}>
                        Request restock
                      </button>
                    </div>}
                  </li>
                )
              })}
            </ul>
          )}
          {stock.length === 0 && !CATALOG_ONLY && (
            <button className="btn btn-secondary mt-3" onClick={() => setRestockFor(null)}>Request this part</button>
          )}
          <p className="mt-4 text-xs text-ink-3">Last updated {shortDate(part.updatedAt)}</p>
        </section>
      </div>

      {!CATALOG_ONLY && <RestockDialog
        part={part}
        locationId={restockFor ?? null}
        locById={h.locById}
        open={restockFor !== undefined}
        onClose={() => setRestockFor(undefined)}
      />}
    </article>
  )
}
