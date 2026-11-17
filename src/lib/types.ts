export type StockStatus = 'in_stock' | 'low' | 'out' | 'unverified'
/**
 * needs_review: not yet physically checked by a person (everything from the photos starts here);
 *               reviewReasons lists specific concerns
 * verified:     a staff member physically checked it — never set automatically
 * rejected:     wrong / not there / merged into another record (kept for audit, never shown)
 */
export type ReviewStatus = 'needs_review' | 'verified' | 'rejected'
export type ItemType = 'component' | 'module' | 'assortment' | 'kit' | 'tool' | 'consumable' | 'equipment' | 'container'
export type Confidence = 'high' | 'medium' | 'low'

/** Where a draft record came from (photo inventory). Null for records staff typed in. */
export interface PartEvidence {
  draftId: string
  confidence: Confidence
  labelText: string | null
  photos: string[]
  visibleQty: number | null
  qtyNote: string | null
  container: string | null
  isAssortment: boolean
  contentsUnknown: boolean
  possibleDuplicateOf: string | null
  specifications: Record<string, string>
  snapshot: string | null
  mergedInto?: string | null
  /** other photo records folded into this one (same product, another location) */
  alsoSeen?: string[]
}

export interface StorageOpportunity {
  id: string
  kind: string
  description: string
  state: string
  needsConfirmation: boolean
  photos: string[]
}

/** Staff-only notes about a location from the photo inventory. */
export interface LocationEvidence {
  draftId: string | null
  frontLabel: string | null
  observedState: string | null
  confidence: Confidence
  photos: string[]
  opportunities: StorageOpportunity[]
}
export type RequestStatus = 'open' | 'acknowledged' | 'resolved' | 'dismissed'

export interface Category {
  id: string
  name: string
  sort: number
}

export interface Location {
  id: string
  parentId: string | null
  kind: string
  name: string
  code: string
  description: string
  photoUrl: string | null
  thumbUrl: string | null
  photoPath: string | null
  thumbPath: string | null
  sort: number
  reviewedAt: string | null
  reviewedByName: string | null
}

export interface PartPhoto {
  id: string
  partId: string
  fullPath: string
  thumbPath: string
  fullUrl: string
  thumbUrl: string
  published: boolean
  isPrimary: boolean
  createdAt: string
  /** set for openly licensed representative photos (not a photo of our own unit) */
  attribution?: PhotoAttribution | null
}

export interface PhotoAttribution {
  title: string
  author: string
  license: string
  licenseUrl: string
  sourceUrl: string
}

export interface StockEntry {
  id: string
  partId: string
  locationId: string
  /** null = not individually counted */
  quantity: number | null
  status: StockStatus
  lastCheckedAt: string | null
  notes: string
  checkedByName?: string | null
}

export interface Part {
  id: string
  name: string
  categoryId: string | null
  value: string
  partNumber: string
  manufacturer: string
  package: string
  aliases: string[]
  description: string
  datasheetUrl: string
  published: boolean
  createdAt: string
  updatedAt: string
  photos: PartPhoto[]
  stock: StockEntry[]
  itemType: ItemType
  reviewStatus: ReviewStatus
  reviewReasons: string[]
  evidence: PartEvidence | null
  verifiedAt: string | null
  verifiedByName: string | null
  mergedInto: string | null
}

export interface Catalog {
  parts: Part[]
  locations: Location[]
  categories: Category[]
  /** staff only */
  locationEvidence?: Record<string, LocationEvidence>
}

export interface RestockRequest {
  id: string
  /** null = request for a part that isn't in the catalog (see requestedPart) */
  partId: string | null
  requestedPart: string
  locationId: string | null
  status: RequestStatus
  note: string
  requesterName: string
  requesterContact: string
  requestCount: number
  createdAt: string
  updatedAt: string
  acknowledgedAt: string | null
  resolvedAt: string | null
  resolutionNote: string
}

export type PostKind = 'project' | 'question' | 'tip'
export type PostStatus = 'pending' | 'approved' | 'hidden'

export interface CommunityPost {
  id: string
  kind: PostKind
  title: string
  body: string
  authorName: string
  status: PostStatus
  createdAt: string
}

export type Role = 'member' | 'staff' | 'admin'

/** Anyone signed in with a confirmed @bc.edu account. */
export interface AppUser {
  id: string
  email: string
  displayName: string
  role: Role
}

export interface Member extends AppUser {
  createdAt: string
}

export interface StaffUser {
  id: string
  email: string
  displayName: string
  role: 'staff' | 'admin'
}

export type PartInput = Omit<Part, 'id' | 'createdAt' | 'updatedAt' | 'photos' | 'stock' | 'reviewStatus' | 'reviewReasons' | 'evidence' | 'verifiedAt' | 'verifiedByName' | 'mergedInto' | 'itemType'> & {
  id?: string
  itemType?: ItemType
  /** staff saving a part from the editor confirms it */
  reviewStatus?: ReviewStatus
}

/** The file produced by scripts/inventory/build_inventory.py */
export interface PhotoDraft {
  snapshot: string
  notice: string
  locations: Array<{
    id: string; parent_id: string | null; code: string; kind: string; name: string; order: number
    front_label: string | null; observed_state: string | null; identification_confidence: Confidence
    source_images: string[]
    opportunities: Array<{ id: string; kind: string; description: string; state: string; needs_confirmation: boolean; source_images: string[] }>
  }>
  items: Array<{
    draft_id: string; name: string; item_type: ItemType; category: string; description: string
    manufacturer: string | null; part_number: string | null; specifications: Record<string, string>
    label_text: string | null; is_assortment: boolean; contents_unknown: boolean
    location: { id: string; code: string; path: string[]; zone: string; container: string | null }
    quantity: { value: null; visible_in_photo: number | null; note: string | null; status: 'unverified' }
    identification_confidence: Confidence; verification_status: string; possible_duplicate_of: string | null
    catalog_status: 'needs_review'; review_reasons: string[]; searchable: boolean; duplicate_of: string | null
    source_images: string[]; snapshot: string
  }>
}

export interface StockInput {
  partId: string
  locationId: string
  quantity: number | null
  status: StockStatus
  lastCheckedAt: string | null
  notes: string
}

export interface LocationInput {
  id?: string
  parentId: string | null
  kind: string
  name: string
  code: string
  description: string
  sort: number
}

export interface ProcessedPhoto {
  full: Blob
  thumb: Blob
  /** small JPEG data URL used only for AI suggestions; never stored */
  aiDataUrl: string
  previewUrl: string
}

export interface PhotoSuggestion {
  name: string | null
  category: string | null
  description: string | null
  visibleMarkings: string[]
  ambiguous: boolean
  ambiguityNote: string | null
  confidence: 'high' | 'medium' | 'low'
}

export interface ImportItem {
  part: {
    id?: string
    name: string
    value: string
    part_number: string
    manufacturer: string
    package: string
    aliases: string[]
    description: string
    datasheet_url: string
    published: boolean
  }
  category: string
  stock: Array<{
    location_id: string
    quantity: number | null
    status: StockStatus
    last_checked_at: string | null
    notes: string
  }>
}

export class AppError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}
