// Guards drawer-photo pin placement against image-processing drift.
// Recomputes each published pin from inventory/source/photo-pins.json (coordinates on the upright
// original) through the same crop/rotate transform as scripts/inventory/location_photos.py and
// checks it against src/data/location-photos.json and the actual published files.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import published from '../data/location-photos.json'
import { imageSize } from './testImageSize'

const root = join(__dirname, '..', '..')
const source = JSON.parse(readFileSync(join(root, 'inventory', 'source', 'photo-pins.json'), 'utf8')).photos as Record<
  string,
  { crop: [number, number, number, number]; rotate180?: boolean; pins: Record<string, [number, number]> }
>
const pub = published as unknown as {
  photos: Record<string, { file: string; width: number; height: number }>
  pins: Record<string, { photo: string; x: number; y: number }>
}

/** Same transform as location_photos.py: crop box in % of the original, then optional 180° turn. */
function expected(crop: [number, number, number, number], rotate180: boolean | undefined, [x, y]: [number, number]) {
  const [l, t, r, b] = crop
  let px = (x - l) / (r - l)
  let py = (y - t) / (b - t)
  if (rotate180) [px, py] = [1 - px, 1 - py]
  return { x: px, y: py }
}

describe('drawer photo pins', () => {
  it('published images exist with the recorded size (resizing cannot desync pins)', () => {
    for (const [key, p] of Object.entries(pub.photos)) {
      expect(imageSize(join(root, 'public', p.file)), key).toEqual({ width: p.width, height: p.height })
    }
  })

  it('published pin data is in sync with the source pins (regenerated after every edit)', () => {
    const want: Record<string, { photo: string; x: number; y: number }> = {}
    for (const [photo, c] of Object.entries(source)) {
      for (const [id, xy] of Object.entries(c.pins)) want[id] = { photo, ...expected(c.crop, c.rotate180, xy) }
    }
    expect(Object.keys(pub.pins).sort()).toEqual(Object.keys(want).sort())
    for (const [id, p] of Object.entries(pub.pins)) {
      expect(p.photo, id).toBe(want[id].photo)
      expect(p.x, id).toBeCloseTo(want[id].x, 3)
      expect(p.y, id).toBeCloseTo(want[id].y, 3)
    }
  })

  it('every pin lands inside its image, not on the crop edge', () => {
    for (const [id, p] of Object.entries(pub.pins)) {
      expect(p.x, `${id} x`).toBeGreaterThan(0.01)
      expect(p.x, `${id} x`).toBeLessThan(0.99)
      expect(p.y, `${id} y`).toBeGreaterThan(0.01)
      expect(p.y, `${id} y`).toBeLessThan(0.99)
    }
  })

  it('rotated photos flip pins (IMG_1039 is published turned 180°)', () => {
    const c = source.IMG_1039
    expect(c.rotate180).toBe(true)
    const [x, y] = c.pins['z3-d4-001']
    expect(pub.pins['z3-d4-001'].x).toBeCloseTo(1 - (x - c.crop[0]) / (c.crop[2] - c.crop[0]), 3)
    expect(pub.pins['z3-d4-001'].y).toBeCloseTo(1 - (y - c.crop[1]) / (c.crop[3] - c.crop[1]), 3)
  })
})
