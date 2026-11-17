// Public drawer views cut from the 2026-11-16 photos (scripts/inventory/location_photos.py).
import data from '../data/location-photos.json'
import type { Location, Part } from './types'
import { locationPath } from './locations'

export interface DrawerView {
  key: string
  url: string
  width: number
  height: number
}

export interface Pin {
  photo: string
  x: number
  y: number
}

const photos = data.photos as Record<string, { file: string; width: number; height: number }>
const byCode = data.locations as Record<string, string>
const pins = data.pins as Record<string, Pin>

function view(key: string): DrawerView {
  const p = photos[key]
  return { key, url: `${import.meta.env.BASE_URL}${p.file}`, width: p.width, height: p.height }
}

/** The photo of the nearest location (self or ancestor) that has one — usually the drawer. */
export function drawerViewFor(locationId: string, locById: Map<string, Location>): DrawerView | null {
  const path = locationPath(locationId, locById)
  for (let i = path.length - 1; i >= 0; i--) {
    const key = byCode[path[i].code]
    if (key) return view(key)
  }
  return null
}

/** Where this record was seen in a drawer photo, if a pin was placed. */
export function pinFor(part: Part, photoKey: string): Pin | null {
  const ids = [part.evidence?.draftId, ...(part.evidence?.alsoSeen ?? [])].filter(Boolean) as string[]
  for (const id of ids) {
    const p = pins[id]
    if (p && p.photo === photoKey) return p
  }
  return null
}
