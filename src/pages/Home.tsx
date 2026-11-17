import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { LayoutGrid, PackagePlus, PackageSearch, Search, X } from 'lucide-react'
import clsx from 'clsx'
import { useCatalog, useCatalogHelpers } from '../hooks/data'
import { bestAvailability, search, type SearchHit } from '../lib/search'
import { EmptyState, ErrorState } from '../components/ui'
import { CategoryIcon, PartCard } from '../components/PartCard'
import { CATALOG_ONLY } from '../lib/release'

// Each example returns real parts from the photo inventory (checked in photoInventorySearch.test.ts).
const EXAMPLES = ['Arduino', 'Raspberry Pi', 'NeoPixel', '220 ohm', 'soldering iron', 'multimeter']
const PAGE = 48

export function Home() {
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const cat = params.get('cat') ?? ''
  const [draft, setDraft] = useState(q)
  const [limit, setLimit] = useState(PAGE)
  const inputRef = useRef<HTMLInputElement>(null)
  const { data, error, isLoading, refetch } = useCatalog()
  const h = useCatalogHelpers(data)

  // Sync from the URL only when it changed from outside (Back button, example link).
  const pushed = useRef(q)
  useEffect(() => {
    if (q !== pushed.current) {
      pushed.current = q
      setDraft(q)
    }
  }, [q])
  // Debounced URL update so results are shareable and Back works.
  useEffect(() => {
    if (draft === q) return
    const t = setTimeout(() => {
      pushed.current = draft.trim() ? draft : ''
      const next = new URLSearchParams(params)
      if (draft.trim()) next.set('q', draft)
      else next.delete('q')
      setParams(next, { replace: true })
    }, 150)
    return () => clearTimeout(t)
  }, [draft, q, params, setParams])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = document.activeElement?.tagName
      if (e.key === '/' && tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') {
        e.preventDefault()
        inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const results: SearchHit[] = useMemo(() => {
    if (!h) return []
    const hits = draft.trim()
      ? search(h.index, draft)
      : h.catalog.parts.filter((p) => p.reviewStatus !== 'rejected')
          .sort((a, b) => bestAvailability(b) - bestAvailability(a) || a.name.localeCompare(b.name) || a.value.localeCompare(b.value, undefined, { numeric: true }))
          .map((part) => ({ part, score: 0, locationIds: [], reason: 'text' as const }))
    return cat ? hits.filter((x) => x.part.categoryId === cat) : hits
  }, [h, draft, cat])

  const setCat = (id: string) => {
    const next = new URLSearchParams(params)
    if (id) next.set('cat', id)
    else next.delete('cat')
    setParams(next)
    setLimit(PAGE)
  }

  const counts = useMemo(() => {
    const m = new Map<string, number>()
    h?.catalog.parts.forEach((p) => p.categoryId && m.set(p.categoryId, (m.get(p.categoryId) ?? 0) + 1))
    return m
  }, [h])

  const chip = (active: boolean) =>
    clsx(
      'inline-flex min-h-10 items-center gap-2 whitespace-nowrap rounded-xl border px-3.5 text-sm font-medium transition-colors',
      active
        ? 'border-maroon bg-maroon text-white shadow-[0_6px_16px_-8px_rgb(138_16_11/0.6)]'
        : 'border-line bg-surface text-ink-2 hover:border-gold-light hover:bg-gold-tint hover:text-ink',
    )

  return (
    <div>
      <section className="mb-6">
        <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">
          Find a part, <span className="text-maroon">find the drawer.</span>
        </h1>
        <p className="mt-1 text-ink-2">Search by name, value, or part number.</p>

        <form
          role="search"
          onSubmit={(e) => {
            e.preventDefault()
            inputRef.current?.blur()
          }}
          className="mt-5 flex gap-3"
        >
          <label htmlFor="q" className="sr-only">Search parts</label>
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-3" aria-hidden />
            <input
              ref={inputRef}
              id="q"
              type="search"
              inputMode="search"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="search"
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value)
                setLimit(PAGE)
              }}
              placeholder="Try Arduino, relay, Weller…"
              className="h-14 w-full rounded-2xl border border-line bg-surface pl-12 pr-12 text-lg shadow-[0_12px_32px_-18px_rgb(74_10_7/0.35)] transition placeholder:text-ink-3 focus-visible:border-maroon focus-visible:shadow-[0_0_0_4px_rgb(138_16_11/0.14)] focus-visible:outline-none [&::-webkit-search-cancel-button]:hidden"
            />
            {draft && (
              <button
                type="button"
                onClick={() => {
                  setDraft('')
                  inputRef.current?.focus()
                }}
                className="absolute right-2 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-xl text-ink-3 hover:bg-maroon-tint hover:text-maroon"
                aria-label="Clear search"
              >
                <X className="h-5 w-5" />
              </button>
            )}
          </div>
          {!CATALOG_ONLY && (
            <Link to="/request" className="btn btn-primary hidden h-14 rounded-2xl px-5 sm:inline-flex">
              <PackagePlus className="h-5 w-5" aria-hidden /> Request a part
            </Link>
          )}
        </form>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-ink-3">Try</span>
          {EXAMPLES.map((ex) => (
            <button
              type="button"
              key={ex}
              onClick={() => setDraft(ex)}
              className="min-h-8 rounded-full bg-maroon-tint px-3 font-medium text-maroon-dark transition-colors hover:bg-maroon hover:text-white"
            >
              {ex}
            </button>
          ))}
        </div>
      </section>

      {error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : isLoading || !h ? (
        <GridSkeleton />
      ) : (
        <>
          <nav aria-label="Categories" className="no-scrollbar -mx-4 mb-5 overflow-x-auto px-4 sm:mx-0 sm:px-0">
            <ul className="flex gap-2 pb-1 sm:flex-wrap">
              <li>
                <button onClick={() => setCat('')} aria-pressed={!cat} className={chip(!cat)}>
                  <LayoutGrid className="h-4 w-4" aria-hidden /> All
                </button>
              </li>
              {h.catalog.categories
                .filter((c) => counts.get(c.id))
                .map((c) => (
                    <li key={c.id}>
                      <button onClick={() => setCat(cat === c.id ? '' : c.id)} aria-pressed={cat === c.id} className={chip(cat === c.id)}>
                        <CategoryIcon name={c.name} className="h-4 w-4" /> {c.name}
                      </button>
                    </li>
                ))}
            </ul>
          </nav>

          <section aria-live="polite" aria-label="Results">
            <p className="mb-3 text-sm text-ink-3">
              {results.length} {results.length === 1 ? 'part' : 'parts'}
              {draft.trim() && <> for “{draft.trim()}”</>}
              {cat && <> in {h.catById.get(cat)}</>}
            </p>
            {results.length ? (
              <>
                <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3 2xl:grid-cols-4">
                  {results.slice(0, limit).map((hit) => (
                    <PartCard key={hit.part.id} part={hit.part} h={h} matchedLocations={hit.locationIds} />
                  ))}
                </ul>
                {results.length > limit && (
                  <div className="mt-6 text-center">
                    <button className="btn btn-secondary" onClick={() => setLimit((l) => l + PAGE)}>
                      Show more ({results.length - limit} left)
                    </button>
                  </div>
                )}
              </>
            ) : h.catalog.parts.length === 0 ? (
              <EmptyState title="The catalog is empty" icon={<PackageSearch className="h-8 w-8" />}>
                Staff haven’t added any parts yet.
              </EmptyState>
            ) : (
              <EmptyState title="No parts match" icon={<PackageSearch className="h-8 w-8" />}>
                <p>
                  Check the spelling, or try a part number or a value like <span className="font-mono">10k</span>.
                  {cat && (
                    <>
                      {' '}You’re filtering by <strong>{h.catById.get(cat)}</strong> —{' '}
                      <button className="font-semibold text-maroon underline" onClick={() => setCat('')}>show all</button>.
                    </>
                  )}
                </p>
                {CATALOG_ONLY ? (
                  <p className="mt-3">Not listed? Ask staff at the electronics desk — the catalog is still being completed.</p>
                ) : (
                  <Link to={`/request${draft.trim() ? `?part=${encodeURIComponent(draft.trim())}` : ''}`} className="btn btn-primary mt-4">
                    <PackagePlus className="h-5 w-5" aria-hidden /> Request this part
                  </Link>
                )}
              </EmptyState>
            )}
          </section>
        </>
      )}
    </div>
  )
}

function GridSkeleton() {
  return (
    <ul aria-hidden className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
      {Array.from({ length: 6 }, (_, i) => (
        <li key={i} className="card flex h-28 animate-pulse overflow-hidden sm:h-64 sm:flex-col">
          <div className="w-28 bg-gold-tint sm:h-36 sm:w-auto" />
          <div className="flex-1 space-y-2 p-4">
            <div className="h-3 w-2/3 rounded bg-label" />
            <div className="h-3 w-1/3 rounded bg-label" />
          </div>
        </li>
      ))}
    </ul>
  )
}
