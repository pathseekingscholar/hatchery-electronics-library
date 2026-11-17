/// <reference types="vitest/config" />
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { SuggestError, suggestFromPhoto } from './supabase/functions/_shared/suggest.ts'

// Local-demo only: exposes POST /__dev/suggest-part so the demo can try photo suggestions
// with OPENROUTER_API_KEY from .env.local. The key stays in this Node process (it is not a
// VITE_ variable, so it is never bundled). Production uses the Supabase Edge Function.
function devSuggestMiddleware(env: Record<string, string>): Plugin {
  return {
    name: 'hatchery-dev-suggest',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__dev/suggest-part', (req, res) => {
        const send = (status: number, body: unknown) => {
          res.statusCode = status
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(body))
        }
        if (req.method !== 'POST') return send(405, { code: 'bad_request', message: 'POST only' })
        let raw = ''
        req.on('data', (chunk) => {
          raw += chunk
          if (raw.length > 4_000_000) req.destroy()
        })
        req.on('end', async () => {
          try {
            const body = JSON.parse(raw || '{}') as { image?: string; categories?: string[] }
            const suggestion = await suggestFromPhoto({
              apiKey: env.AI_DISABLED === 'true' ? undefined : env.OPENROUTER_API_KEY,
              model: env.OPENROUTER_MODEL,
              imageDataUrl: body.image ?? '',
              categories: body.categories ?? [],
            })
            send(200, { suggestion })
          } catch (error) {
            if (error instanceof SuggestError) return send(error.status, { code: error.code, message: error.message })
            send(500, { code: 'ai_unavailable', message: 'Unexpected error' })
          }
        })
      })
    },
  }
}

// Local dev only: serves the photo-inventory draft and its evidence photos from inventory/ so
// the review screen works without uploading anything. Never part of a production build.
function devInventoryFiles(): Plugin {
  const root = resolve(process.cwd(), 'inventory')
  return {
    name: 'hatchery-dev-inventory',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__dev/inventory/', async (req, res, next) => {
        const rel = decodeURIComponent((req.url ?? '').split('?')[0]).replace(/^\/+/, '')
        const allowed = rel === 'inventory-draft.json' || /^photos\/(web|thumb)\/IMG_\d+\.jpg$/.test(rel)
        if (!allowed) return next()
        try {
          const body = await readFile(resolve(root, rel))
          res.setHeader('Content-Type', rel.endsWith('.json') ? 'application/json' : 'image/jpeg')
          res.setHeader('Cache-Control', 'no-cache')
          res.end(body)
        } catch {
          res.statusCode = 404
          res.end('not found')
        }
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    // GitHub Pages project sites live under /<repo-name>/. `npm run build:pages` uses mode
    // "pages"; override the repo name with VITE_BASE_PATH (e.g. in .env.pages or CI).
    base: env.VITE_BASE_PATH || (mode === 'pages' ? '/hatchery-electronics-library/' : '/'),
    plugins: [react(), tailwindcss(), devSuggestMiddleware(env), devInventoryFiles()],
    test: {
      include: ['src/**/*.test.ts', 'supabase/tests/**/*.test.ts'],
      testTimeout: 60_000,
    },
  }
})
