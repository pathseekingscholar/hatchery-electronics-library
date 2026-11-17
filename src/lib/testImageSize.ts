// Test helper: read a JPEG's pixel size from its SOF marker (no image library needed).
import { readFileSync } from 'node:fs'

export function imageSize(file: string): { width: number; height: number } {
  const b = readFileSync(file)
  let i = 2
  while (i < b.length) {
    if (b[i] !== 0xff) throw new Error(`not a JPEG: ${file}`)
    const marker = b[i + 1]
    const len = b.readUInt16BE(i + 2)
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) }
    }
    i += 2 + len
  }
  throw new Error(`no size in ${file}`)
}
