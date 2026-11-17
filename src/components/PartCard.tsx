import { createElement } from 'react'
import { Link } from 'react-router-dom'
import {
  Activity, BatteryMedium, Cable, ChevronsRight, CircuitBoard, Cog, Cpu, Gauge, Lightbulb, MapPin,
  MemoryStick, Monitor, Package, Plug, Power, ToggleLeft, Volume2, Wifi, Wrench, type LucideIcon,
} from 'lucide-react'
import type { CatalogHelpers } from '../hooks/data'
import { locationPath } from '../lib/locations'
import type { Part } from '../lib/types'
import { ReviewBadge, StockBadge, primaryPhoto, sortedStock } from './inventory'

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  resistors: Activity,
  capacitors: BatteryMedium,
  diodes: ChevronsRight,
  'leds & lighting': Lightbulb,
  transistors: CircuitBoard,
  ics: Cpu,
  microcontrollers: MemoryStick,
  sensors: Gauge,
  'motors & drivers': Cog,
  power: Power,
  'switches & buttons': ToggleLeft,
  connectors: Plug,
  displays: Monitor,
  audio: Volume2,
  wireless: Wifi,
  'cables & wire': Cable,
  'tools & misc': Wrench,
}

export function categoryIcon(name: string | undefined): LucideIcon {
  return (name && CATEGORY_ICONS[name.toLowerCase()]) || Package
}

export function CategoryIcon({ name, className, strokeWidth }: { name: string | undefined; className?: string; strokeWidth?: number }) {
  return createElement(categoryIcon(name), { className, strokeWidth, 'aria-hidden': true })
}

/** Search result card: photo, name + value, stock status, and the drawer to open. */
export function PartCard({ part, h, matchedLocations = [] }: { part: Part; h: CatalogHelpers; matchedLocations?: string[] }) {
  const stock = sortedStock(part, matchedLocations)
  const first = stock[0]
  const category = h.catById.get(part.categoryId ?? '')
  const photo = primaryPhoto(part)
  const path = first ? locationPath(first.locationId, h.locById) : []
  const leaf = path[path.length - 1]

  return (
    <li>
      <Link
        to={`/part/${part.id}`}
        className="card group flex h-full overflow-hidden transition duration-200 hover:-translate-y-0.5 hover:border-gold-light hover:shadow-[0_18px_40px_-20px_rgb(74_10_7/0.35)] sm:flex-col"
      >
        <div className="relative flex aspect-[16/10] w-32 shrink-0 items-center justify-center self-start overflow-hidden bg-gradient-to-br from-gold-tint to-canvas sm:w-full">
          {photo ? (
            <img src={photo.thumbUrl} alt="" loading="lazy" width={560} height={350} className="absolute inset-0 h-full w-full object-cover" />
          ) : (
            <CategoryIcon name={category} className="h-9 w-9 text-gold sm:h-12 sm:w-12" strokeWidth={1.5} />
          )}
          {photo && 'source' in photo && photo.source === 'drawer' && (
            <span className="absolute bottom-1.5 left-1.5 z-10 inline-flex items-center gap-1 rounded-md bg-ink/75 px-1.5 py-0.5 text-[0.65rem] font-semibold text-white">
              <MapPin className="h-3 w-3" aria-hidden /> Drawer view
            </span>
          )}
          {category && (
            <span className="absolute left-3 top-3 z-10 hidden rounded-lg bg-maroon px-2 py-1 text-xs font-semibold text-white shadow-sm sm:inline">
              {category}
            </span>
          )}
          {!part.published && (
            <span className="absolute right-3 top-3 z-10 rounded-lg bg-surface/90 px-2 py-1 text-xs font-semibold text-ink-2">Hidden</span>
          )}

        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1 p-4">
          <p className="font-semibold leading-snug group-hover:text-maroon-dark">
            {part.name}
            {part.value && <span className="ml-1.5 font-bold text-maroon">{part.value}</span>}
          </p>
          <p className="truncate text-sm text-ink-3">
            {[part.partNumber, part.package].filter(Boolean).join(' · ') || category || ' '}
          </p>
          <div className="mt-0.5"><ReviewBadge status={part.reviewStatus} compact /></div>
          <div className="mt-auto pt-3">
            {first && leaf ? (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span
                  className="inline-flex items-center gap-1.5 rounded-xl border border-gold-light bg-gold-tint px-2.5 py-1 text-maroon-dark"
                  title={path.map((l) => l.name).join(' › ')}
                >
                  <MapPin className="h-4 w-4 shrink-0" aria-hidden />
                  <span className="sr-only">{leaf.kind}</span>
                  <span className="font-mono text-[0.95rem] font-bold tracking-tight">{leaf.code}</span>
                </span>
                <StockBadge entry={first} compact />
              </div>
            ) : (
              <span className="text-sm text-ink-3">No location recorded</span>
            )}
            {stock.length > 1 && (
              <p className="mt-1.5 text-xs text-ink-3">
                +{stock.length - 1} more location{stock.length > 2 ? 's' : ''}
              </p>
            )}
          </div>
        </div>
      </Link>
    </li>
  )
}
