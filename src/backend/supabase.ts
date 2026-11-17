import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type {
  AppUser, Catalog, CommunityPost, LocationEvidence, Member, PartEvidence, PhotoDraft, PostStatus, ReviewStatus, Role, ImportItem, Location, LocationInput, Part, PartInput, PartPhoto, PhotoSuggestion, ProcessedPhoto,
  RequestStatus, RestockRequest, StaffUser, StockInput, StockStatus,
} from '../lib/types'
import { AppError } from '../lib/types'
import { extensionFor } from '../lib/images'
import { isAllowedEmail } from '../lib/bcEmail'
import type { Backend, ImportResult, PartRequestSubmission, PostSubmission, RestockSubmission } from './types'

const PUBLIC_BUCKET = 'catalog'
const DRAFT_BUCKET = 'catalog-drafts'

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>

function fail(error: { message: string; code?: string } | null): void {
  if (!error) return
  const msg = error.message || 'Request failed'
  if (msg.includes('rate_limited')) throw new AppError('rate_limited', 'Too many requests. Please wait a few minutes and try again.')
  if (msg.includes('auth_required')) throw new AppError('auth_required', 'Sign in with your BC email to post.')
  if (msg.includes('invalid_input')) throw new AppError('invalid_input', msg.replace(/^.*invalid_input:\s*/, ''))
  if (msg.includes('forbidden') || error.code === '42501' || msg.includes('row-level security')) {
    throw new AppError('forbidden', 'Staff sign-in required.')
  }
  if (error.code === '23505') throw new AppError('invalid_input', 'That label code or name is already in use.')
  if (error.code === '23503') throw new AppError('invalid_input', 'That item is still in use (for example, parts are stocked there).')
  throw new AppError('server', msg)
}

export class SupabaseBackend implements Backend {
  mode = 'supabase' as const
  private sb: SupabaseClient
  private userCache: AppUser | null | undefined

  constructor(url: string, anonKey: string) {
    this.sb = createClient(url, anonKey, { auth: { persistSession: true, autoRefreshToken: true } })
  }

  private publicUrl(path: string) {
    return this.sb.storage.from(PUBLIC_BUCKET).getPublicUrl(path).data.publicUrl
  }

  private mapLocation(r: Row, names: Map<string, string>): Location {
    return {
      id: r.id, parentId: r.parent_id, kind: r.kind, name: r.name, code: r.code, description: r.description,
      sort: r.sort, photoPath: r.photo_path, thumbPath: r.thumb_path,
      reviewedAt: r.reviewed_at ?? null, reviewedByName: r.reviewed_by ? names.get(r.reviewed_by) ?? null : null,
      photoUrl: r.photo_path ? this.publicUrl(r.photo_path) : null,
      thumbUrl: r.thumb_path ? this.publicUrl(r.thumb_path) : null,
    }
  }

  async getCatalog(): Promise<Catalog> {
    const [parts, locations, categories] = await Promise.all([
      this.sb.from('parts').select('*, part_photos(*), stock(*)').order('name'),
      this.sb.from('locations').select('*'),
      this.sb.from('categories').select('*').order('sort'),
    ])
    fail(parts.error)
    fail(locations.error)
    fail(categories.error)

    // Staff extras: reviewer names and per-location photo evidence (RLS hides both from students).
    const staff = await this.getStaff()
    const names = new Map<string, string>()
    const locationEvidence: Record<string, LocationEvidence> = {}
    if (staff) {
      const [profiles, evidence] = await Promise.all([
        this.sb.from('profiles').select('id, display_name, email'),
        this.sb.from('location_evidence').select('*'),
      ])
      profiles.data?.forEach((pr: Row) => names.set(pr.id, pr.display_name || String(pr.email).split('@')[0]))
      evidence.data?.forEach((e: Row) => {
        const ev = e.evidence ?? {}
        locationEvidence[e.location_id] = {
          draftId: ev.draft_id ?? null, frontLabel: ev.front_label ?? null, observedState: ev.observed_state ?? null,
          confidence: ev.confidence ?? 'high', photos: ev.photos ?? [],
          opportunities: (ev.opportunities ?? []).map((o: Row) => ({
            id: o.id, kind: o.kind, description: o.description, state: o.state, needsConfirmation: Boolean(o.needs_confirmation), photos: o.source_images ?? [],
          })),
        }
      })
    }
    const mapEvidence = (ev: Row | null): PartEvidence | null =>
      ev && ev.draft_id
        ? {
            draftId: ev.draft_id, confidence: ev.confidence ?? 'low', labelText: ev.label_text ?? null, photos: ev.photos ?? [],
            visibleQty: ev.visible_qty ?? null, qtyNote: ev.qty_note ?? null, container: ev.container ?? null,
            isAssortment: Boolean(ev.is_assortment), contentsUnknown: Boolean(ev.contents_unknown),
            possibleDuplicateOf: ev.possible_duplicate_of ?? null, specifications: ev.specifications ?? {}, snapshot: ev.snapshot ?? null,
            alsoSeen: ev.also_seen ?? [],
          }
        : null

    // Draft photos live in a private bucket; staff get short-lived signed URLs.
    const draftPaths = (parts.data ?? []).flatMap((p: Row) =>
      (p.part_photos ?? []).filter((ph: Row) => !ph.published).flatMap((ph: Row) => [ph.full_path, ph.thumb_path]),
    )
    const signed = new Map<string, string>()
    if (draftPaths.length) {
      const { data } = await this.sb.storage.from(DRAFT_BUCKET).createSignedUrls(draftPaths, 3600)
      data?.forEach((d) => d.path && d.signedUrl && signed.set(d.path, d.signedUrl))
    }
    const url = (path: string, published: boolean) => (published ? this.publicUrl(path) : signed.get(path) ?? '')

    return {
      categories: (categories.data ?? []).map((c: Row) => ({ id: c.id, name: c.name, sort: c.sort })),
      locations: (locations.data ?? []).map((l: Row) => this.mapLocation(l, names)),
      ...(staff ? { locationEvidence } : {}),
      parts: (parts.data ?? []).map(
        (p: Row): Part => ({
          id: p.id, name: p.name, categoryId: p.category_id, value: p.value, partNumber: p.part_number,
          manufacturer: p.manufacturer, package: p.package, aliases: p.aliases ?? [], description: p.description,
          datasheetUrl: p.datasheet_url, published: p.published, createdAt: p.created_at, updatedAt: p.updated_at,
          itemType: p.item_type ?? 'component', reviewStatus: p.review_status ?? 'verified', reviewReasons: p.review_reasons ?? [],
          evidence: mapEvidence(p.evidence),
          verifiedAt: p.verified_at ?? null, verifiedByName: p.verified_by ? names.get(p.verified_by) ?? null : null,
          mergedInto: p.merged_into ?? null,
          photos: (p.part_photos ?? []).map(
            (ph: Row): PartPhoto => ({
              id: ph.id, partId: ph.part_id, fullPath: ph.full_path, thumbPath: ph.thumb_path,
              fullUrl: url(ph.full_path, ph.published), thumbUrl: url(ph.thumb_path, ph.published),
              published: ph.published, isPrimary: ph.is_primary, createdAt: ph.created_at,
            }),
          ),
          stock: (p.stock ?? []).map((s: Row) => ({
            id: s.id, partId: s.part_id, locationId: s.location_id, quantity: s.quantity,
            status: s.status as StockStatus, lastCheckedAt: s.last_checked_at, notes: s.notes,
            checkedByName: s.checked_by ? names.get(s.checked_by) ?? null : null,
          })),
        }),
      ),
    }
  }

  async submitRestock(input: RestockSubmission) {
    const { data, error } = await this.sb.rpc('submit_restock_request', {
      p_part_id: input.partId,
      p_location_id: input.locationId,
      p_note: input.note,
      p_requester_name: input.requesterName,
      p_requester_contact: input.requesterContact,
    })
    fail(error)
    return data as { id: string; status: 'created' | 'duplicate' }
  }

  async submitPartRequest(input: PartRequestSubmission) {
    const { data, error } = await this.sb.rpc('submit_part_request', {
      p_requested_part: input.requestedPart,
      p_note: input.note,
      p_requester_name: input.requesterName,
      p_requester_contact: input.requesterContact,
    })
    fail(error)
    return data as { id: string; status: 'created' | 'duplicate' }
  }

  async listPosts(): Promise<CommunityPost[]> {
    const { data, error } = await this.sb.from('community_posts').select('id, kind, title, body, author_name, status, created_at').order('created_at', { ascending: false }).limit(200)
    fail(error)
    return (data ?? []).map((p: Row) => ({
      id: p.id, kind: p.kind, title: p.title, body: p.body, authorName: p.author_name, status: p.status, createdAt: p.created_at,
    }))
  }
  async submitPost(input: PostSubmission) {
    const { data, error } = await this.sb.rpc('submit_community_post', {
      p_kind: input.kind, p_title: input.title, p_body: input.body, p_author_name: input.authorName,
    })
    fail(error)
    return data as { id: string; status: 'pending' }
  }
  async moderatePost(id: string, status: PostStatus) {
    const staff = await this.getStaff()
    fail((await this.sb.from('community_posts').update({ status, reviewed_at: new Date().toISOString(), reviewed_by: staff?.id }).eq('id', id)).error)
  }
  async deletePost(id: string) {
    fail((await this.sb.from('community_posts').delete().eq('id', id)).error)
  }

  async getUser(): Promise<AppUser | null> {
    if (this.userCache !== undefined) return this.userCache
    const { data: session } = await this.sb.auth.getSession()
    const user = session.session?.user
    if (!user) return (this.userCache = null)
    const [{ data: profile }, { data: staff }] = await Promise.all([
      this.sb.from('profiles').select('display_name').eq('id', user.id).maybeSingle(),
      this.sb.from('staff').select('role').eq('user_id', user.id).maybeSingle(),
    ])
    this.userCache = {
      id: user.id,
      email: user.email ?? '',
      displayName: profile?.display_name || (user.email ?? '').split('@')[0],
      role: (staff?.role as Role | undefined) ?? 'member',
    }
    return this.userCache
  }
  async getStaff(): Promise<StaffUser | null> {
    const u = await this.getUser()
    return u && u.role !== 'member' ? { id: u.id, email: u.email, displayName: u.displayName, role: u.role } : null
  }
  async sendSignInCode(email: string) {
    const e = email.trim().toLowerCase()
    if (!isAllowedEmail(e)) throw new AppError('invalid_input', 'Use your @bc.edu email address.')
    const { error } = await this.sb.auth.signInWithOtp({
      email: e,
      options: { shouldCreateUser: true, emailRedirectTo: window.location.origin + import.meta.env.BASE_URL },
    })
    if (error) {
      if (/database error|bc\.edu/i.test(error.message)) throw new AppError('invalid_input', 'Only @bc.edu email addresses can sign in.')
      if (error.status === 429 || /security purposes|rate limit/i.test(error.message)) {
        throw new AppError('rate_limited', 'Too many codes requested. Wait a minute and try again.')
      }
      throw new AppError('auth', error.message)
    }
    return {}
  }
  async verifySignInCode(email: string, code: string) {
    const { error } = await this.sb.auth.verifyOtp({ email: email.trim().toLowerCase(), token: code.trim(), type: 'email' })
    if (error) throw new AppError('auth', 'That code is wrong or expired. Request a new one.')
    this.userCache = undefined
    const user = await this.getUser()
    if (!user) throw new AppError('auth', 'Sign-in failed. Try again.')
    return user
  }
  async updateDisplayName(name: string) {
    const u = await this.getUser()
    if (!u) throw new AppError('auth_required', 'Sign in first.')
    fail((await this.sb.from('profiles').update({ display_name: name.trim().slice(0, 60) }).eq('id', u.id)).error)
    this.userCache = undefined
  }
  async listMembers(): Promise<Member[]> {
    const [profiles, staff] = await Promise.all([
      this.sb.from('profiles').select('id, email, display_name, created_at').order('email').limit(2000),
      this.sb.from('staff').select('user_id, role'),
    ])
    fail(profiles.error)
    fail(staff.error)
    const roles = new Map((staff.data ?? []).map((r: Row) => [r.user_id, r.role as Role]))
    return (profiles.data ?? []).map((p: Row) => ({
      id: p.id, email: p.email, displayName: p.display_name, createdAt: p.created_at, role: roles.get(p.id) ?? 'member',
    }))
  }
  async setMemberRole(userId: string, role: Role) {
    fail((await this.sb.rpc('set_member_role', { p_user_id: userId, p_role: role })).error)
  }
  async signOut() {
    await this.sb.auth.signOut()
    this.userCache = null
  }
  onAuthChange(cb: () => void) {
    const { data } = this.sb.auth.onAuthStateChange((event) => {
      if (event === 'TOKEN_REFRESHED') return
      this.userCache = undefined
      cb()
    })
    return () => data.subscription.unsubscribe()
  }
  onCatalogChange(cb: () => void) {
    // react-query refetches on focus/interval; realtime can be enabled later per table.
    void cb
    return () => {}
  }

  async savePart(input: PartInput): Promise<Part> {
    const row = {
      name: input.name.trim(), category_id: input.categoryId, value: input.value.trim(),
      part_number: input.partNumber.trim(), manufacturer: input.manufacturer.trim(), package: input.package.trim(),
      aliases: input.aliases, description: input.description.trim(), datasheet_url: input.datasheetUrl.trim(),
      published: input.published,
      ...(input.itemType ? { item_type: input.itemType } : {}),
      ...(input.reviewStatus ? { review_status: input.reviewStatus } : {}),
    }
    const q = input.id
      ? this.sb.from('parts').update(row).eq('id', input.id).select().single()
      : this.sb.from('parts').insert(row).select().single()
    const { data, error } = await q
    fail(error)
    return {
      ...input, id: data.id, createdAt: data.created_at, updatedAt: data.updated_at, photos: [], stock: [],
      itemType: data.item_type, reviewStatus: data.review_status, reviewReasons: data.review_reasons ?? [], evidence: null, verifiedAt: data.verified_at,
      verifiedByName: null, mergedInto: data.merged_into,
    } as Part
  }
  async deletePart(id: string) {
    const { data: photos } = await this.sb.from('part_photos').select('*').eq('part_id', id)
    fail((await this.sb.from('parts').delete().eq('id', id)).error)
    for (const ph of photos ?? []) {
      await this.sb.storage.from(ph.published ? PUBLIC_BUCKET : DRAFT_BUCKET).remove([ph.full_path, ph.thumb_path])
    }
  }
  async setStock(input: StockInput) {
    const { error } = await this.sb.from('stock').upsert(
      {
        part_id: input.partId, location_id: input.locationId, quantity: input.quantity, status: input.status,
        last_checked_at: input.lastCheckedAt, notes: input.notes,
      },
      { onConflict: 'part_id,location_id' },
    )
    fail(error)
  }
  async removeStock(partId: string, locationId: string) {
    fail((await this.sb.from('stock').delete().eq('part_id', partId).eq('location_id', locationId)).error)
  }
  async moveStock(partId: string, fromId: string, toId: string, quantity: number | null) {
    const { error } = await this.sb.rpc('move_stock', { p_part_id: partId, p_from: fromId, p_to: toId, p_quantity: quantity })
    fail(error)
  }

  private async upload(bucket: string, base: string, photo: ProcessedPhoto) {
    const fullPath = `${base}/full.${extensionFor(photo.full)}`
    const thumbPath = `${base}/thumb.${extensionFor(photo.thumb)}`
    const opts = (b: Blob) => ({ contentType: b.type, cacheControl: '31536000', upsert: false })
    fail((await this.sb.storage.from(bucket).upload(fullPath, photo.full, opts(photo.full))).error)
    fail((await this.sb.storage.from(bucket).upload(thumbPath, photo.thumb, opts(photo.thumb))).error)
    return { fullPath, thumbPath }
  }

  async addPartPhoto(partId: string, photo: ProcessedPhoto, publish: boolean): Promise<PartPhoto> {
    const id = crypto.randomUUID()
    const { fullPath, thumbPath } = await this.upload(publish ? PUBLIC_BUCKET : DRAFT_BUCKET, `parts/${partId}/${id}`, photo)
    const { count } = await this.sb.from('part_photos').select('id', { count: 'exact', head: true }).eq('part_id', partId)
    const { data, error } = await this.sb
      .from('part_photos')
      .insert({ id, part_id: partId, full_path: fullPath, thumb_path: thumbPath, published: publish, is_primary: !count })
      .select()
      .single()
    fail(error)
    return {
      id, partId, fullPath, thumbPath, fullUrl: '', thumbUrl: '', published: publish, isPrimary: data.is_primary, createdAt: data.created_at,
    }
  }

  /** Publishing moves files from the private bucket to the public one (and back when unpublishing). */
  private async moveObject(path: string, from: string, to: string) {
    const { data, error } = await this.sb.storage.from(from).download(path)
    fail(error)
    const { error: upErr } = await this.sb.storage.from(to).upload(path, data!, { contentType: data!.type, upsert: true, cacheControl: '31536000' })
    fail(upErr)
    await this.sb.storage.from(from).remove([path])
  }

  async updatePartPhoto(photo: PartPhoto, changes: { published?: boolean; isPrimary?: boolean }) {
    if (changes.published !== undefined && changes.published !== photo.published) {
      const [from, to] = changes.published ? [DRAFT_BUCKET, PUBLIC_BUCKET] : [PUBLIC_BUCKET, DRAFT_BUCKET]
      await this.moveObject(photo.fullPath, from, to)
      await this.moveObject(photo.thumbPath, from, to)
      fail((await this.sb.from('part_photos').update({ published: changes.published }).eq('id', photo.id)).error)
    }
    if (changes.isPrimary) {
      fail((await this.sb.from('part_photos').update({ is_primary: false }).eq('part_id', photo.partId)).error)
      fail((await this.sb.from('part_photos').update({ is_primary: true }).eq('id', photo.id)).error)
    }
  }
  async deletePartPhoto(photo: PartPhoto) {
    fail((await this.sb.from('part_photos').delete().eq('id', photo.id)).error)
    await this.sb.storage.from(photo.published ? PUBLIC_BUCKET : DRAFT_BUCKET).remove([photo.fullPath, photo.thumbPath])
  }

  async saveLocation(input: LocationInput): Promise<string> {
    const row = {
      parent_id: input.parentId, kind: input.kind.trim(), name: input.name.trim(), code: input.code.trim(),
      description: input.description.trim(), sort: input.sort,
    }
    const q = input.id
      ? this.sb.from('locations').update(row).eq('id', input.id).select('id').single()
      : this.sb.from('locations').insert(row).select('id').single()
    const { data, error } = await q
    fail(error)
    return (data as { id: string }).id
  }
  async deleteLocation(id: string) {
    fail((await this.sb.from('locations').delete().eq('id', id)).error)
  }
  async setLocationPhoto(locationId: string, photo: ProcessedPhoto | null) {
    const { data: current } = await this.sb.from('locations').select('photo_path, thumb_path').eq('id', locationId).single()
    let paths = { fullPath: null as string | null, thumbPath: null as string | null }
    if (photo) paths = await this.upload(PUBLIC_BUCKET, `locations/${locationId}/${crypto.randomUUID()}`, photo)
    fail((await this.sb.from('locations').update({ photo_path: paths.fullPath, thumb_path: paths.thumbPath }).eq('id', locationId)).error)
    const old = [current?.photo_path, current?.thumb_path].filter(Boolean) as string[]
    if (old.length) await this.sb.storage.from(PUBLIC_BUCKET).remove(old)
  }

  async listRequests(): Promise<RestockRequest[]> {
    const { data, error } = await this.sb.from('restock_requests').select('*').order('created_at', { ascending: false }).limit(500)
    fail(error)
    return (data ?? []).map((r: Row) => ({
      id: r.id, partId: r.part_id, requestedPart: r.requested_part ?? '', locationId: r.location_id, status: r.status, note: r.note,
      requesterName: r.requester_name, requesterContact: r.requester_contact, requestCount: r.request_count,
      createdAt: r.created_at, updatedAt: r.updated_at, acknowledgedAt: r.acknowledged_at, resolvedAt: r.resolved_at,
      resolutionNote: r.resolution_note,
    }))
  }
  async updateRequest(id: string, status: RequestStatus, resolutionNote = '') {
    const staff = await this.getStaff()
    const now = new Date().toISOString()
    const patch: Row = { status }
    if (status === 'acknowledged') Object.assign(patch, { acknowledged_at: now, acknowledged_by: staff?.id })
    if (status === 'resolved' || status === 'dismissed') {
      Object.assign(patch, { resolved_at: now, resolved_by: staff?.id, resolution_note: resolutionNote.slice(0, 500) })
    }
    fail((await this.sb.from('restock_requests').update(patch).eq('id', id)).error)
  }

  async importItems(items: ImportItem[]) {
    const { data, error } = await this.sb.rpc('import_inventory', { p_items: items })
    fail(error)
    return data as { created: number; updated: number; stock: number }
  }

  async fetchBundledDraft(): Promise<PhotoDraft | null> {
  // Only the local dev server serves the repo's draft file (with staff-only evidence).
  if (!import.meta.env.DEV) return null
    // Only the local dev server serves the repo's draft; in production staff upload the file.
    try {
      const res = await fetch('/__dev/inventory/inventory-draft.json')
      if (!res.ok || !res.headers.get('content-type')?.includes('json')) return null
      return (await res.json()) as PhotoDraft
    } catch {
      return null
    }
  }
  async importPhotoDraft(draft: PhotoDraft) {
    const { data, error } = await this.sb.rpc('import_photo_draft', { p_draft: draft })
    fail(error)
    return data as ImportResult
  }
  async setReviewStatus(partId: string, status: ReviewStatus, publish?: boolean) {
    const patch: Row = { review_status: status }
    if (status === 'rejected') patch.published = false
    else if (publish !== undefined) patch.published = publish
    if (status === 'verified') patch.review_reasons = []
    fail((await this.sb.from('parts').update(patch).eq('id', partId)).error)
  }
  async mergeParts(fromId: string, intoId: string) {
    fail((await this.sb.rpc('merge_parts', { p_from: fromId, p_into: intoId })).error)
  }
  async markLocationReviewed(locationId: string) {
    fail((await this.sb.rpc('mark_location_reviewed', { p_location_id: locationId })).error)
  }
  private evidenceCache = new Map<string, { url: string; at: number }>()
  async evidencePhotoUrl(file: string, size: 'thumb' | 'web') {
    // Uploaded by scripts/inventory/upload-evidence.mjs to the private bucket.
    const path = `evidence/${size}/${file.replace(/\.(heic|heif|jpe?g|png)$/i, '')}.jpg`
    const hit = this.evidenceCache.get(path)
    if (hit && Date.now() - hit.at < 50 * 60_000) return hit.url
    const { data } = await this.sb.storage.from(DRAFT_BUCKET).createSignedUrl(path, 3600)
    if (!data?.signedUrl) return null
    this.evidenceCache.set(path, { url: data.signedUrl, at: Date.now() })
    return data.signedUrl
  }

  async suggestFromPhoto(aiDataUrl: string): Promise<PhotoSuggestion> {
    const { data, error } = await this.sb.functions.invoke('suggest-part', { body: { image: aiDataUrl } })
    if (error) {
      let body: { code?: string; message?: string } | null = null
      try {
        body = await (error as { context?: Response }).context?.json()
      } catch {
        body = null
      }
      throw new AppError(body?.code ?? 'ai_unavailable', body?.message ?? 'Photo suggestions are unavailable right now. Enter details manually.')
    }
    return (data as { suggestion: PhotoSuggestion }).suggestion
  }
}
