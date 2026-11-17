import { useEffect, useRef, type ReactNode } from 'react'
import { AlertTriangle, Loader2, X } from 'lucide-react'
import clsx from 'clsx'

export function Spinner({ label = 'Loading…', className }: { label?: string; className?: string }) {
  return (
    <div role="status" className={clsx('flex items-center gap-2 text-ink-3', className)}>
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      <span>{label}</span>
    </div>
  )
}

export function SkeletonRows({ count = 5 }: { count?: number }) {
  return (
    <div aria-hidden className="space-y-2">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="card flex h-[76px] animate-pulse items-center gap-3 p-3">
          <div className="h-12 w-12 rounded bg-label" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-1/3 rounded bg-label" />
            <div className="h-3 w-1/5 rounded bg-label" />
          </div>
          <div className="h-8 w-20 rounded bg-label" />
        </div>
      ))}
    </div>
  )
}

export function EmptyState({ title, children, icon }: { title: string; children?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center px-6 py-10 text-center">
      {icon && <div className="mb-3 text-ink-3">{icon}</div>}
      <p className="text-lg font-semibold">{title}</p>
      {children && <div className="mt-2 max-w-md text-ink-2">{children}</div>}
    </div>
  )
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = error instanceof Error ? error.message : 'Something went wrong.'
  return (
    <div role="alert" className="card flex flex-col items-start gap-3 border-out/40 bg-out-bg/40 p-4 sm:flex-row sm:items-center">
      <AlertTriangle className="h-5 w-5 shrink-0 text-out" aria-hidden />
      <div className="flex-1">
        <p className="font-semibold">Couldn’t load this</p>
        <p className="text-sm text-ink-2">{message}</p>
      </div>
      {onRetry && (
        <button className="btn btn-secondary btn-sm" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  )
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'error' | 'ok'; children: ReactNode }) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={clsx(
        'rounded-md border px-3 py-2 text-sm',
        tone === 'info' && 'border-line bg-label/60 text-ink-2',
        tone === 'warn' && 'border-low/30 bg-low-bg text-low',
        tone === 'error' && 'border-out/30 bg-out-bg text-out',
        tone === 'ok' && 'border-ok/30 bg-ok-bg text-ok',
      )}
    >
      {children}
    </div>
  )
}

/** Accessible modal using the native <dialog> element (focus trap + Esc for free). */
export function Modal({
  open, onClose, title, children, wide,
}: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (open && !el.open) el.showModal()
    if (!open && el.open) el.close()
  }, [open])
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={onClose}
      aria-labelledby="modal-title"
      className={clsx(
        'm-auto w-[calc(100%-1.5rem)] rounded-lg border border-line bg-surface p-0 text-ink shadow-xl',
        wide ? 'max-w-2xl' : 'max-w-md',
      )}
    >
      {open && (
        <div className="p-5">
          <div className="mb-4 flex items-start justify-between gap-4">
            <h2 id="modal-title" className="text-xl font-bold">
              {title}
            </h2>
            <button className="btn btn-ghost btn-sm -mr-2 -mt-1 px-2" onClick={onClose} aria-label="Close">
              <X className="h-5 w-5" />
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  )
}
