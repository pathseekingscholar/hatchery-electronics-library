/**
 * Release info and the catalog-only switch.
 *
 * A production build without Supabase (e.g. the public GitHub Pages demo) has no shared database,
 * so anything that writes — requests, posts, sign-in, editing — would only save into the visitor's
 * own browser and look like it worked. In that case the app runs **catalog-only**: those features
 * are hidden from navigation and their routes show "Coming soon". Local development keeps the full
 * in-browser demo so the staff features can still be worked on.
 */
export const RELEASE = { version: '0.1', name: 'Electronics Parts Finder' } as const

const hasSupabase = Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY)

export const CATALOG_ONLY = !hasSupabase && (!import.meta.env.DEV || import.meta.env.VITE_CATALOG_ONLY === 'true')
