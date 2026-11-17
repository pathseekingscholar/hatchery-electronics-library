import { useState } from 'react'
import { Maximize2 } from 'lucide-react'
import clsx from 'clsx'
import type { DrawerView, Pin } from '../lib/locationPhotos'
import { Modal } from './ui'

/**
 * Photo frame whose box has exactly the image's aspect ratio, so the image fills it with no
 * letterboxing and pin percentages map 1:1 onto the drawn photo at every size. (Using
 * `object-contain` inside a full-width box letterboxes the photo while the pin stays relative to
 * the box — that was the cause of misplaced pins.)
 */
function PinnedImage({ view, pin, label, alt, maxHeight, enlargeIcon }: { view: DrawerView; pin?: Pin | null; label?: string; alt: string; maxHeight: string; enlargeIcon?: boolean }) {
  const ratio = view.width / view.height
  return (
    <div
      className="relative mx-auto overflow-hidden rounded-xl bg-label [container-type:inline-size]"
      style={{ aspectRatio: `${view.width} / ${view.height}`, width: `min(100%, calc(${maxHeight} * ${ratio}))` }}
      data-photo={view.key}
    >
      <img src={view.url} width={view.width} height={view.height} loading="lazy" alt={alt} className="absolute inset-0 h-full w-full" />
      <span className="absolute left-2 top-2 rounded-md bg-ink/75 px-1.5 py-0.5 text-[0.65rem] font-semibold text-white">Location reference</span>
      {enlargeIcon && <Maximize2 className="absolute right-2 top-2 h-7 w-7 rounded-lg bg-ink/60 p-1.5 text-white opacity-80 group-hover:opacity-100" aria-hidden />}
      {pin && (
        <span
          className="pointer-events-none absolute"
          style={{ left: `${pin.x * 100}%`, top: `${pin.y * 100}%` }}
          data-pin={`${pin.x},${pin.y}`}
          aria-hidden
        >
          <span className="absolute -left-5 -top-5 h-10 w-10 animate-ping rounded-full bg-maroon/40 motion-reduce:animate-none" />
          <span className="absolute -left-3.5 -top-3.5 h-7 w-7 rounded-full border-[3px] border-white bg-maroon shadow-lg" />
          {label && (
            <span
              className={clsx(
                'absolute left-0 max-w-[min(12rem,80cqw)] truncate whitespace-nowrap rounded-lg bg-ink/85 px-2 py-1 text-xs font-semibold text-white shadow',
                pin.y > 0.8 ? '-top-12' : 'top-4',
              )}
              // slide the label by the pin's own x so it always stays inside the photo
              style={{ transform: `translateX(-${pin.x * 100}%)` }}
            >
              {label}
            </span>
          )}
        </span>
      )}
    </div>
  )
}

/** A drawer photo (location reference) with an optional pin on the part. Tap to enlarge. */
export function DrawerPhoto({ view, pin, label, caption, className }: { view: DrawerView; pin?: Pin | null; label?: string; caption: string; className?: string }) {
  const [open, setOpen] = useState(false)
  const alt = pin && label ? `${caption}, with ${label} marked` : caption
  return (
    <figure className={className}>
      <button type="button" onClick={() => setOpen(true)} className="group relative block w-full text-left" aria-label={`Enlarge: ${caption}`}>
        <PinnedImage view={view} pin={pin} label={label} alt={alt} maxHeight="20rem" enlargeIcon />
      </button>
      <figcaption className="mt-1.5 text-xs text-ink-3">
        {caption}
        {label && (pin ? ' — the red pin marks this part.' : ' — this part isn’t pinned in the photo; look around the drawer.')} Photo from 2026-11-16.
      </figcaption>
      <Modal open={open} onClose={() => setOpen(false)} title={caption} wide>
        <PinnedImage view={view} pin={pin} label={label} alt={alt} maxHeight="75vh" />
      </Modal>
    </figure>
  )
}
