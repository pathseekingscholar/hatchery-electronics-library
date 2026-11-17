// Search over the real photo inventory (the same public seed the site loads without a database).
import { describe, expect, it } from 'vitest'
import seed from '../data/photo-inventory.public.json'
import { buildIndex, search } from './search'
import type { Catalog, Location, Part, PhotoDraft } from './types'

const draft = seed as unknown as PhotoDraft

function catalogFromDraft(): Catalog {
  const categories = [...new Set(draft.items.map((i) => i.category))].map((name, i) => ({ id: `c${i}`, name, sort: i }))
  const locations: Location[] = draft.locations.map((l) => ({
    id: l.id, parentId: l.parent_id, kind: l.kind, name: l.name, code: l.code, description: '', sort: l.order,
    photoUrl: null, thumbUrl: null, photoPath: null, thumbPath: null, reviewedAt: null, reviewedByName: null,
  }))
  const parts: Part[] = draft.items
    .filter((it) => !it.duplicate_of && it.searchable)
    .map((it) => ({
      id: it.draft_id, name: it.name, categoryId: categories.find((c) => c.name === it.category)!.id, value: '',
      partNumber: it.part_number ?? '', manufacturer: it.manufacturer ?? '', package: '', aliases: [], description: it.description,
      datasheetUrl: '', published: true, createdAt: '', updatedAt: '', photos: [], itemType: it.item_type,
      reviewStatus: it.catalog_status, reviewReasons: it.review_reasons, verifiedAt: null, verifiedByName: null, mergedInto: null,
      evidence: {
        draftId: it.draft_id, confidence: it.identification_confidence, labelText: it.label_text, photos: [], visibleQty: null,
        qtyNote: null, container: null, isAssortment: it.is_assortment, contentsUnknown: it.contents_unknown, possibleDuplicateOf: null,
        specifications: it.specifications ?? {}, snapshot: it.snapshot,
      },
      stock: [{ id: `s-${it.draft_id}`, partId: it.draft_id, locationId: it.location.id, quantity: null, status: 'unverified', lastCheckedAt: null, notes: '' }],
    }))
  return { categories, locations, parts }
}

const catalog = catalogFromDraft()
const index = buildIndex(catalog)
const ids = (q: string) => search(index, q).map((h) => h.part.id)

describe('search across the photo inventory', () => {
  it.each([
    ['MOSFET', 'z2-d1-015'],
    ['capacitor', 'z2-d1-016'],
    ['JST', 'z2-d2-011'],
    ['LilyPad', 'z2-d3-016'],
    ['Weller', 'z3-d4-001'],
    ['Heltec', 'z3-d2-001'],
    ['PIR', 'z1-d1-023'],
    ['WPS3010B', 'z1-d3-010'],
    ['IRF540N', 'z2-d1-015'],
    ['Klein', 'ss-d1-004'],
    ['Z2-D1', 'z2-d1-016'],
  ])('%s finds %s', (q, expected) => {
    expect(ids(q)).toContain(expected)
  })

  it('exact part numbers rank first', () => {
    expect(ids('3005CR')[0]).toBe('ss-d1-004')
    expect(ids('8341')[0]).toBe('z4-d3-008')
  })

  it('finds resistor bags by the value written on the bag', () => {
    expect(ids('220 ohm')).toContain('z2-d1-017')
    expect(ids('1M')).toContain('z2-d1-017')
  })

  it('stock is never invented: every imported line is Unverified with no count', () => {
    for (const it of draft.items) expect(it.quantity).toMatchObject({ value: null, status: 'unverified' })
  })

  it('nothing is staff verified automatically', () => {
    expect(new Set(draft.items.map((i) => i.catalog_status))).toEqual(new Set(['needs_review']))
  })

  it('the public seed carries no photo references or staff-only notes', () => {
    const text = JSON.stringify(seed)
    expect(text).not.toMatch(/IMG_\d+/)
    expect(text).not.toMatch(/name on (masking )?tape/i)
  })
})

describe('home page examples', () => {
  it.each(['Arduino', 'Raspberry Pi', 'NeoPixel', '220 ohm', 'soldering iron', 'multimeter', 'relay', 'Weller'])('%s returns real parts', (q) => {
    expect(ids(q).length).toBeGreaterThan(0)
  })
})

describe('catalog images', () => {
  it('every public record has a 16:10 catalog image that exists on disk; nothing else is deployed', async () => {
    const { existsSync } = await import('node:fs')
    const { join } = await import('node:path')
    const thumbs = (await import('../data/catalog-thumbs.json')).default as Record<string, { file: string }>
    const { readdirSync } = await import('node:fs')
    const { imageSize } = await import('./testImageSize')
    const pub = draft.items.filter((i) => i.searchable && !i.duplicate_of)
    expect(Object.keys(thumbs).sort()).toEqual(pub.map((i) => i.draft_id).sort())
    expect(readdirSync(join(__dirname, '..', '..', 'public', 'catalog-thumbs')).length).toBe(pub.length)
    for (const it of pub) {
      const t = thumbs[it.draft_id]
      expect(t, it.draft_id).toBeTruthy()
      const file = join(__dirname, '..', '..', 'public', t.file)
      expect(existsSync(file), t.file).toBe(true)
      expect(imageSize(file), t.file).toEqual({ width: 560, height: 350 })
    }
  })
})
