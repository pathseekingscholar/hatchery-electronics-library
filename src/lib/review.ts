import type { Catalog, Part } from './types'
import { subtreeIds } from './locations'

export interface ReviewProgress {
  total: number
  /** not yet physically checked */
  draft: number
  needsReview: number
  /** needs review AND carries a specific concern (low confidence, uncertain drawer, …) */
  flagged: number
  verified: number
  rejected: number
  /** share of records that have been decided (verified or rejected) */
  done: number
}

/** Records (not merged-away duplicates) stocked anywhere inside a location. */
export function partsIn(locationId: string, catalog: Catalog, includeMerged = false): Part[] {
  const ids = subtreeIds(locationId, catalog.locations)
  return catalog.parts.filter((p) => (includeMerged || !p.mergedInto) && p.stock.some((s) => ids.has(s.locationId)))
}

export function progressOf(parts: Part[]): ReviewProgress {
  const needsReview = parts.filter((p) => p.reviewStatus === 'needs_review').length
  const draft = needsReview
  const flagged = parts.filter((p) => p.reviewStatus === 'needs_review' && p.reviewReasons.length > 0).length
  const verified = parts.filter((p) => p.reviewStatus === 'verified').length
  const rejected = parts.filter((p) => p.reviewStatus === 'rejected').length
  const total = parts.length
  return { total, draft, needsReview, flagged, verified, rejected, done: total ? (verified + rejected) / total : 1 }
}

export const ITEM_TYPE_LABEL: Record<Part['itemType'], string> = {
  component: 'Component',
  module: 'Module',
  assortment: 'Assortment',
  kit: 'Kit',
  tool: 'Tool',
  consumable: 'Consumable',
  equipment: 'Equipment',
  container: 'Container',
}
