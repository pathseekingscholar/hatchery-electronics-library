import type { ProcessedPhoto } from './types'

const FULL_MAX = 1600
const THUMB_MAX = 320
const AI_MAX = 1024

async function encode(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  const webp = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/webp', quality))
  if (webp && webp.type === 'image/webp') return webp
  // Older Safari can't encode WebP; JPEG is fine too.
  const jpeg = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', quality))
  if (!jpeg) throw new Error('Could not encode image')
  return jpeg
}

function draw(source: ImageBitmap, max: number): HTMLCanvasElement {
  const scale = Math.min(1, max / Math.max(source.width, source.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(source.width * scale)
  canvas.height = Math.round(source.height * scale)
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height)
  return canvas
}

/**
 * Resize + recompress a phone photo in the browser. Re-encoding through a canvas drops all
 * EXIF/GPS metadata; `imageOrientation: 'from-image'` keeps the photo upright first.
 */
export async function processPhoto(file: File): Promise<ProcessedPhoto> {
  if (!file.type.startsWith('image/')) throw new Error('That file is not an image.')
  if (file.size > 25 * 1024 * 1024) throw new Error('That image is over 25 MB.')
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    throw new Error('This image format could not be read. Try a JPEG or PNG (HEIC from some phones is not supported by every browser).')
  }
  try {
    const full = await encode(draw(bitmap, FULL_MAX), 0.82)
    const thumb = await encode(draw(bitmap, THUMB_MAX), 0.75)
    const aiDataUrl = draw(bitmap, AI_MAX).toDataURL('image/jpeg', 0.8)
    return { full, thumb, aiDataUrl, previewUrl: URL.createObjectURL(full) }
  } finally {
    bitmap.close()
  }
}

export function extensionFor(blob: Blob) {
  return blob.type === 'image/jpeg' ? 'jpg' : 'webp'
}
