// Supabase Edge Function: POST /functions/v1/suggest-part
// Staff-only. Sends a (client-resized) photo to an image-capable OpenRouter model and
// returns editable suggestions. The OpenRouter key never leaves the server.
//
// Secrets (set with `supabase secrets set ...`):
//   OPENROUTER_API_KEY   required for suggestions; without it the function returns 503 and
//                        the app falls back to manual entry.
//   OPENROUTER_MODEL     optional, defaults to google/gemini-2.5-flash
//   ALLOWED_ORIGIN       optional, e.g. https://<org>.github.io  (defaults to *)
import { createClient } from 'npm:@supabase/supabase-js@2'
import { SuggestError, suggestFromPhoto } from '../_shared/suggest.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ code: 'bad_request', message: 'POST only' }, 405)

  const authHeader = req.headers.get('Authorization') ?? ''
  // Use the caller's JWT so RLS + is_staff() decide access; no service-role key needed here.
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  })

  // Staff check + per-user rate limit (30 / 10 min), enforced in Postgres.
  const { error: quotaError } = await supabase.rpc('claim_ai_quota')
  if (quotaError) {
    if (quotaError.message.includes('rate_limited')) {
      return json({ code: 'ai_rate_limited', message: 'Too many photo suggestions. Wait a few minutes.' }, 429)
    }
    return json({ code: 'forbidden', message: 'Staff sign-in required.' }, 403)
  }

  let body: { image?: string }
  try {
    body = await req.json()
  } catch {
    return json({ code: 'bad_request', message: 'Invalid JSON' }, 400)
  }

  const { data: categories } = await supabase.from('categories').select('name').order('sort')

  try {
    const suggestion = await suggestFromPhoto({
      apiKey: Deno.env.get('OPENROUTER_API_KEY'),
      model: Deno.env.get('OPENROUTER_MODEL'),
      imageDataUrl: body.image ?? '',
      categories: (categories ?? []).map((c: { name: string }) => c.name),
      referer: req.headers.get('origin') ?? undefined,
    })
    return json({ suggestion })
  } catch (error) {
    if (error instanceof SuggestError) return json({ code: error.code, message: error.message }, error.status)
    console.error(error)
    return json({ code: 'ai_unavailable', message: 'Unexpected error. Enter details manually.' }, 500)
  }
})
