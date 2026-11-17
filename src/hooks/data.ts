import { useEffect, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { backend } from '../backend'
import { buildIndex } from '../lib/search'
import type { Catalog, Location } from '../lib/types'

/** The signed-in BC account (any role), or null. */
export function useUser() {
  const qc = useQueryClient()
  useEffect(
    () =>
      backend.onAuthChange(() => {
        qc.invalidateQueries({ queryKey: ['user'] })
        qc.invalidateQueries({ queryKey: ['catalog'] })
        qc.invalidateQueries({ queryKey: ['posts'] })
        qc.removeQueries({ queryKey: ['requests'] })
        qc.removeQueries({ queryKey: ['members'] })
      }),
    [qc],
  )
  return useQuery({ queryKey: ['user'], queryFn: () => backend.getUser(), staleTime: 60_000 })
}

/** The signed-in user if they are staff or admin, else null. */
export function useStaff() {
  const q = useUser()
  const u = q.data
  return { ...q, data: u && u.role !== 'member' ? { id: u.id, email: u.email, displayName: u.displayName, role: u.role } : null }
}

export function useCatalog() {
  const qc = useQueryClient()
  useEffect(() => backend.onCatalogChange(() => qc.invalidateQueries({ queryKey: ['catalog'] })), [qc])
  const query = useQuery({
    queryKey: ['catalog'],
    queryFn: () => backend.getCatalog(),
    staleTime: 20_000,
    refetchInterval: 60_000,
  })
  return query
}

export interface CatalogHelpers {
  catalog: Catalog
  locById: Map<string, Location>
  catById: Map<string, string>
  index: ReturnType<typeof buildIndex>
}

export function useCatalogHelpers(catalog: Catalog | undefined): CatalogHelpers | null {
  return useMemo(() => {
    if (!catalog) return null
    return {
      catalog,
      locById: new Map(catalog.locations.map((l) => [l.id, l])),
      catById: new Map(catalog.categories.map((c) => [c.id, c.name])),
      // rejected and merged-away records stay in the database for audit, but nobody searches them
      index: buildIndex({ ...catalog, parts: catalog.parts.filter((p) => p.reviewStatus !== 'rejected') }),
    }
  }, [catalog])
}

export function useRequests(enabled: boolean) {
  return useQuery({
    queryKey: ['requests'],
    queryFn: () => backend.listRequests(),
    enabled,
    refetchInterval: 30_000,
  })
}
