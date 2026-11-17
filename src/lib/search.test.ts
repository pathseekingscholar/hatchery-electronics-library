import { describe, expect, it } from 'vitest'
import { makeDemoCatalog } from '../backend/demoSeed'
import { buildIndex, search } from './search'
import { extractValues, formatValue, parseValue, sameValue } from './units'

const catalog = makeDemoCatalog()
const index = buildIndex(catalog)
const top = (q: string) => {
  const hit = search(index, q)[0]
  return hit ? `${hit.part.name} ${hit.part.value || hit.part.partNumber}`.trim() : null
}
const values = (q: string) => search(index, q).map((h) => h.part.value)

describe('value parsing', () => {
  it.each([
    ['220Ω', 220, 'ohm'], ['220 ohm', 220, 'ohm'], ['220ohms', 220, 'ohm'], ['220R', 220, 'ohm'],
    ['4.7k', 4700, null], ['4k7', 4700, 'ohm'], ['4.7 kΩ', 4700, 'ohm'], ['4.7kohm', 4700, 'ohm'],
    ['0.1uF', 1e-7, 'F'], ['100nF', 1e-7, 'F'], ['100 µF', 1e-4, 'F'], ['5V', 5, 'V'],
  ])('%s', (input, value, unit) => {
    const parsed = parseValue(input.replace(/\s/g, '')) ?? extractValues(input)[0]
    expect(parsed).not.toBeNull()
    expect(sameValue(parsed!, { value, unit: unit as never })).toBe(true)
    if (unit) expect(parsed!.unit).toBe(unit)
  })
  it('Ω sign variants are equivalent', () => {
    expect(parseValue('220Ω')?.unit).toBe('ohm') // OHM SIGN
    expect(parseValue('220Ω')?.unit).toBe('ohm') // GREEK CAPITAL OMEGA
  })
  it('does not treat transistor part numbers as values', () => {
    expect(parseValue('2N2222')).toBeNull()
  })
  it('formats', () => {
    expect(formatValue({ value: 4700, unit: 'ohm' })).toBe('4.7 kΩ')
  })
})

describe('search', () => {
  it('finds the 220 Ω resistor the same way for 220Ω and 220 ohm, and not 22 Ω or 2.2 kΩ', () => {
    for (const q of ['220Ω', '220 ohm', '220 Ω', '220R', '220 ohm resistor', '220']) {
      expect(values(q)[0], q).toBe('220 Ω')
      expect(values(q), q).not.toContain('2.2 kΩ')
      expect(values(q), q).not.toContain('22 Ω')
    }
  })
  it('4.7k and 4.7 kΩ hit the same resistor', () => {
    expect(values('4.7k')[0]).toBe('4.7 kΩ')
    expect(values('4.7 kΩ')[0]).toBe('4.7 kΩ')
    expect(values('4k7')[0]).toBe('4.7 kΩ')
  })
  it('capacitor value variants', () => {
    expect(values('100nF')[0]).toBe('0.1 µF')
    expect(values('0.1uF')[0]).toBe('0.1 µF')
    expect(values('100uF')[0]).toBe('100 µF 25 V')
  })
  it('names and aliases', () => {
    expect(top('NeoPixel')).toMatch(/NeoPixel/)
    expect(top('Arduino Nano')).toBe('Arduino Nano A000005')
    expect(top('esp32')).toMatch(/ESP32/)
  })
  it('exact part numbers rank above near matches', () => {
    expect(top('2N2222A')).toBe('NPN transistor 2N2222A')
    expect(top('2n7000')).toBe('N-channel MOSFET 2N7000')
    expect(top('WS2812B')).toBe('NeoPixel LED strip WS2812B')
    expect(top('NE555P')).toBe('555 timer NE555P')
  })
  it('location labels', () => {
    const hits = search(index, 'B-04')
    expect(hits.length).toBe(3)
    expect(hits.every((h) => h.locationIds.includes('l-b04'))).toBe(true)
  })
  it('returns nothing for nonsense', () => {
    expect(search(index, 'flux capacitor 1.21GW')).toEqual([])
  })
})

describe('photo-label values', () => {
  it('finds an assortment by a value written on its bag label, ranked below an exact part', () => {
    const cat = makeDemoCatalog()
    const assortment = {
      ...cat.parts[0],
      id: 'assort',
      name: 'Resistor assortment, metal film',
      value: '',
      aliases: [],
      evidence: {
        draftId: 'x', confidence: 'high' as const, labelText: "Bag labels: '220', '1M', '100k'", photos: [], visibleQty: null,
        qtyNote: null, container: null, isAssortment: true, contentsUnknown: false, possibleDuplicateOf: null, specifications: {}, snapshot: null,
      },
    }
    const idx = buildIndex({ ...cat, parts: [...cat.parts, assortment] })
    const hits = search(idx, '220 ohm').map((h) => h.part.id)
    expect(hits[0]).toBe('p-1') // the real 220 Ω part first
    expect(hits).toContain('assort')
    expect(search(idx, '100k').map((h) => h.part.id)).toContain('assort')
    expect(search(idx, '4.7k').map((h) => h.part.id)).not.toContain('assort')
  })
})
