import type { Location } from './types'

/** Root → leaf chain for a location id. Guards against cycles. */
export function locationPath(id: string | null, byId: Map<string, Location>): Location[] {
  const path: Location[] = []
  const seen = new Set<string>()
  let current = id ? byId.get(id) : undefined
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    path.unshift(current)
    current = current.parentId ? byId.get(current.parentId) : undefined
  }
  return path
}

export function childrenOf(parentId: string | null, locations: Location[]): Location[] {
  return locations
    .filter((l) => l.parentId === parentId)
    .sort((a, b) => a.sort - b.sort || a.code.localeCompare(b.code, undefined, { numeric: true }))
}

/** All ids in the subtree rooted at id (inclusive). */
export function subtreeIds(id: string, locations: Location[]): Set<string> {
  const ids = new Set([id])
  let grew = true
  while (grew) {
    grew = false
    for (const l of locations) {
      if (l.parentId && ids.has(l.parentId) && !ids.has(l.id)) {
        ids.add(l.id)
        grew = true
      }
    }
  }
  return ids
}

/** Nearest location (self or ancestor) with a photo — usually the drawer. */
export function nearestPhoto(id: string, byId: Map<string, Location>): Location | null {
  const path = locationPath(id, byId)
  for (let i = path.length - 1; i >= 0; i--) if (path[i].photoUrl) return path[i]
  return null
}

/** Flattened tree for <select> pickers, depth-first with indentation depth. */
export function flattenTree(locations: Location[]): Array<{ location: Location; depth: number }> {
  const out: Array<{ location: Location; depth: number }> = []
  const walk = (parentId: string | null, depth: number) => {
    for (const l of childrenOf(parentId, locations)) {
      out.push({ location: l, depth })
      walk(l.id, depth + 1)
    }
  }
  walk(null, 0)
  return out
}
