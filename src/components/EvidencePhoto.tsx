import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ImageOff, Maximize2 } from 'lucide-react'
import { backend } from '../backend'
import { Modal } from './ui'

function useEvidenceUrl(file: string, size: 'thumb' | 'web', enabled = true) {
  return useQuery({
    queryKey: ['evidence', file, size],
    queryFn: () => backend.evidencePhotoUrl(file, size),
    staleTime: 40 * 60_000,
    enabled,
  })
}

const label = (file: string) => file.replace(/\.(heic|heif|jpe?g|png)$/i, '')

/** Thumbnail of an original workspace photo; tap to open it large. Staff only. */
export function EvidencePhoto({ file, size = 88 }: { file: string; size?: number }) {
  const [open, setOpen] = useState(false)
  const thumb = useEvidenceUrl(file, 'thumb')
  const full = useEvidenceUrl(file, 'web', open)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group relative shrink-0 overflow-hidden rounded-xl border border-line bg-label"
        style={{ width: size, height: size }}
        aria-label={`Open photo ${label(file)}`}
      >
        {thumb.data ? (
          <img src={thumb.data} alt="" loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-ink-3">
            <ImageOff className="h-5 w-5" aria-hidden />
          </span>
        )}
        <span className="absolute inset-x-0 bottom-0 bg-ink/60 px-1 py-0.5 text-center font-mono text-[0.65rem] text-white">{label(file)}</span>
        <Maximize2 className="absolute right-1 top-1 h-3.5 w-3.5 text-white opacity-0 drop-shadow group-hover:opacity-100" aria-hidden />
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={`Photo ${label(file)}`} wide>
        {full.data ? (
          <img src={full.data} alt={`Workspace photo ${label(file)}`} className="max-h-[75vh] w-full rounded-lg object-contain" />
        ) : full.isLoading ? (
          <p className="text-ink-3">Loading…</p>
        ) : (
          <p className="text-ink-2">
            This photo isn’t available here. In production, run <code>scripts/inventory/upload-evidence.mjs</code> once to upload the evidence photos to private storage.
          </p>
        )}
      </Modal>
    </>
  )
}

export function EvidenceStrip({ files, size }: { files: string[]; size?: number }) {
  if (!files.length) return null
  return (
    <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
      {files.map((f) => <EvidencePhoto key={f} file={f} size={size} />)}
    </div>
  )
}
