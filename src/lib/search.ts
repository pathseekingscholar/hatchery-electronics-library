import type { Catalog, Part, StockStatus } from './types'
import { extractValues, normalizeText, parseValue, sameValue, type ParsedValue } from './units'
import { locationPath } from './locations'

/** Small built-in synonym list; per-part aliases cover everything else. */
const SYNONYMS: Record<string, string[]> = {
  neopixel: ['ws2812', 'ws2812b', 'sk6812'],
  neopixels: ['ws2812', 'ws2812b', 'sk6812'],
  cap: ['capacitor'],
  caps: ['capacitor'],
  res: ['resistor'],
  pot: ['potentiometer'],
  mcu: ['microcontroller'],
  pushbutton: ['button', 'tactile'],
  ic: ['ics'],
}

const UNIT_WORD = /^[pnuµμmkKMG]?(Ω|Ω|ω|ohms?|r|f|farads?|h|v|volts?|a|amps?|w|watts?|hz)$/i

export function compact(s: string): string {
  return normalizeText(s).replace(/[^a-z0-9µω]/g, '')
}

interface IndexedPart {
  part: Part
  name: string
  nameTokens: string[]
  aliases: string[]
  aliasCompact: string[]
  pn: string
  values: ParsedValue[]
  /** values mentioned on photo labels / spec notes (e.g. resistor bag labels); ranked below the part's own value */
  labelValues: ParsedValue[]
  labelTokens: string[]
  category: string
  other: string // manufacturer, package
  description: string
  locations: Array<{ id: string; text: string; codes: string[] }>
}

export interface SearchIndex {
  items: IndexedPart[]
}

export interface SearchHit {
  part: Part
  score: number
  /** stock locations that matched the query (for location searches) */
  locationIds: string[]
  /** strongest reason, for an optional hint in the UI */
  reason: 'part_number' | 'value' | 'name' | 'location' | 'text'
}

function tokens(s: string): string[] {
  return normalizeText(s).split(/[\s,;/()+]+/).filter(Boolean)
}

export function buildIndex(catalog: Catalog): SearchIndex {
  const cats = new Map(catalog.categories.map((c) => [c.id, c.name]))
  const locs = new Map(catalog.locations.map((l) => [l.id, l]))
  return {
    items: catalog.parts.map((part) => {
      const unitValues = [part.name, ...part.aliases].flatMap((t) => extractValues(t)).filter((v) => v.unit)
      return {
        part,
        name: normalizeText(part.name),
        nameTokens: tokens(part.name),
        aliases: part.aliases.map(normalizeText),
        aliasCompact: part.aliases.map(compact),
        pn: compact(part.partNumber),
        values: [...extractValues(part.value), ...unitValues],
        ...(() => {
          const text = [part.evidence?.labelText ?? '', ...Object.values(part.evidence?.specifications ?? {})].join(' ')
          return { labelValues: extractValues(text.replace(/['"“”]/g, ' ')), labelTokens: tokens(text.replace(/['"“”]/g, ' ')) }
        })(),
        category: normalizeText(cats.get(part.categoryId ?? '') ?? ''),
        other: normalizeText(`${part.manufacturer} ${part.package}`),
        description: normalizeText(part.description),
        locations: part.stock.map((s) => {
          const path = locationPath(s.locationId, locs)
          return {
            id: s.locationId,
            text: normalizeText(path.map((l) => `${l.kind} ${l.name} ${l.code}`).join(' ')),
            codes: path.map((l) => compact(l.code)),
          }
        }),
      }
    }),
  }
}

interface QueryTerm {
  raw: string
  alts: string[]
  value: ParsedValue | null
  numeric: boolean
}

export function parseQuery(query: string): { terms: QueryTerm[]; full: string; compactFull: string } {
  const raw = query.normalize('NFKC').split(/[\s,;()]+/).filter(Boolean)
  const terms: QueryTerm[] = []
  for (let i = 0; i < raw.length; i++) {
    const next = raw[i + 1]
    let text = raw[i]
    // join "4.7 kΩ" / "220 ohm" into one value term
    if (next && UNIT_WORD.test(next) && parseValue(text) && parseValue(text + next)) {
      text = text + next
      i++
    }
    const value = parseValue(text)
    const norm = normalizeText(text)
    terms.push({ raw: norm, alts: [norm, ...(SYNONYMS[norm] ?? [])], value, numeric: /^[\d.]+$/.test(norm) })
  }
  const full = normalizeText(query)
  return { terms, full, compactFull: compact(query) }
}

function matchText(item: IndexedPart, term: string): { score: number; locationIds: string[] } {
  let score = 0
  const locationIds: string[] = []
  const t = term
  const tc = compact(t)
  if (item.nameTokens.includes(t)) score = Math.max(score, 80)
  else if (item.nameTokens.some((n) => n.startsWith(t))) score = Math.max(score, 60)
  else if (t.length >= 3 && item.name.includes(t)) score = Math.max(score, 40)
  if (tc && item.pn && item.pn.includes(tc)) score = Math.max(score, 70)
  if (item.aliases.some((a) => a === t || a.split(/\s+/).some((w) => w.startsWith(t)))) score = Math.max(score, 55)
  if (item.aliasCompact.some((a) => tc.length >= 3 && a.includes(tc))) score = Math.max(score, 45)
  if (item.category.split(/\s+/).some((w) => w.startsWith(t))) score = Math.max(score, 30)
  if (item.other.split(/\s+/).some((w) => w.startsWith(t))) score = Math.max(score, 30)
  for (const loc of item.locations) {
    if (loc.codes.includes(tc) || loc.text.split(/\s+/).includes(t)) {
      locationIds.push(loc.id)
      score = Math.max(score, 40)
    }
  }
  if (score === 0 && t.length >= 4 && item.description.includes(t)) score = 10
  return { score, locationIds }
}

/** Numbers only match whole tokens / part numbers, never as loose substrings (220 ≠ 2200). */
function matchNumeric(item: IndexedPart, term: string): number {
  if (item.nameTokens.includes(term)) return 50
  if (item.aliases.some((a) => a.split(/\s+/).includes(term))) return 45
  if (item.pn && item.pn.includes(term)) return 40
  return 0
}

const AVAILABILITY: Record<StockStatus, number> = { in_stock: 3, low: 2, unverified: 1, out: 0 }

export function bestAvailability(part: Part): number {
  return part.stock.reduce((best, s) => Math.max(best, AVAILABILITY[s.status]), -1)
}

export function search(index: SearchIndex, query: string): SearchHit[] {
  const { terms, full, compactFull } = parseQuery(query)
  if (terms.length === 0) return []
  const hits: SearchHit[] = []

  for (const item of index.items) {
    let score = 0
    let reason: SearchHit['reason'] = 'text'
    const locationIds = new Set<string>()

    // Whole-query exact matches outrank everything.
    if (item.pn && compactFull.length >= 3 && item.pn === compactFull) {
      score += 1000
      reason = 'part_number'
    } else if (item.aliasCompact.includes(compactFull) && compactFull.length >= 3) {
      score += 700
      reason = 'part_number'
    } else if (item.pn && compactFull.length >= 4 && item.pn.startsWith(compactFull)) {
      score += 300
      reason = 'part_number'
    }
    if (item.name === full) {
      score += 500
      if (reason === 'text') reason = 'name'
    } else if (full.length >= 3 && item.name.startsWith(full)) {
      score += 150
      if (reason === 'text') reason = 'name'
    }
    for (const loc of item.locations) {
      if (compactFull && loc.codes.includes(compactFull)) {
        locationIds.add(loc.id)
        score += 300
        reason = 'location'
      }
    }

    let allMatched = true
    let valueMatched = false
    for (const term of terms) {
      if (term.value && item.values.some((v) => sameValue(v, term.value!))) {
        score += term.value.unit ? 650 : 450
        valueMatched = true
        continue
      }
      if (term.value && item.labelValues.some((v) => sameValue(v, term.value!))) {
        score += 260
        valueMatched = true
        continue
      }
      if (term.value && !term.numeric && term.value.unit) {
        // A unit-qualified value that doesn't match this part's value: not this part, unless the
        // token appears in its part number (e.g. "2N7000") or the whole query hit the part number.
        const tc = compact(term.raw)
        if (item.pn && tc.length >= 3 && item.pn.includes(tc)) score += 70
        else if (score < 700) allMatched = false
        continue
      }
      if (term.numeric) {
        const s = matchNumeric(item, term.raw)
        if (s === 0 && !locationIds.size) allMatched = false
        score += s
        continue
      }
      // unit word on its own ("ohm") narrows by unit
      if (UNIT_WORD.test(term.raw) && item.values.length) {
        score += 5
        continue
      }
      if (item.labelTokens.includes(term.raw) && term.raw.length >= 3) {
        score += 25
        continue
      }
      let best = { score: 0, locationIds: [] as string[] }
      for (const alt of term.alts) {
        const m = matchText(item, alt)
        if (m.score > best.score) best = m
      }
      if (best.score === 0) {
        allMatched = false
      } else {
        score += best.score
        best.locationIds.forEach((id) => locationIds.add(id))
      }
    }
    if (!allMatched && score < 700) continue
    if (score <= 0) continue
    if (valueMatched && reason === 'text') reason = 'value'
    if (reason === 'text' && locationIds.size && score < 100) reason = 'location'
    hits.push({ part: item.part, score, locationIds: [...locationIds], reason })
  }

  return hits.sort(
    (a, b) =>
      b.score - a.score ||
      bestAvailability(b.part) - bestAvailability(a.part) ||
      a.part.name.localeCompare(b.part.name),
  )
}
