import { BadgeCheck, CircleSlash, CircleCheck, CircleHelp, CircleAlert, Cpu, TriangleAlert } from 'lucide-react'
import clsx from 'clsx'
import { Link } from 'react-router-dom'
import type { Location, Part, PartPhoto, PhotoAttribution, ReviewStatus, StockEntry, StockStatus } from '../lib/types'
import representative from '../data/representative-images.json'
import thumbs from '../data/catalog-thumbs.json'
import { locationPath } from '../lib/locations'
import { relativeDate } from '../lib/format'

const STATUS: Record<StockStatus, { label: string; icon: typeof CircleCheck; cls: string }> = {
  in_stock: { label: 'In stock', icon: CircleCheck, cls: 'bg-ok-bg text-ok border-ok/25' },
  low: { label: 'Low', icon: CircleAlert, cls: 'bg-low-bg text-low border-low/25' },
  out: { label: 'Out', icon: CircleSlash, cls: 'bg-out-bg text-out border-out/25' },
  unverified: { label: 'Unverified', icon: CircleHelp, cls: 'bg-transparent text-ink-2 border-dashed border-line-strong' },
}

const REVIEW: Record<Exclude<ReviewStatus, 'rejected'>, { label: string; help: string; icon: typeof CircleCheck; cls: string }> = {
  verified: { label: 'Staff verified', help: 'A staff member checked this part in its drawer.', icon: BadgeCheck, cls: 'bg-ok-bg text-ok border-ok/25' },
  needs_review: { label: 'Needs review', help: 'Listed from photos of the drawers; not yet checked by staff.', icon: TriangleAlert, cls: 'bg-low-bg text-low border-low/30' },
}

/** How trustworthy a record is: verified by staff, cataloged from photos, or uncertain. */
export function ReviewBadge({ status, compact }: { status: ReviewStatus; compact?: boolean }) {
  if (status === 'rejected') return null
  const cfg = REVIEW[status]
  const Icon = cfg.icon
  return (
    <span title={cfg.help} className={clsx('inline-flex items-center gap-1 whitespace-nowrap rounded-full border font-semibold', compact ? 'px-2 py-0.5 text-[0.7rem]' : 'px-2.5 py-1 text-sm', cfg.cls)}>
      <Icon className={compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} aria-hidden />
      {cfg.label}
    </span>
  )
}

export function reviewHelp(status: ReviewStatus) {
  return status === 'rejected' ? '' : REVIEW[status].help
}

export function statusLabel(s: StockStatus) {
  return STATUS[s].label
}

/** Status text is always shown next to color; counts only when someone actually counted. */
export function StockBadge({ entry, compact }: { entry: Pick<StockEntry, 'status' | 'quantity'>; compact?: boolean }) {
  const cfg = STATUS[entry.status]
  const Icon = cfg.icon
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full border font-semibold',
        compact ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-sm',
        cfg.cls,
      )}
    >
      <Icon className={compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} aria-hidden />
      {cfg.label}
      {entry.quantity !== null && entry.status !== 'out' && <span className="font-mono font-semibold">· {entry.quantity}</span>}
    </span>
  )
}

export function CheckedLine({ entry }: { entry: StockEntry }) {
  return (
    <span className="text-xs text-ink-3">
      {entry.quantity !== null ? 'Counted' : 'Checked'} {relativeDate(entry.lastCheckedAt)}
    </span>
  )
}

/**
 * Bold, scannable drawer label: the leaf code big, the path small.
 * `size="lg"` is used on detail pages.
 */
export function LocationLabel({
  locationId, locById, size = 'md', showPath = true,
}: { locationId: string; locById: Map<string, Location>; size?: 'sm' | 'md' | 'lg'; showPath?: boolean }) {
  const path = locationPath(locationId, locById)
  const leaf = path[path.length - 1]
  if (!leaf) return <span className="text-sm text-ink-3">Unknown location</span>
  const trail = path.slice(0, -1)
  return (
    <span className="inline-flex min-w-0 flex-col gap-1">
      <span className={clsx('drawer-label', size === 'lg' ? 'px-5 py-2' : size === 'md' ? 'px-3.5 py-1.5' : 'px-3 py-1')}>
        <span className="flex flex-col">
          <span className="eyebrow !text-[0.62rem] leading-none">{leaf.kind}</span>
          <span
            className={clsx(
              'font-mono font-bold tracking-tight',
              size === 'lg' ? 'text-3xl' : size === 'md' ? 'text-lg' : 'text-base',
            )}
          >
            {leaf.code}
          </span>
        </span>
      </span>
      {showPath && (
        <span className={clsx('truncate text-ink-2', size === 'lg' ? 'text-base' : 'text-xs')} title={path.map((l) => l.name).join(' › ')}>
          {trail.map((l) => l.name).join(' › ')}
          {trail.length > 0 && ' › '}
          <span className="font-semibold text-ink">{leaf.name}</span>
        </span>
      )}
    </span>
  )
}

/** Electronics Library › Zone II › Drawer 1 › Bin — every step is a link. */
export function LocationTrail({ locationId, locById, className }: { locationId: string; locById: Map<string, Location>; className?: string }) {
  const path = locationPath(locationId, locById)
  return (
    <nav aria-label="Location" className={clsx('flex flex-wrap items-center gap-x-1 gap-y-0.5 text-sm', className)}>
      <Link to="/locations" className="text-ink-3 hover:text-maroon hover:underline">Electronics Library</Link>
      {path.slice(1).map((l, i, arr) => (
        <span key={l.id} className="flex items-center gap-1">
          <span aria-hidden className="text-ink-3">›</span>
          <Link
            to={`/locations/${l.id}`}
            className={clsx('hover:text-maroon hover:underline', i === arr.length - 1 ? 'font-semibold text-ink' : 'text-ink-2')}
          >
            {l.kind === 'Bin' || l.kind === 'Case' || l.kind === 'Tub' ? `${l.kind} ${l.name}` : l.name.split(' — ')[0]}
          </Link>
        </span>
      ))}
    </nav>
  )
}

/** The part's own photo if staff added one; otherwise its generated 16:10 catalog image. */
export function primaryPhoto(part: Part): PartPhoto | null {
  const own = part.photos.find((p) => p.isPrimary && p.thumbUrl) ?? part.photos.find((p) => p.thumbUrl)
  return own ?? catalogImage(part)
}

/** Generated by scripts/inventory/catalog_thumbs.py: licensed photo, drawer close-up, or drawer view. */
export function catalogImage(part: Part): (PartPhoto & { source: 'representative' | 'closeup' | 'drawer' }) | null {
  const ids = [part.evidence?.draftId, ...(part.evidence?.alsoSeen ?? [])].filter(Boolean) as string[]
  const id = ids.find((x) => (thumbs as Record<string, unknown>)[x])
  if (!id) return null
  const t = (thumbs as Record<string, { file: string; kind: 'representative' | 'closeup' | 'drawer' }>)[id]
  const url = `${import.meta.env.BASE_URL}${t.file}`
  return {
    id: `img-${part.id}`, partId: part.id, fullPath: t.file, thumbPath: t.file, fullUrl: url, thumbUrl: url,
    published: true, isPrimary: true, createdAt: '', source: t.kind,
    attribution: t.kind === 'representative' ? representativePhoto(part)?.attribution ?? null : null,
  }
}

export function representativePhoto(part: Part): PartPhoto | null {
  const ids = [part.evidence?.draftId, ...(part.evidence?.alsoSeen ?? [])].filter(Boolean) as string[]
  const hit = ids.map((id) => (representative as Record<string, PhotoAttribution & { file: string }>)[id]).find(Boolean)
  if (!hit) return null
  const url = `${import.meta.env.BASE_URL}${hit.file}`
  return {
    id: `rep-${part.id}`, partId: part.id, fullPath: hit.file, thumbPath: hit.file, fullUrl: url, thumbUrl: url,
    published: true, isPrimary: true, createdAt: '',
    attribution: { title: hit.title, author: hit.author, license: hit.license, licenseUrl: hit.licenseUrl, sourceUrl: hit.sourceUrl },
  }
}

export function PartThumb({ part, size = 56, className }: { part: Part; size?: number; className?: string }) {
  const photo = primaryPhoto(part)
  return (
    <span
      className={clsx('flex shrink-0 items-center justify-center overflow-hidden rounded-xl border border-line bg-gold-tint', className)}
      style={{ width: size, height: size }}
    >
      {photo ? (
        <img src={photo.thumbUrl} alt="" loading="lazy" className="h-full w-full object-cover" width={size} height={size} />
      ) : (
        <Cpu className="h-1/2 w-1/2 text-line-strong" aria-hidden />
      )}
    </span>
  )
}

/** Best stock entry first: in stock > low > unverified > out. */
export function sortedStock(part: Part, prefer: string[] = []): StockEntry[] {
  const rank: Record<StockStatus, number> = { in_stock: 0, low: 1, unverified: 2, out: 3 }
  return [...part.stock].sort(
    (a, b) =>
      Number(prefer.includes(b.locationId)) - Number(prefer.includes(a.locationId)) || rank[a.status] - rank[b.status],
  )
}
