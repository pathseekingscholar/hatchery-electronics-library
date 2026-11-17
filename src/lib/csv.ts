import Papa from 'papaparse'
import type { Catalog, ImportItem, StockStatus } from './types'
import { compact } from './search'
import { normalizeText } from './units'

export const CSV_COLUMNS = [
  'part_id', 'name', 'category', 'value', 'part_number', 'manufacturer', 'package', 'aliases',
  'description', 'datasheet_url', 'published', 'location_code', 'quantity', 'stock_status',
  'last_checked', 'stock_notes',
] as const

export const STATUS_LABEL: Record<StockStatus, string> = {
  in_stock: 'In stock',
  low: 'Low',
  out: 'Out',
  unverified: 'Unverified',
}

const STATUS_WORDS: Record<string, StockStatus> = {
  in_stock: 'in_stock', 'in stock': 'in_stock', instock: 'in_stock', ok: 'in_stock', yes: 'in_stock', stocked: 'in_stock',
  low: 'low', 'running low': 'low',
  out: 'out', 'out of stock': 'out', empty: 'out', none: 'out',
  unverified: 'unverified', unknown: 'unverified', '?': 'unverified', unchecked: 'unverified',
}

export function exportCsv(catalog: Catalog): string {
  const cats = new Map(catalog.categories.map((c) => [c.id, c.name]))
  const locs = new Map(catalog.locations.map((l) => [l.id, l.code]))
  const rows: string[][] = []
  for (const p of [...catalog.parts].sort((a, b) => a.name.localeCompare(b.name) || a.value.localeCompare(b.value))) {
    const base = [
      p.id, p.name, cats.get(p.categoryId ?? '') ?? '', p.value, p.partNumber, p.manufacturer, p.package,
      p.aliases.join('; '), p.description, p.datasheetUrl, p.published ? 'yes' : 'no',
    ]
    if (p.stock.length === 0) rows.push([...base, '', '', '', '', ''])
    for (const s of p.stock) {
      rows.push([
        ...base, locs.get(s.locationId) ?? '', s.quantity === null ? '' : String(s.quantity), s.status,
        s.lastCheckedAt ? s.lastCheckedAt.slice(0, 10) : '', s.notes,
      ])
    }
  }
  return Papa.unparse({ fields: [...CSV_COLUMNS], data: rows })
}

export const CSV_TEMPLATE = Papa.unparse({
  fields: [...CSV_COLUMNS],
  data: [
    ['', 'Resistor', 'Resistors', '220 Ω', '', '', '1/4 W through-hole', '220R; red red brown', '', '', 'yes', 'A-01', '', 'in_stock', '2026-11-16', ''],
    ['', 'Arduino Nano', 'Microcontrollers', '', 'A000005', 'Arduino', '', 'nano', '', 'https://docs.arduino.cc/hardware/nano', 'yes', 'B-01', '6', '', '2026-11-16', ''],
  ],
})

export interface ImportRowResult {
  line: number
  status: 'create' | 'update' | 'error' | 'duplicate'
  partLabel: string
  locationCode: string
  messages: string[]
}

export interface ImportPlan {
  rows: ImportRowResult[]
  items: ImportItem[]
  summary: { create: number; update: number; stockRows: number; errors: number; duplicates: number }
  fatal: string | null
}

function parseBool(v: string): boolean | null {
  const s = v.trim().toLowerCase()
  if (['yes', 'y', 'true', '1', 'published', 'public'].includes(s)) return true
  if (['no', 'n', 'false', '0', 'draft', ''].includes(s)) return false
  return null
}

function parseDate(v: string): string | null | 'invalid' {
  const s = v.trim()
  if (!s) return null
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/) ?? s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (!m) return 'invalid'
  const [y, mo, d] = s.includes('-') ? [m[1], m[2], m[3]] : [m[3], m[1], m[2]]
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), 12))
  if (Number.isNaN(date.getTime()) || date.getUTCDate() !== Number(d)) return 'invalid'
  return date.toISOString()
}

export function planImport(text: string, catalog: Catalog): ImportPlan {
  const empty = { create: 0, update: 0, stockRows: 0, errors: 0, duplicates: 0 }
  const parsed = Papa.parse<Record<string, string>>(text.replace(/^\uFEFF/, ''), {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (h) => h.trim().toLowerCase().replace(/[\s-]+/g, '_'),
  })
  const headers = parsed.meta.fields ?? []
  if (!headers.includes('name') && !headers.includes('part_id')) {
    return { rows: [], items: [], summary: empty, fatal: 'The file needs a header row with at least a "name" column. Download the template to see the expected columns.' }
  }
  if (parsed.data.length > 5000) {
    return { rows: [], items: [], summary: empty, fatal: 'That file has more than 5,000 rows. Split it into smaller files.' }
  }

  const partsById = new Map(catalog.parts.map((p) => [p.id, p]))
  const locByCode = new Map(catalog.locations.map((l) => [compact(l.code), l]))
  const catNames = new Set(catalog.categories.map((c) => c.name.toLowerCase()))
  const itemsByKey = new Map<string, ImportItem>()
  const seenStock = new Set<string>()
  const rows: ImportRowResult[] = []
  const summary = { ...empty }

  parsed.data.forEach((r, i) => {
    const get = (k: string) => (r[k] ?? '').toString().trim()
    const line = i + 2 // header is line 1
    const messages: string[] = []
    let error = false
    const fail = (msg: string) => {
      messages.push(msg)
      error = true
    }

    const partId = get('part_id')
    const existingById = partId ? partsById.get(partId) : undefined
    if (partId && !existingById) fail(`part_id ${partId} is not in the catalog. Leave it blank to create a new part.`)
    const name = get('name') || existingById?.name || ''
    if (!name) fail('Missing name.')
    if (name.length > 120) fail('Name is longer than 120 characters.')
    const value = get('value')
    const pn = get('part_number')
    const datasheet = get('datasheet_url')
    if (datasheet && !/^https?:\/\//i.test(datasheet)) fail('datasheet_url must start with http:// or https://')
    const published = parseBool(get('published'))
    if (published === null) fail(`published must be yes or no (got "${get('published')}").`)
    const category = get('category')
    if (category && !catNames.has(category.toLowerCase())) messages.push(`New category "${category}" will be created.`)

    // Which part does this row describe?
    let existing = existingById
    if (!existing && !partId) {
      const nv = (p: { name: string; value: string }) => `${normalizeText(p.name)}|${compact(p.value)}`
      const candidates = catalog.parts.filter((p) =>
        pn ? compact(p.partNumber) === compact(pn) && compact(p.value) === compact(value) : !p.partNumber && nv(p) === nv({ name, value }),
      )
      if (candidates.length === 1) existing = candidates[0]
      else if (candidates.length > 1) fail('Matches more than one existing part. Add the part_id column (from an export) to choose.')
    }
    const key = existing ? `id:${existing.id}` : pn ? `pn:${compact(pn)}|${compact(value)}` : `nv:${normalizeText(name)}|${compact(value)}`

    // Stock for this row
    const code = get('location_code')
    const qtyRaw = get('quantity')
    const statusRaw = get('stock_status').toLowerCase()
    let stock: ImportItem['stock'][number] | null = null
    if (code) {
      const loc = locByCode.get(compact(code))
      if (!loc) fail(`Unknown location code "${code}". Add it on the Locations page first.`)
      let quantity: number | null = null
      if (qtyRaw) {
        if (!/^\d+$/.test(qtyRaw)) fail(`quantity must be a whole number or blank (got "${qtyRaw}"). Leave blank for uncounted bulk parts.`)
        else quantity = Number(qtyRaw)
      }
      let status: StockStatus | undefined = statusRaw ? STATUS_WORDS[statusRaw] : undefined
      if (statusRaw && !status) fail(`stock_status must be in_stock, low, out, or unverified (got "${statusRaw}").`)
      if (!status) status = quantity === null ? 'unverified' : quantity === 0 ? 'out' : 'in_stock'
      const checked = parseDate(get('last_checked'))
      if (checked === 'invalid') fail(`last_checked must look like 2026-11-16 (got "${get('last_checked')}").`)
      if (loc) {
        const stockKey = `${key}@${loc.id}`
        if (seenStock.has(stockKey)) {
          rows.push({ line, status: 'duplicate', partLabel: `${name} ${value}`.trim(), locationCode: code, messages: ['Same part and location appear earlier in this file. This row is skipped.'] })
          summary.duplicates++
          return
        }
        seenStock.add(stockKey)
        stock = { location_id: loc.id, quantity, status, last_checked_at: checked === 'invalid' ? null : checked, notes: get('stock_notes').slice(0, 300) }
      }
    } else if (qtyRaw || statusRaw) {
      fail('quantity / stock_status given without a location_code.')
    }

    if (error) {
      rows.push({ line, status: 'error', partLabel: `${name} ${value}`.trim(), locationCode: code, messages })
      summary.errors++
      return
    }

    let item = itemsByKey.get(key)
    if (!item) {
      item = {
        part: {
          ...(existing ? { id: existing.id } : {}),
          name, value, part_number: pn, manufacturer: get('manufacturer'), package: get('package'),
          aliases: get('aliases').split(/[;|]/).map((a) => a.trim()).filter(Boolean),
          description: get('description'), datasheet_url: datasheet, published: published ?? false,
        },
        category,
        stock: [],
      }
      itemsByKey.set(key, item)
      if (existing) summary.update++
      else summary.create++
    } else {
      messages.push('Adds another location to a part listed earlier in this file.')
    }
    if (stock) {
      item.stock.push(stock)
      summary.stockRows++
    }
    rows.push({ line, status: existing ? 'update' : 'create', partLabel: `${name} ${value}`.trim(), locationCode: code, messages })
  })

  return { rows, items: [...itemsByKey.values()], summary, fatal: null }
}
