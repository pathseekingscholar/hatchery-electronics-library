// Parse electronics values so "220Ω", "220 ohm", "220R" and "4.7k", "4k7", "4.7 kΩ", "4700"
// compare as numbers instead of strings.

export type Unit = 'ohm' | 'F' | 'H' | 'V' | 'A' | 'W' | 'Hz' | null

export interface ParsedValue {
  value: number
  unit: Unit
}

const MULT: Record<string, number> = {
  p: 1e-12,
  n: 1e-9,
  u: 1e-6,
  µ: 1e-6,
  μ: 1e-6,
  m: 1e-3,
  k: 1e3,
  K: 1e3,
  M: 1e6,
  G: 1e9,
}

const UNIT_WORDS: Array<[RegExp, Unit]> = [
  [/^(ω|Ω|Ω|ohms?|r)$/i, 'ohm'],
  [/^(f|farads?)$/i, 'F'],
  [/^(h|henrys?|henries)$/i, 'H'],
  [/^(v|volts?|vdc|vac)$/i, 'V'],
  [/^(a|amps?)$/i, 'A'],
  [/^(w|watts?)$/i, 'W'],
  [/^(hz|hertz)$/i, 'Hz'],
]

/** Lowercase, unify Ω/µ glyphs, collapse whitespace. */
export function normalizeText(input: string): string {
  return input
    .normalize('NFKC') // Ω (U+2126) -> Ω, µ (micro) -> μ
    .replace(/[Ωω]/g, 'Ω')
    .replace(/μ/g, 'µ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

function unitFrom(word: string): Unit | undefined {
  if (!word) return null
  for (const [re, unit] of UNIT_WORDS) if (re.test(word)) return unit
  return undefined
}

// number, optional multiplier, optional unit — or RKM style like 4k7 / 2R2 / 4n7
const VALUE_RE = /^(\d+(?:\.\d+)?|\.\d+)\s*([pnuµμmkKMG]?)\s*(Ω|Ω|ω|ohms?|r|f|farads?|h|v|volts?|a|amps?|w|watts?|hz)?$/i
const RKM_RE = /^(\d{1,3})([rRkKmMuUµnNpP])(\d{1,2})\s*(Ω|ohms?|f|h)?$/i

/** Parse a single token (or a two-token phrase like "4.7 kΩ") into a value. Returns null if not a value. */
export function parseValue(raw: string): ParsedValue | null {
  const text = raw.normalize('NFKC').replace(/\s+/g, '').replace(/,/g, '')
  if (!text) return null

  const rkm = text.match(RKM_RE)
  if (rkm) {
    const [, whole, sep, frac, unitWord] = rkm
    const s = sep === 'R' || sep === 'r' ? '' : sep === 'U' ? 'u' : sep === 'N' ? 'n' : sep === 'P' ? 'p' : sep
    const mult = s ? MULT[s] ?? MULT[s.toLowerCase()] : 1
    // In RKM, "M" means mega for resistors; "m" ambiguous — treat 'm' as milli only with explicit F/H.
    const unit = unitWord ? unitFrom(unitWord) ?? null : sep.toLowerCase() === 'r' || /[kKM]/.test(sep) ? 'ohm' : 'F'
    return { value: Number(`${whole}.${frac}`) * mult, unit }
  }

  const m = text.match(VALUE_RE)
  if (!m) return null
  const [, num, prefix, unitWord] = m
  const unit = unitFrom(unitWord ?? '')
  if (unit === undefined) return null
  // "220R" → ohm via unitFrom; "M" is mega, "m" is milli.
  const mult = prefix ? MULT[prefix] ?? 1 : 1
  return { value: Number(num) * mult, unit }
}

/** Extract every value mentioned in a free-text field like "100 µF 25 V" or "220Ω 1/4W". */
export function extractValues(text: string): ParsedValue[] {
  const tokens = text.normalize('NFKC').split(/[\s/,;()]+/).filter(Boolean)
  const out: ParsedValue[] = []
  for (let i = 0; i < tokens.length; i++) {
    const pair = i + 1 < tokens.length ? parseValue(tokens[i] + tokens[i + 1]) : null
    const single = parseValue(tokens[i])
    // prefer "4.7 kΩ" (two tokens) when the second token is a unit/multiplier word
    if (pair && single && pair.unit && !single.unit && /^[pnuµμmkKMG]?[a-zA-ZΩΩω]+$/.test(tokens[i + 1])) {
      out.push(pair)
      i++
    } else if (single) {
      out.push(single)
    }
  }
  return out
}

export function sameValue(a: ParsedValue, b: ParsedValue): boolean {
  if (a.unit && b.unit && a.unit !== b.unit) return false
  if (a.value === 0 || b.value === 0) return a.value === b.value
  return Math.abs(a.value - b.value) / Math.max(Math.abs(a.value), Math.abs(b.value)) < 1e-6
}

/** Canonical display like "4.7 kΩ" — used in CSV previews and for consistency hints. */
export function formatValue(v: ParsedValue): string {
  const symbol = v.unit === 'ohm' ? 'Ω' : v.unit ?? ''
  const steps: Array<[number, string]> = [
    [1e9, 'G'], [1e6, 'M'], [1e3, 'k'], [1, ''], [1e-3, 'm'], [1e-6, 'µ'], [1e-9, 'n'], [1e-12, 'p'],
  ]
  for (const [factor, prefix] of steps) {
    if (Math.abs(v.value) >= factor * 0.999) {
      const n = Number((v.value / factor).toPrecision(4))
      return `${n} ${prefix}${symbol}`.trim()
    }
  }
  return `${v.value} ${symbol}`.trim()
}
