import { useRef, useState, type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { Camera, ImagePlus } from 'lucide-react'
import clsx from 'clsx'
import { useStaff } from '../hooks/data'
import { flattenTree } from '../lib/locations'
import { processPhoto } from '../lib/images'
import { errorMessage } from '../lib/format'
import type { Location, ProcessedPhoto, StockStatus } from '../lib/types'
import { Notice, Spinner } from './ui'

/** UI guard only — the backend (RLS / RPC checks) is what actually enforces staff access. */
export function RequireStaff({ children }: { children: ReactNode }) {
  const { data: staff, isLoading } = useStaff()
  const location = useLocation()
  if (isLoading) return <Spinner className="py-10" />
  if (!staff) return <Navigate to="/admin" replace state={{ from: location.pathname + location.search }} />
  return <>{children}</>
}

/** Admin-only pages (People). The set_member_role RPC enforces the same rule. */
export function RequireAdmin({ children }: { children: ReactNode }) {
  const { data: staff, isLoading } = useStaff()
  const location = useLocation()
  if (isLoading) return <Spinner className="py-10" />
  if (!staff) return <Navigate to="/admin" replace state={{ from: location.pathname }} />
  if (staff.role !== 'admin') return <Notice tone="warn">Only admins can manage people.</Notice>
  return <>{children}</>
}

export function LocationSelect({
  locations, value, onChange, id, placeholder = 'Choose a location…', exclude, required,
}: {
  locations: Location[]; value: string; onChange: (id: string) => void; id?: string; placeholder?: string
  exclude?: string[]; required?: boolean
}) {
  return (
    <select id={id} className="field" value={value} onChange={(e) => onChange(e.target.value)} required={required}>
      <option value="">{placeholder}</option>
      {flattenTree(locations).map(({ location: l, depth }) => (
        <option key={l.id} value={l.id} disabled={exclude?.includes(l.id)}>
          {'  '.repeat(depth)}
          {l.code} — {l.name}
        </option>
      ))}
    </select>
  )
}

const STATUSES: Array<{ value: StockStatus; label: string; cls: string }> = [
  { value: 'in_stock', label: 'In stock', cls: 'aria-checked:bg-ok aria-checked:text-white aria-checked:border-ok' },
  { value: 'low', label: 'Low', cls: 'aria-checked:bg-low aria-checked:text-white aria-checked:border-low' },
  { value: 'out', label: 'Out', cls: 'aria-checked:bg-out aria-checked:text-white aria-checked:border-out' },
  { value: 'unverified', label: 'Unverified', cls: 'aria-checked:bg-ink-2 aria-checked:text-white aria-checked:border-ink-2' },
]

/** Large tap targets, arrow-key navigation like a radio group. */
export function StatusPicker({ value, onChange, label, disabled }: { value: StockStatus; onChange: (s: StockStatus) => void; label: string; disabled?: boolean }) {
  const refs = useRef<Array<HTMLButtonElement | null>>([])
  return (
    <div role="radiogroup" aria-label={label} className="grid grid-cols-4 gap-1">
      {STATUSES.map((s, i) => (
        <button
          key={s.value}
          ref={(el) => { refs.current[i] = el }}
          type="button"
          role="radio"
          aria-checked={value === s.value}
          tabIndex={value === s.value ? 0 : -1}
          disabled={disabled}
          onClick={() => onChange(s.value)}
          onKeyDown={(e) => {
            const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
            if (!d) return
            e.preventDefault()
            const next = (i + d + STATUSES.length) % STATUSES.length
            onChange(STATUSES[next].value)
            refs.current[next]?.focus()
          }}
          className={clsx(
            'min-h-11 rounded-md border border-line-strong bg-surface px-1 text-sm font-semibold text-ink-2 hover:border-ink disabled:opacity-50',
            s.cls,
          )}
        >
          {s.label}
        </button>
      ))}
    </div>
  )
}

/** Take photo (rear camera on phones) or upload from the library. Resizes + strips metadata. */
export function PhotoPicker({ onPhoto, label = 'Part photo', compact }: { onPhoto: (p: ProcessedPhoto) => void; label?: string; compact?: boolean }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const handle = async (file: File | undefined) => {
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      onPhoto(await processPhoto(file))
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div>
      <div className={clsx('grid gap-2', compact ? 'grid-cols-2' : 'grid-cols-2')}>
        <label className={clsx('btn btn-secondary', busy && 'pointer-events-none opacity-60')}>
          <Camera className="h-5 w-5" aria-hidden /> Take photo
          <input type="file" accept="image/*" capture="environment" className="sr-only" aria-label={`${label}: take photo`} onChange={(e) => { handle(e.target.files?.[0]); e.target.value = '' }} />
        </label>
        <label className={clsx('btn btn-secondary', busy && 'pointer-events-none opacity-60')}>
          <ImagePlus className="h-5 w-5" aria-hidden /> Upload photo
          <input type="file" accept="image/*" className="sr-only" aria-label={`${label}: upload photo`} onChange={(e) => { handle(e.target.files?.[0]); e.target.value = '' }} />
        </label>
      </div>
      {busy && <Spinner label="Resizing photo…" className="mt-2 text-sm" />}
      {error && <div className="mt-2"><Notice tone="error">{error}</Notice></div>}
    </div>
  )
}

const WORKING_KEY = 'hatchery-working-location'
export function getWorkingLocation(): string {
  try {
    return localStorage.getItem(WORKING_KEY) ?? ''
  } catch {
    return ''
  }
}
export function setWorkingLocation(id: string) {
  try {
    if (id) localStorage.setItem(WORKING_KEY, id)
    else localStorage.removeItem(WORKING_KEY)
  } catch {
    // ignore (private mode)
  }
}
