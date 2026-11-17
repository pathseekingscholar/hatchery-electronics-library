import { DemoBackend } from './demo'
import { SupabaseBackend } from './supabase'
import type { Backend } from './types'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/** Supabase when configured; otherwise the clearly labeled in-browser demo. */
export const backend: Backend = url && anonKey ? new SupabaseBackend(url, anonKey) : new DemoBackend()
export const isDemo = backend.mode === 'demo'
export type { Backend }
