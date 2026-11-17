import type {
  AppUser, Catalog, CommunityPost, Member, PhotoDraft, PostKind, PostStatus, ReviewStatus, Role, ImportItem, LocationInput, Part, PartInput, PartPhoto, PhotoSuggestion, ProcessedPhoto,
  RequestStatus, RestockRequest, StaffUser, StockInput,
} from '../lib/types'

export interface RestockSubmission {
  partId: string
  locationId: string | null
  note: string
  requesterName: string
  requesterContact: string
}

export interface ImportResult {
  locations: number
  parts: number
  deduplicated: number
  already_present: number
}

export interface PartRequestSubmission {
  requestedPart: string
  note: string
  requesterName: string
  requesterContact: string
}

export interface PostSubmission {
  kind: PostKind
  title: string
  body: string
  authorName: string
}

/**
 * Everything the UI needs from storage. Two implementations:
 * - SupabaseBackend: Postgres + RLS, Storage, Edge Function (production)
 * - DemoBackend: in-browser fictional data for the local preview
 */
export interface Backend {
  mode: 'demo' | 'supabase'

  // public
  getCatalog(): Promise<Catalog>
  submitRestock(input: RestockSubmission): Promise<{ id: string; status: 'created' | 'duplicate' }>
  submitPartRequest(input: PartRequestSubmission): Promise<{ id: string; status: 'created' | 'duplicate' }>
  /** approved posts for the public; staff get every post */
  listPosts(): Promise<CommunityPost[]>
  submitPost(input: PostSubmission): Promise<{ id: string; status: 'pending' }>

  // auth: BC email + one-time code (no passwords)
  getUser(): Promise<AppUser | null>
  /** the signed-in user if they are staff or admin */
  getStaff(): Promise<StaffUser | null>
  sendSignInCode(email: string): Promise<{ demoCode?: string }>
  verifySignInCode(email: string, code: string): Promise<AppUser>
  updateDisplayName(name: string): Promise<void>
  signOut(): Promise<void>
  onAuthChange(cb: () => void): () => void
  /** subscribe to inventory changes from elsewhere (other tabs / other staff) */
  onCatalogChange(cb: () => void): () => void

  // staff
  savePart(input: PartInput): Promise<Part>
  deletePart(id: string): Promise<void>
  setStock(input: StockInput): Promise<void>
  removeStock(partId: string, locationId: string): Promise<void>
  moveStock(partId: string, fromId: string, toId: string, quantity: number | null): Promise<void>
  addPartPhoto(partId: string, photo: ProcessedPhoto, publish: boolean): Promise<PartPhoto>
  updatePartPhoto(photo: PartPhoto, changes: { published?: boolean; isPrimary?: boolean }): Promise<void>
  deletePartPhoto(photo: PartPhoto): Promise<void>
  saveLocation(input: LocationInput): Promise<string>
  deleteLocation(id: string): Promise<void>
  setLocationPhoto(locationId: string, photo: ProcessedPhoto | null): Promise<void>
  listRequests(): Promise<RestockRequest[]>
  updateRequest(id: string, status: RequestStatus, resolutionNote?: string): Promise<void>
  moderatePost(id: string, status: PostStatus): Promise<void>
  // admin only
  listMembers(): Promise<Member[]>
  setMemberRole(userId: string, role: Role): Promise<void>
  deletePost(id: string): Promise<void>
  importItems(items: ImportItem[]): Promise<{ created: number; updated: number; stock: number }>
  // photo inventory review
  /** the draft generated in this repo (dev server only); null when not available */
  fetchBundledDraft(): Promise<PhotoDraft | null>
  importPhotoDraft(draft: PhotoDraft): Promise<ImportResult>
  setReviewStatus(partId: string, status: ReviewStatus, publish?: boolean): Promise<void>
  mergeParts(fromId: string, intoId: string): Promise<void>
  markLocationReviewed(locationId: string): Promise<void>
  /** URL for an original workspace photo (e.g. 'IMG_1024.HEIC'); staff only */
  evidencePhotoUrl(file: string, size: 'thumb' | 'web'): Promise<string | null>
  suggestFromPhoto(aiDataUrl: string, categories: string[]): Promise<PhotoSuggestion>
}
