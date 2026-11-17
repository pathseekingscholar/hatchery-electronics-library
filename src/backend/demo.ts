// Local demo backend: fictional data stored in this browser (localStorage + IndexedDB for photos).
// It mirrors the server rules (staff-only writes, request validation, de-duplication, rate
// limits) so the UI behaves like production, but it is NOT a security boundary — the real
// enforcement lives in supabase/migrations (RLS + RPCs) and is tested in supabase/tests.
import type {
  AppUser, Catalog, CommunityPost, LocationEvidence, Member, PhotoDraft, PostStatus, ReviewStatus, Role, ImportItem, LocationInput, Part, PartInput, PartPhoto, PhotoSuggestion, ProcessedPhoto,
  RequestStatus, RestockRequest, StaffUser, StockInput,
} from '../lib/types'
import { AppError } from '../lib/types'
import { childrenOf } from '../lib/locations'
import type { Backend, ImportResult, PartRequestSubmission, PostSubmission, RestockSubmission } from './types'
import { makeDemoCatalog, makeDemoPosts, makeDemoUsers } from './demoSeed'
import { isAllowedEmail } from '../lib/bcEmail'
import { CATALOG_ONLY } from '../lib/release'

// v2: the live catalog is the photo inventory (the fictional v1 sample parts are retired)
const STATE_KEY = 'hatchery-demo-v2'
const SESSION_KEY = 'hatchery-demo-session'
/** Fictional demo accounts. In the demo the sign-in code is shown on screen instead of emailed. */
export const DEMO_ACCOUNTS = [
  { email: 'demo-admin@bc.edu', label: 'Admin' },
  { email: 'demo-staff@bc.edu', label: 'Staff' },
  { email: 'demo-student@bc.edu', label: 'Student' },
]

interface DemoState {
  catalog: Catalog
  requests: RestockRequest[]
  submissions: number[]
  posts?: Array<CommunityPost & { authorId?: string }>
  users?: Member[]
  /** 'photo-draft' once the real Hatchery photo inventory has been loaded */
  source?: 'fictional' | 'photo-draft'
  locationEvidence?: Record<string, LocationEvidence>
  /** who changed what (mirrors inventory_events in the database) */
  audit?: Array<{ at: string; by: string | null; partId: string | null; kind: string; detail: Record<string, unknown> }>
}

function audit(state: DemoState, partId: string | null, kind: string, detail: Record<string, unknown>) {
  state.audit ??= []
  state.audit.push({ at: now(), by: currentUser(state)?.displayName ?? null, partId, kind, detail })
  if (state.audit.length > 2000) state.audit.splice(0, state.audit.length - 2000)
}

/** Older saved demo data predates the review fields. */
function upgrade(state: DemoState) {
  for (const p of state.catalog.parts) {
    p.itemType ??= 'component'
    p.reviewStatus ??= 'verified'
    p.reviewReasons ??= []
    p.evidence ??= null
    p.verifiedAt ??= null
    p.verifiedByName ??= null
    p.mergedInto ??= null
  }
  for (const l of state.catalog.locations) {
    l.reviewedAt ??= null
    l.reviewedByName ??= null
  }
  state.source ??= 'fictional'
}

const wait = (ms = 120) => new Promise((r) => setTimeout(r, ms))
const now = () => new Date().toISOString()
const uid = () => crypto.randomUUID()

// ---- photo blobs in IndexedDB
function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('hatchery-demo-photos', 1)
    req.onupgradeneeded = () => req.result.createObjectStore('blobs')
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}
async function putBlob(path: string, blob: Blob) {
  const db = await idb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('blobs', 'readwrite')
    tx.objectStore('blobs').put(blob, path)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}
async function getBlob(path: string): Promise<Blob | undefined> {
  const db = await idb()
  return new Promise((resolve) => {
    const req = db.transaction('blobs').objectStore('blobs').get(path)
    req.onsuccess = () => resolve(req.result as Blob | undefined)
    req.onerror = () => resolve(undefined)
  })
}
async function deleteBlob(path: string) {
  const db = await idb()
  db.transaction('blobs', 'readwrite').objectStore('blobs').delete(path)
}
const urlCache = new Map<string, string>()
async function blobUrl(path: string | null): Promise<string> {
  if (!path) return ''
  if (urlCache.has(path)) return urlCache.get(path)!
  const blob = await getBlob(path)
  if (!blob) return ''
  const url = URL.createObjectURL(blob)
  urlCache.set(path, url)
  return url
}

function load(): DemoState {
  try {
    const raw = localStorage.getItem(STATE_KEY)
    if (raw) {
      const state = JSON.parse(raw) as DemoState
      state.posts ??= makeDemoPosts()
      state.users ??= makeDemoUsers()
      upgrade(state)
      return state
    }
  } catch {
    // fall through to a fresh seed
  }
  const fresh: DemoState = { catalog: makeDemoCatalog(), requests: [], submissions: [], posts: makeDemoPosts(), users: makeDemoUsers(), source: 'fictional' }
  save(fresh)
  return fresh
}
function save(state: DemoState) {
  localStorage.setItem(STATE_KEY, JSON.stringify(state))
}
/** Same budget as the server: 5 public submissions per 10 minutes from this device. */
function claimSubmission(state: DemoState) {
  const cutoff = Date.now() - 10 * 60_000
  state.submissions = state.submissions.filter((t) => t > cutoff)
  if (state.submissions.length >= 5) {
    throw new AppError('rate_limited', 'Too many submissions from this device. Try again in a few minutes.')
  }
  state.submissions.push(Date.now())
}

/** Catalog-only builds have no shared database: never pretend a submission or sign-in worked. */
function blockInCatalogOnly() {
  if (CATALOG_ONLY) throw new AppError('coming_soon', 'This feature is coming in a later version.')
}

function currentUser(state = load()): Member | null {
  const id = localStorage.getItem(SESSION_KEY)
  return (id && state.users?.find((u) => u.id === id)) || null
}
function isStaff() {
  const u = currentUser()
  return Boolean(u && u.role !== 'member')
}
function requireStaff() {
  if (!isStaff()) throw new AppError('forbidden', 'Staff sign-in required.')
}
function requireAdmin() {
  if (currentUser()?.role !== 'admin') throw new AppError('forbidden', 'Admin access required.')
}
const toAppUser = (u: Member): AppUser => ({ id: u.id, email: u.email, displayName: u.displayName, role: u.role })

// Review methods are attached below via the prototype; declared here for the type checker.
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export interface DemoBackend {
  fetchBundledDraft: Backend['fetchBundledDraft']
  importPhotoDraft: Backend['importPhotoDraft']
  setReviewStatus: Backend['setReviewStatus']
  mergeParts: Backend['mergeParts']
  markLocationReviewed: Backend['markLocationReviewed']
  evidencePhotoUrl: Backend['evidencePhotoUrl']
}
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export class DemoBackend implements Backend {
  mode = 'demo' as const
  private authListeners = new Set<() => void>()
  private codes = new Map<string, string>()

  async getCatalog(): Promise<Catalog> {
    await wait()
    await ensurePhotoInventory()
    const state = load()
    const { catalog } = state
    const staff = isStaff()
    const parts = catalog.parts.filter((p) => staff || (p.published && p.reviewStatus !== 'rejected'))
    const resolved: Part[] = await Promise.all(
      parts.map(async (p) => ({
        ...p,
        photos: await Promise.all(
          p.photos
            .filter((ph) => staff || ph.published)
            .map(async (ph) => ({ ...ph, fullUrl: await blobUrl(ph.fullPath), thumbUrl: await blobUrl(ph.thumbPath) })),
        ),
      })),
    )
    const locations = await Promise.all(
      catalog.locations.map(async (l) => ({ ...l, photoUrl: (await blobUrl(l.photoPath)) || null, thumbUrl: (await blobUrl(l.thumbPath)) || null })),
    )
    return {
      categories: catalog.categories,
      locations,
      parts: resolved,
      ...(staff ? { locationEvidence: state.locationEvidence ?? {} } : {}),
    }
  }

  isPhotoDraftLoaded() {
    return load().source === 'photo-draft'
  }

  async submitRestock(input: RestockSubmission) {
    blockInCatalogOnly()
    await wait()
    const state = load()
    const note = input.note.trim()
    if (note.length > 500 || input.requesterName.trim().length > 80 || input.requesterContact.trim().length > 120) {
      throw new AppError('invalid_input', 'That message is too long.')
    }
    const part = state.catalog.parts.find((p) => p.id === input.partId && p.published)
    if (!part) throw new AppError('invalid_input', 'That part is not in the catalog.')
    if (input.locationId && !part.stock.some((s) => s.locationId === input.locationId)) {
      throw new AppError('invalid_input', 'That part is not stocked at that location.')
    }
    claimSubmission(state)
    const open = state.requests.find(
      (r) => r.partId === input.partId && r.locationId === (input.locationId ?? null) && (r.status === 'open' || r.status === 'acknowledged'),
    )
    if (open) {
      open.requestCount += 1
      open.updatedAt = now()
      if (!open.note && note) open.note = note
      save(state)
      return { id: open.id, status: 'duplicate' as const }
    }
    const request: RestockRequest = {
      id: uid(), partId: input.partId, requestedPart: '', locationId: input.locationId ?? null, status: 'open', note,
      requesterName: input.requesterName.trim(), requesterContact: input.requesterContact.trim(),
      requestCount: 1, createdAt: now(), updatedAt: now(), acknowledgedAt: null, resolvedAt: null, resolutionNote: '',
    }
    state.requests.unshift(request)
    save(state)
    return { id: request.id, status: 'created' as const }
  }

  async submitPartRequest(input: PartRequestSubmission) {
    blockInCatalogOnly()
    await wait()
    const state = load()
    const name = input.requestedPart.trim().replace(/\s+/g, ' ')
    if (name.length < 2 || name.length > 120) throw new AppError('invalid_input', 'Describe the part in 2–120 characters.')
    if (input.note.trim().length > 500 || input.requesterName.trim().length > 80 || input.requesterContact.trim().length > 120) {
      throw new AppError('invalid_input', 'That message is too long.')
    }
    claimSubmission(state)
    const open = state.requests.find(
      (r) => !r.partId && r.requestedPart.toLowerCase() === name.toLowerCase() && (r.status === 'open' || r.status === 'acknowledged'),
    )
    if (open) {
      open.requestCount += 1
      open.updatedAt = now()
      save(state)
      return { id: open.id, status: 'duplicate' as const }
    }
    const request: RestockRequest = {
      id: uid(), partId: null, requestedPart: name, locationId: null, status: 'open', note: input.note.trim(),
      requesterName: input.requesterName.trim(), requesterContact: input.requesterContact.trim(),
      requestCount: 1, createdAt: now(), updatedAt: now(), acknowledgedAt: null, resolvedAt: null, resolutionNote: '',
    }
    state.requests.unshift(request)
    save(state)
    return { id: request.id, status: 'created' as const }
  }

  async listPosts(): Promise<CommunityPost[]> {
    await wait()
    const state = load()
    const me = currentUser(state)
    const staff = Boolean(me && me.role !== 'member')
    return (state.posts ?? [])
      .filter((p) => staff || p.status === 'approved' || (me && p.authorId === me.id))
      .map((p) => ({ id: p.id, kind: p.kind, title: p.title, body: p.body, authorName: p.authorName, status: p.status, createdAt: p.createdAt })) // author ids stay private
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }
  async submitPost(input: PostSubmission) {
    blockInCatalogOnly()
    await wait()
    const state = load()
    const me = currentUser(state)
    if (!me) throw new AppError('auth_required', 'Sign in with your BC email to post.')
    const title = input.title.trim()
    const body = input.body.trim()
    if (!['project', 'question', 'tip'].includes(input.kind)) throw new AppError('invalid_input', 'Unknown post type.')
    if (title.length < 3 || title.length > 120) throw new AppError('invalid_input', 'Title must be 3–120 characters.')
    if (!body || body.length > 4000) throw new AppError('invalid_input', 'Post must be 1–4000 characters.')
    if (input.authorName.trim().length > 80) throw new AppError('invalid_input', 'Name is too long.')
    claimSubmission(state)
    const post = { id: uid(), kind: input.kind, title, body, authorName: input.authorName.trim(), status: 'pending' as const, createdAt: now(), authorId: me.id }
    state.posts = [post, ...(state.posts ?? [])]
    save(state)
    return { id: post.id, status: 'pending' as const }
  }
  async moderatePost(id: string, status: PostStatus) {
    await wait()
    this.mutate((state) => {
      const post = state.posts?.find((p) => p.id === id)
      if (!post) throw new AppError('not_found', 'Post not found.')
      post.status = status
    })
  }
  async deletePost(id: string) {
    await wait()
    this.mutate((state) => {
      state.posts = (state.posts ?? []).filter((p) => p.id !== id)
    })
  }

  async getUser(): Promise<AppUser | null> {
    const u = currentUser()
    return u ? toAppUser(u) : null
  }
  async getStaff(): Promise<StaffUser | null> {
    const u = currentUser()
    return u && u.role !== 'member' ? { id: u.id, email: u.email, displayName: u.displayName, role: u.role } : null
  }
  async sendSignInCode(email: string) {
    blockInCatalogOnly()
    await wait(300)
    const e = email.trim().toLowerCase()
    if (!isAllowedEmail(e)) throw new AppError('invalid_input', 'Use your @bc.edu email address.')
    const code = String(100000 + Math.floor(Math.random() * 900000))
    this.codes.set(e, code)
    return { demoCode: code }
  }
  async verifySignInCode(email: string, code: string) {
    await wait(300)
    const e = email.trim().toLowerCase()
    if (!code.trim() || this.codes.get(e) !== code.trim()) throw new AppError('auth', 'That code is wrong or expired.')
    this.codes.delete(e)
    const state = load()
    state.users ??= []
    let user = state.users.find((u) => u.email === e)
    if (!user) {
      user = { id: uid(), email: e, displayName: e.split('@')[0], role: 'member', createdAt: now() }
      state.users.push(user)
      save(state)
    }
    localStorage.setItem(SESSION_KEY, user.id)
    this.authListeners.forEach((cb) => cb())
    return toAppUser(user)
  }
  async updateDisplayName(name: string) {
    await wait()
    const state = load()
    const me = currentUser(state)
    if (!me) throw new AppError('auth_required', 'Sign in first.')
    if (name.trim().length > 60) throw new AppError('invalid_input', 'Name is too long.')
    me.displayName = name.trim()
    save(state)
    this.authListeners.forEach((cb) => cb())
  }
  async listMembers(): Promise<Member[]> {
    await wait()
    requireAdmin()
    return [...(load().users ?? [])].sort((a, b) => a.email.localeCompare(b.email))
  }
  async setMemberRole(userId: string, role: Role) {
    await wait()
    requireAdmin()
    const state = load()
    const me = currentUser(state)!
    if (userId === me.id && role !== 'admin') throw new AppError('invalid_input', 'You can’t remove your own admin access.')
    const user = state.users?.find((u) => u.id === userId)
    if (!user) throw new AppError('invalid_input', 'Unknown account.')
    user.role = role
    save(state)
  }
  async signOut() {
    localStorage.removeItem(SESSION_KEY)
    this.authListeners.forEach((cb) => cb())
  }
  onAuthChange(cb: () => void) {
    this.authListeners.add(cb)
    const onStorage = (e: StorageEvent) => e.key === SESSION_KEY && cb()
    window.addEventListener('storage', onStorage)
    return () => {
      this.authListeners.delete(cb)
      window.removeEventListener('storage', onStorage)
    }
  }
  onCatalogChange(cb: () => void) {
    const onStorage = (e: StorageEvent) => e.key === STATE_KEY && cb()
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }

  private mutate<T>(fn: (state: DemoState) => T): T {
    requireStaff()
    const state = load()
    const result = fn(state)
    save(state)
    return result
  }

  async savePart(input: PartInput): Promise<Part> {
    await wait()
    if (!input.name.trim()) throw new AppError('invalid_input', 'Name is required.')
    return this.mutate((state) => {
      const me = currentUser(state)
      const existing = input.id ? state.catalog.parts.find((p) => p.id === input.id) : undefined
      // Staff typing a part in by hand have it in front of them: new manual parts count as verified.
      const reviewStatus: ReviewStatus = input.reviewStatus ?? existing?.reviewStatus ?? 'verified'
      const stamp = (wasVerified: boolean) =>
        reviewStatus === 'verified' && !wasVerified
          ? { verifiedAt: now(), verifiedByName: me?.displayName ?? null, reviewReasons: [] }
          : reviewStatus !== 'verified' ? { verifiedAt: null, verifiedByName: null } : {}
      if (existing) {
        const changed: Record<string, unknown> = {}
        for (const k of ['name', 'categoryId', 'value', 'partNumber', 'manufacturer', 'package', 'description', 'published', 'itemType'] as const) {
          if (input[k] !== undefined && JSON.stringify(input[k]) !== JSON.stringify(existing[k])) changed[k] = { from: existing[k], to: input[k] }
        }
        if (reviewStatus !== existing.reviewStatus) changed.reviewStatus = { from: existing.reviewStatus, to: reviewStatus }
        Object.assign(existing, input, { reviewStatus, updatedAt: now() }, stamp(existing.reviewStatus === 'verified'))
        if (Object.keys(changed).length) audit(state, existing.id, 'edit', changed)
        return existing
      }
      const part: Part = {
        ...input, itemType: input.itemType ?? 'component', reviewStatus, reviewReasons: [], evidence: null, verifiedAt: null, verifiedByName: null,
        mergedInto: null, id: uid(), createdAt: now(), updatedAt: now(), photos: [], stock: [], ...stamp(false),
      }
      audit(state, part.id, 'create', { name: part.name })
      state.catalog.parts.unshift(part)
      return part
    })
  }
  async deletePart(id: string) {
    await wait()
    const photos = this.mutate((state) => {
      const part = state.catalog.parts.find((p) => p.id === id)
      state.catalog.parts = state.catalog.parts.filter((p) => p.id !== id)
      state.requests = state.requests.filter((r) => r.partId !== id)
      return part?.photos ?? []
    })
    for (const ph of photos) {
      await deleteBlob(ph.fullPath)
      await deleteBlob(ph.thumbPath)
    }
  }
  async setStock(input: StockInput) {
    await wait()
    this.mutate((state) => {
      const part = state.catalog.parts.find((p) => p.id === input.partId)
      if (!part) throw new AppError('not_found', 'Part not found.')
      let status = input.status
      if (input.quantity !== null) status = input.quantity === 0 ? 'out' : status === 'out' || status === 'unverified' ? 'in_stock' : status
      const entry = part.stock.find((s) => s.locationId === input.locationId)
      const checkedByName = currentUser(state)?.displayName ?? null
      if (entry && (entry.quantity !== input.quantity || entry.status !== status)) {
        audit(state, part.id, 'stock', { locationId: input.locationId, quantity: { from: entry.quantity, to: input.quantity }, status: { from: entry.status, to: status } })
      }
      if (entry) Object.assign(entry, { ...input, status, checkedByName })
      else part.stock.push({ id: uid(), ...input, status, checkedByName })
      part.updatedAt = now()
    })
  }
  async removeStock(partId: string, locationId: string) {
    await wait()
    this.mutate((state) => {
      const part = state.catalog.parts.find((p) => p.id === partId)
      if (part) part.stock = part.stock.filter((s) => s.locationId !== locationId)
    })
  }
  async moveStock(partId: string, fromId: string, toId: string, quantity: number | null) {
    await wait()
    if (fromId === toId) throw new AppError('invalid_input', 'Pick a different destination.')
    this.mutate((state) => {
      const part = state.catalog.parts.find((p) => p.id === partId)
      const src = part?.stock.find((s) => s.locationId === fromId)
      if (!part || !src) throw new AppError('invalid_input', 'Nothing stocked at the source location.')
      const dst = part.stock.find((s) => s.locationId === toId)
      if (quantity === null) {
        if (!dst) src.locationId = toId
        else {
          const both = src.quantity !== null && dst.quantity !== null
          dst.quantity = both ? src.quantity! + dst.quantity! : null
          dst.status = both ? 'in_stock' : 'unverified'
          part.stock = part.stock.filter((s) => s !== src)
        }
      } else {
        if (src.quantity === null) throw new AppError('invalid_input', 'This location is not counted; move the whole entry instead.')
        if (quantity <= 0 || quantity > src.quantity) throw new AppError('invalid_input', `Enter a number from 1 to ${src.quantity}.`)
        src.quantity -= quantity
        src.status = src.quantity === 0 ? 'out' : src.status
        src.lastCheckedAt = now()
        if (!dst) part.stock.push({ id: uid(), partId, locationId: toId, quantity, status: 'in_stock', lastCheckedAt: now(), notes: '' })
        else if (dst.quantity === null) Object.assign(dst, { status: 'in_stock', lastCheckedAt: now() })
        else Object.assign(dst, { quantity: dst.quantity + quantity, status: 'in_stock', lastCheckedAt: now() })
      }
      part.updatedAt = now()
    })
  }

  async addPartPhoto(partId: string, photo: ProcessedPhoto, publish: boolean): Promise<PartPhoto> {
    requireStaff()
    const id = uid()
    const base = `parts/${partId}/${id}`
    await putBlob(`${base}/full`, photo.full)
    await putBlob(`${base}/thumb`, photo.thumb)
    return this.mutate((state) => {
      const part = state.catalog.parts.find((p) => p.id === partId)
      if (!part) throw new AppError('not_found', 'Part not found.')
      const record: PartPhoto = {
        id, partId, fullPath: `${base}/full`, thumbPath: `${base}/thumb`, fullUrl: '', thumbUrl: '',
        published: publish, isPrimary: part.photos.length === 0, createdAt: now(),
      }
      part.photos.push(record)
      part.updatedAt = now()
      return record
    })
  }
  async updatePartPhoto(photo: PartPhoto, changes: { published?: boolean; isPrimary?: boolean }) {
    await wait()
    this.mutate((state) => {
      const part = state.catalog.parts.find((p) => p.id === photo.partId)
      if (!part) return
      for (const ph of part.photos) {
        if (changes.isPrimary) ph.isPrimary = ph.id === photo.id
        if (ph.id === photo.id && changes.published !== undefined) ph.published = changes.published
      }
      part.updatedAt = now()
    })
  }
  async deletePartPhoto(photo: PartPhoto) {
    this.mutate((state) => {
      const part = state.catalog.parts.find((p) => p.id === photo.partId)
      if (!part) return
      part.photos = part.photos.filter((ph) => ph.id !== photo.id)
      if (part.photos.length && !part.photos.some((ph) => ph.isPrimary)) part.photos[0].isPrimary = true
    })
    await deleteBlob(photo.fullPath)
    await deleteBlob(photo.thumbPath)
  }

  async saveLocation(input: LocationInput): Promise<string> {
    await wait()
    if (!input.name.trim() || !input.code.trim()) throw new AppError('invalid_input', 'Name and label code are required.')
    return this.mutate((state) => {
      const clash = state.catalog.locations.find((l) => l.code.toLowerCase() === input.code.trim().toLowerCase() && l.id !== input.id)
      if (clash) throw new AppError('invalid_input', `Label code ${input.code} is already used by ${clash.name}.`)
      if (input.id && input.parentId) {
        // prevent cycles
        let cursor: string | null = input.parentId
        while (cursor) {
          if (cursor === input.id) throw new AppError('invalid_input', 'A location cannot be inside itself.')
          cursor = state.catalog.locations.find((l) => l.id === cursor)?.parentId ?? null
        }
      }
      const existing = input.id ? state.catalog.locations.find((l) => l.id === input.id) : undefined
      if (existing) {
        Object.assign(existing, { ...input, code: input.code.trim() })
        return existing.id
      }
      const id = uid()
      state.catalog.locations.push({
        ...input, id, code: input.code.trim(), photoUrl: null, thumbUrl: null, photoPath: null, thumbPath: null,
        reviewedAt: null, reviewedByName: null,
      })
      return id
    })
  }
  async deleteLocation(id: string) {
    await wait()
    this.mutate((state) => {
      if (childrenOf(id, state.catalog.locations).length) throw new AppError('invalid_input', 'Move or delete the locations inside it first.')
      if (state.catalog.parts.some((p) => p.stock.some((s) => s.locationId === id))) {
        throw new AppError('invalid_input', 'Parts are still stocked here. Move them first.')
      }
      state.catalog.locations = state.catalog.locations.filter((l) => l.id !== id)
    })
  }
  async setLocationPhoto(locationId: string, photo: ProcessedPhoto | null) {
    requireStaff()
    const base = `locations/${locationId}/${uid()}`
    if (photo) {
      await putBlob(`${base}/full`, photo.full)
      await putBlob(`${base}/thumb`, photo.thumb)
    }
    this.mutate((state) => {
      const loc = state.catalog.locations.find((l) => l.id === locationId)
      if (!loc) throw new AppError('not_found', 'Location not found.')
      loc.photoPath = photo ? `${base}/full` : null
      loc.thumbPath = photo ? `${base}/thumb` : null
    })
  }

  async listRequests() {
    await wait()
    requireStaff()
    return load().requests
  }
  async updateRequest(id: string, status: RequestStatus, resolutionNote = '') {
    await wait()
    this.mutate((state) => {
      const r = state.requests.find((x) => x.id === id)
      if (!r) throw new AppError('not_found', 'Request not found.')
      r.status = status
      r.updatedAt = now()
      if (status === 'acknowledged') r.acknowledgedAt = now()
      if (status === 'resolved' || status === 'dismissed') {
        r.resolvedAt = now()
        r.resolutionNote = resolutionNote.slice(0, 500)
      }
    })
  }

  async importItems(items: ImportItem[]) {
    await wait(300)
    return this.mutate((state) => {
      // validate everything first so the import is all-or-nothing
      for (const item of items) {
        if (!item.part.name) throw new AppError('invalid_input', 'Every part needs a name.')
        if (item.part.id && !state.catalog.parts.some((p) => p.id === item.part.id)) throw new AppError('invalid_input', `Unknown part ${item.part.id}`)
      }
      let created = 0
      let updated = 0
      let stock = 0
      for (const item of items) {
        let categoryId: string | null = null
        if (item.category) {
          let cat = state.catalog.categories.find((c) => c.name.toLowerCase() === item.category.toLowerCase())
          if (!cat) {
            cat = { id: uid(), name: item.category, sort: 999 }
            state.catalog.categories.push(cat)
          }
          categoryId = cat.id
        }
        const fields = {
          name: item.part.name, value: item.part.value, partNumber: item.part.part_number,
          manufacturer: item.part.manufacturer, package: item.part.package, aliases: item.part.aliases,
          description: item.part.description, datasheetUrl: item.part.datasheet_url, published: item.part.published,
        }
        let part = item.part.id ? state.catalog.parts.find((p) => p.id === item.part.id) : undefined
        if (part) {
          Object.assign(part, fields, { categoryId: categoryId ?? part.categoryId, updatedAt: now() })
          updated++
        } else {
          const newPart: Part = {
            ...fields, id: uid(), categoryId, createdAt: now(), updatedAt: now(), photos: [], stock: [],
            itemType: 'component', reviewStatus: 'verified', reviewReasons: [], evidence: null, verifiedAt: now(), verifiedByName: null, mergedInto: null,
          }
          part = newPart
          state.catalog.parts.unshift(newPart)
          created++
        }
        for (const s of item.stock) {
          const entry = part.stock.find((x) => x.locationId === s.location_id)
          const next = { quantity: s.quantity, status: s.status, lastCheckedAt: s.last_checked_at, notes: s.notes }
          if (entry) Object.assign(entry, next)
          else part.stock.push({ id: uid(), partId: part.id, locationId: s.location_id, ...next })
          stock++
        }
      }
      return { created, updated, stock }
    })
  }

  async suggestFromPhoto(aiDataUrl: string, categories: string[]): Promise<PhotoSuggestion> {
    requireStaff()
    let res: Response
    try {
      res = await fetch('/__dev/suggest-part', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: aiDataUrl, categories }),
      })
    } catch {
      throw new AppError('ai_unavailable', 'Photo suggestions are unavailable. Enter details manually.')
    }
    const body = await res.json().catch(() => null)
    if (!res.ok || !body?.suggestion) {
      throw new AppError(body?.code ?? 'ai_unconfigured', body?.message ?? 'Photo suggestions are not configured in this preview. Enter details manually.')
    }
    return body.suggestion as PhotoSuggestion
  }
}


// ---------------------------------------------------------------- photo inventory review (demo)
const DRAFT_URL = '/__dev/inventory/inventory-draft.json'

/**
 * Load the photo inventory into demo state. Idempotent: locations match on code, records on draft_id
 * (or a record they were folded into). Records staff have touched are never overwritten.
 */
function applyPhotoDraft(state: DemoState, draft: PhotoDraft): ImportResult {
  if (state.source !== 'photo-draft') {
    // The fictional sample catalog is retired: every live result must point at a real drawer.
    state.catalog.parts = []
    state.catalog.locations = []
    state.requests = []
    state.locationEvidence = {}
    state.source = 'photo-draft'
  }
  state.locationEvidence ??= {}
  const idByDraft = new Map<string, string>()
  const result: ImportResult = { locations: 0, parts: 0, deduplicated: 0, already_present: 0 }
  for (const l of draft.locations) {
    let loc = state.catalog.locations.find((x) => x.code === l.code)
    if (!loc) {
      loc = {
        id: uid(), parentId: l.parent_id ? idByDraft.get(l.parent_id) ?? null : null, kind: l.kind, name: l.name.slice(0, 80),
        code: l.code, description: '', sort: l.order ?? 0, photoUrl: null, thumbUrl: null, photoPath: null, thumbPath: null,
        reviewedAt: null, reviewedByName: null,
      }
      state.catalog.locations.push(loc)
      result.locations++
    }
    idByDraft.set(l.id, loc.id)
    const prev = state.locationEvidence[loc.id]
    state.locationEvidence[loc.id] = {
      draftId: l.id, frontLabel: l.front_label, observedState: l.observed_state ?? prev?.observedState ?? null,
      confidence: l.identification_confidence,
      photos: l.source_images?.length ? l.source_images : prev?.photos ?? [],
      opportunities: l.opportunities?.length
        ? l.opportunities.map((o) => ({ id: o.id, kind: o.kind, description: o.description, state: o.state, needsConfirmation: o.needs_confirmation, photos: o.source_images }))
        : prev?.opportunities ?? [],
    }
  }
  const byDraft = (id: string) => state.catalog.parts.find((p) => p.evidence?.draftId === id || p.evidence?.alsoSeen?.includes(id))
  for (const it of draft.items) {
    let part = byDraft(it.duplicate_of ?? it.draft_id)
    if (it.duplicate_of && part) {
      if (part.evidence && !part.evidence.alsoSeen?.includes(it.draft_id)) {
        part.evidence.alsoSeen = [...(part.evidence.alsoSeen ?? []), it.draft_id]
        result.deduplicated++
      }
    } else if (part) {
      result.already_present++
      // refresh evidence photos if a fuller draft arrives later; never touch staff-reviewed fields
      if (part.evidence && !part.evidence.photos.length && it.source_images.length) part.evidence.photos = it.source_images
    } else {
      let cat = state.catalog.categories.find((c) => c.name.toLowerCase() === it.category.toLowerCase())
      if (!cat) {
        cat = { id: uid(), name: it.category, sort: 999 }
        state.catalog.categories.push(cat)
      }
      part = {
        id: uid(), name: it.name.slice(0, 120), categoryId: cat.id, value: '', partNumber: it.part_number ?? '',
        manufacturer: it.manufacturer ?? '', package: '', aliases: [], description: it.description, datasheetUrl: '',
        published: it.searchable, createdAt: now(), updatedAt: now(), photos: [], stock: [], itemType: it.item_type,
        reviewStatus: it.catalog_status, reviewReasons: it.review_reasons ?? [], verifiedAt: null, verifiedByName: null, mergedInto: null,
        evidence: {
          draftId: it.draft_id, confidence: it.identification_confidence, labelText: it.label_text, photos: it.source_images,
          visibleQty: it.quantity.visible_in_photo, qtyNote: it.quantity.note, container: it.location.container,
          isAssortment: it.is_assortment, contentsUnknown: it.contents_unknown, possibleDuplicateOf: it.possible_duplicate_of,
          specifications: it.specifications ?? {}, snapshot: it.snapshot, alsoSeen: [],
        },
      }
      state.catalog.parts.push(part)
      result.parts++
    }
    // most specific known location; stock starts Unverified with no count
    const locationId = idByDraft.get(it.location.id)
    if (locationId && !part.stock.some((s) => s.locationId === locationId)) {
      part.stock.push({
        id: uid(), partId: part.id, locationId, quantity: null, status: 'unverified', lastCheckedAt: null,
        notes: (it.location.container ?? '').slice(0, 300), checkedByName: null,
      })
    }
  }
  audit(state, null, 'photo_inventory_import', { ...result })
  return result
}

async function fetchFullDraft(): Promise<PhotoDraft | null> {
  // Only the local dev server serves the repo's draft file (with staff-only evidence).
  if (!import.meta.env.DEV) return null
  try {
    const res = await fetch(DRAFT_URL)
    if (!res.ok || !res.headers.get('content-type')?.includes('json')) return null
    return (await res.json()) as PhotoDraft
  } catch {
    return null
  }
}

let seeding: Promise<void> | null = null
/** First run: load the photo inventory (full draft on the dev server, public fields otherwise). */
async function ensurePhotoInventory() {
  if (load().source === 'photo-draft') return
  seeding ??= (async () => {
    const draft = (await fetchFullDraft()) ?? ((await import('../data/photo-inventory.public.json')).default as unknown as PhotoDraft)
    const state = load()
    if (state.source !== 'photo-draft') {
      applyPhotoDraft(state, draft)
      save(state)
    }
  })().finally(() => {
    seeding = null
  })
  await seeding
}

DemoBackend.prototype.fetchBundledDraft = fetchFullDraft

DemoBackend.prototype.importPhotoDraft = async function (draft: PhotoDraft) {
  requireStaff()
  await wait(300)
  const state = load()
  const result = applyPhotoDraft(state, draft)
  save(state)
  return result
}

DemoBackend.prototype.setReviewStatus = async function (partId: string, status: ReviewStatus, publish?: boolean) {
  await wait()
  requireStaff()
  const state = load()
  const part = state.catalog.parts.find((p) => p.id === partId)
  if (!part) throw new AppError('not_found', 'Part not found.')
  const before = { status: part.reviewStatus, published: part.published }
  if (status === 'verified' && part.reviewStatus !== 'verified') {
    part.verifiedAt = now()
    part.verifiedByName = currentUser(state)?.displayName ?? null
    part.reviewReasons = []
  }
  if (status !== 'verified') {
    part.verifiedAt = null
    part.verifiedByName = null
  }
  part.reviewStatus = status
  part.published = status === 'rejected' ? false : publish ?? part.published
  part.updatedAt = now()
  audit(state, part.id, 'review', { from: before, to: { status, published: part.published } })
  save(state)
}

DemoBackend.prototype.mergeParts = async function (fromId: string, intoId: string) {
  await wait()
  requireStaff()
  if (fromId === intoId) throw new AppError('invalid_input', 'Pick a different part.')
  const state = load()
  const from = state.catalog.parts.find((p) => p.id === fromId)
  const into = state.catalog.parts.find((p) => p.id === intoId && p.reviewStatus !== 'rejected')
  if (!from || !into) throw new AppError('invalid_input', 'Part not found.')
  for (const s of from.stock) {
    const t = into.stock.find((x) => x.locationId === s.locationId)
    if (t) {
      t.quantity = t.quantity !== null && s.quantity !== null ? t.quantity + s.quantity : t.quantity ?? s.quantity
      if (s.notes && s.notes !== t.notes) t.notes = `${t.notes} / ${s.notes}`.trim()
    } else {
      into.stock.push({ ...s, partId: into.id })
    }
  }
  into.photos.push(...from.photos.map((ph) => ({ ...ph, partId: into.id, isPrimary: false })))
  from.stock = []
  from.photos = []
  from.reviewStatus = 'rejected'
  from.published = false
  from.mergedInto = into.id
  state.requests = state.requests.filter((r) => r.partId !== fromId)
  audit(state, into.id, 'merge', { from: fromId, name: from.name })
  save(state)
}

DemoBackend.prototype.markLocationReviewed = async function (locationId: string) {
  await wait()
  requireStaff()
  const state = load()
  const loc = state.catalog.locations.find((l) => l.id === locationId)
  if (!loc) throw new AppError('invalid_input', 'Unknown location.')
  loc.reviewedAt = now()
  loc.reviewedByName = currentUser(state)?.displayName ?? null
  save(state)
}

DemoBackend.prototype.evidencePhotoUrl = async function (file: string, size: 'thumb' | 'web') {
  if (!isStaff()) return null
  // the original photos only exist on the developer's machine
  if (!import.meta.env.DEV) return null
  const name = file.replace(/\.(heic|heif|jpe?g|png)$/i, '')
  return `/__dev/inventory/photos/${size}/${name}.jpg`
}

export function resetDemo() {
  localStorage.removeItem(STATE_KEY)
}
