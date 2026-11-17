import { useMemo, useState, type ReactNode } from 'react'
import { Sparkles, TriangleAlert } from 'lucide-react'
import { backend } from '../backend'
import { search, type SearchIndex } from '../lib/search'
import { errorMessage } from '../lib/format'
import type { Category, Part, PhotoSuggestion } from '../lib/types'
import { Notice, Spinner } from './ui'
import { PartThumb } from './inventory'

export interface AcceptedFields {
  name?: string
  categoryId?: string
  description?: string
  partNumber?: string
  aliases?: string[]
}

/**
 * Optional helper. Suggestions are never saved directly: staff tick the fields they want,
 * edit them, and choose whether they go into a new part or update an existing one.
 */
export function AiSuggestPanel({
  aiDataUrl, categories, index, currentPartId, onApply, onUseExisting,
}: {
  aiDataUrl: string
  categories: Category[]
  index: SearchIndex
  currentPartId?: string
  onApply: (fields: AcceptedFields) => void
  onUseExisting: (part: Part, fields: AcceptedFields) => void
}) {
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [error, setError] = useState('')
  const [s, setS] = useState<PhotoSuggestion | null>(null)
  const [use, setUse] = useState({ name: true, category: true, description: true })
  const [name, setName] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [description, setDescription] = useState('')
  const [markingAs, setMarkingAs] = useState<Record<string, 'none' | 'pn' | 'alias'>>({})

  const run = async () => {
    setState('loading')
    try {
      const result = await backend.suggestFromPhoto(aiDataUrl, categories.map((c) => c.name))
      setS(result)
      setName(result.name ?? '')
      setDescription(result.description ?? '')
      setCategoryId(categories.find((c) => c.name === result.category)?.id ?? '')
      setUse({ name: Boolean(result.name), category: Boolean(result.category), description: Boolean(result.description) })
      setMarkingAs({})
      setState('done')
    } catch (e) {
      setError(errorMessage(e))
      setState('error')
    }
  }

  const matches = useMemo(() => {
    if (!s) return []
    const terms = [...s.visibleMarkings, s.name ?? ''].filter(Boolean)
    const seen = new Map<string, { part: Part; score: number }>()
    for (const t of terms) {
      for (const hit of search(index, t).slice(0, 5)) {
        const prev = seen.get(hit.part.id)
        if (!prev || prev.score < hit.score) seen.set(hit.part.id, { part: hit.part, score: hit.score })
      }
    }
    return [...seen.values()].filter((m) => m.part.id !== currentPartId).sort((a, b) => b.score - a.score).slice(0, 4)
  }, [s, index, currentPartId])

  const accepted = (): AcceptedFields => {
    const f: AcceptedFields = {}
    if (use.name && name.trim()) f.name = name.trim()
    if (use.category && categoryId) f.categoryId = categoryId
    if (use.description && description.trim()) f.description = description.trim()
    const pn = Object.entries(markingAs).find(([, v]) => v === 'pn')?.[0]
    if (pn) f.partNumber = pn
    const aliases = Object.entries(markingAs).filter(([, v]) => v === 'alias').map(([k]) => k)
    if (aliases.length) f.aliases = aliases
    return f
  }

  if (state === 'idle' || state === 'error') {
    return (
      <div className="space-y-2">
        <button type="button" className="btn btn-secondary w-full" onClick={run}>
          <Sparkles className="h-4 w-4" aria-hidden /> Suggest details from photo
        </button>
        {state === 'error' && <Notice tone="warn">{error} Manual entry below still works.</Notice>}
      </div>
    )
  }
  if (state === 'loading') return <Spinner label="Looking at the photo…" className="justify-center py-3" />

  return (
    <section aria-label="Photo suggestions" className="rounded-lg border-2 border-dashed border-line-strong bg-surface p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-semibold"><Sparkles className="h-4 w-4 text-maroon" aria-hidden /> Suggestions — review before using</h3>
        <span className="text-xs text-ink-3">Confidence: {s!.confidence}</span>
      </div>
      {s!.ambiguous && (
        <div className="mb-3 flex gap-2 rounded-md bg-low-bg p-2 text-sm text-low">
          <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden />
          <span><strong>Not sure from this photo.</strong> {s!.ambiguityNote ?? 'Check the part before using these suggestions.'}</span>
        </div>
      )}
      <div className="space-y-3">
        <Row label="Name" checked={use.name} onCheck={(v) => setUse({ ...use, name: v })} disabled={!s!.name}>
          <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="No suggestion" aria-label="Suggested name" />
        </Row>
        <Row label="Category" checked={use.category} onCheck={(v) => setUse({ ...use, category: v })} disabled={!s!.category}>
          <select className="field" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} aria-label="Suggested category">
            <option value="">No suggestion</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Row>
        <Row label="Description" checked={use.description} onCheck={(v) => setUse({ ...use, description: v })} disabled={!s!.description}>
          <textarea className="field min-h-16" value={description} onChange={(e) => setDescription(e.target.value)} aria-label="Suggested description" />
        </Row>
        <div>
          <p className="label">Visible markings</p>
          {s!.visibleMarkings.length ? (
            <>
              <p className="mb-2 text-xs text-ink-3">Copied from the photo as-is. Only use one as the part number if you’ve confirmed it on the part.</p>
              <ul className="space-y-1.5">
                {s!.visibleMarkings.map((m) => (
                  <li key={m} className="flex flex-wrap items-center gap-2">
                    <span className="rounded bg-label px-2 py-1 font-mono text-sm">{m}</span>
                    <select
                      className="field !min-h-9 !w-auto !py-1 text-sm"
                      value={markingAs[m] ?? 'none'}
                      onChange={(e) => {
                        const v = e.target.value as 'none' | 'pn' | 'alias'
                        setMarkingAs((prev) => {
                          const next = { ...prev }
                          if (v === 'pn') for (const k of Object.keys(next)) if (next[k] === 'pn') next[k] = 'none'
                          next[m] = v
                          return next
                        })
                      }}
                      aria-label={`Use marking ${m} as`}
                    >
                      <option value="none">Don’t use</option>
                      <option value="pn">Use as part number</option>
                      <option value="alias">Add as alias</option>
                    </select>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-sm text-ink-3">None legible.</p>
          )}
        </div>
      </div>

      {matches.length > 0 && (
        <div className="mt-4">
          <p className="label">Possibly already in the catalog</p>
          <ul className="space-y-2">
            {matches.map(({ part }) => (
              <li key={part.id} className="flex items-center gap-3 rounded-md border border-line p-2">
                <PartThumb part={part} size={40} />
                <span className="min-w-0 flex-1 truncate text-sm">
                  <strong>{part.name}</strong> {part.value && <span className="font-semibold">{part.value}</span>} {part.partNumber && <span className="font-mono text-ink-3">{part.partNumber}</span>}
                </span>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => onUseExisting(part, accepted())}>Update this part</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" className="btn btn-primary" onClick={() => { onApply(accepted()); setState('idle') }}>
          {currentPartId ? 'Apply ticked fields to this part' : 'Create new part with ticked fields'}
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => setState('idle')}>Reject suggestions</button>
      </div>
      <p className="mt-2 text-xs text-ink-3">Nothing is saved until you press Save.</p>
    </section>
  )
}

function Row({ label, checked, onCheck, disabled, children }: { label: string; checked: boolean; onCheck: (v: boolean) => void; disabled?: boolean; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[auto_1fr] items-start gap-2">
      <input type="checkbox" className="mt-3 h-5 w-5 accent-maroon" checked={checked && !disabled} disabled={disabled} onChange={(e) => onCheck(e.target.checked)} aria-label={`Use suggested ${label.toLowerCase()}`} />
      <div>
        <p className="label !mb-1">{label}</p>
        {children}
      </div>
    </div>
  )
}
