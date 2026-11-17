// Shared, runtime-agnostic logic for "Suggest details from photo".
// Used by the Supabase Edge Function (Deno) and by the local Vite dev middleware (Node).
// It only depends on `fetch`, so it runs in both.

export interface PhotoSuggestion {
  name: string | null
  category: string | null
  description: string | null
  visibleMarkings: string[]
  ambiguous: boolean
  ambiguityNote: string | null
  confidence: 'high' | 'medium' | 'low'
}

export class SuggestError extends Error {
  code: 'ai_unconfigured' | 'ai_rate_limited' | 'ai_unavailable' | 'bad_request'
  status: number
  constructor(code: SuggestError['code'], status: number, message: string) {
    super(message)
    this.code = code
    this.status = status
  }
}

export const DEFAULT_MODEL = 'google/gemini-2.5-flash'
const MAX_IMAGE_CHARS = 3_000_000 // ~2.2 MB base64; client sends ~1024px JPEG

const SYSTEM_PROMPT = `You help staff catalog electronics parts at a university makerspace from a single photo.
Return ONLY a JSON object with exactly these keys:
{"name": string|null, "category": string|null, "description": string|null, "visible_markings": string[], "ambiguous": boolean, "ambiguity_note": string|null, "confidence": "high"|"medium"|"low"}
Rules:
- "name": a short generic name of the kind of part you see (e.g. "Through-hole resistor", "Electrolytic capacitor", "Arduino Nano-style board"). Use null if you cannot tell.
- "category": choose one from the provided category list, or null.
- "description": one short factual sentence about what is visible. No marketing.
- "visible_markings": copy text, color bands, or codes EXACTLY as printed/visible on the part. Do not decode them, do not guess missing characters. Empty array if none are legible.
- NEVER state a part number, resistance/capacitance/voltage value, quantity, or storage location unless it is literally printed in "visible_markings". Do not put values in "name".
- If the photo is blurry, shows several different parts, or the part could be several things, set "ambiguous": true and explain briefly in "ambiguity_note".`

function clean(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim().replace(/\s+/g, ' ')
  if (!trimmed) return null
  return trimmed.slice(0, max)
}

export function parseSuggestion(raw: string, categories: string[]): PhotoSuggestion {
  const jsonText = raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(jsonText)
  } catch {
    throw new SuggestError('ai_unavailable', 502, 'The AI returned something we could not read.')
  }
  const category = clean(parsed.category, 60)
  const markings = Array.isArray(parsed.visible_markings)
    ? parsed.visible_markings.map((m) => clean(m, 60)).filter((m): m is string => Boolean(m)).slice(0, 8)
    : []
  const confidence = parsed.confidence === 'high' || parsed.confidence === 'medium' ? parsed.confidence : 'low'
  return {
    name: clean(parsed.name, 80),
    // Only accept categories that exist in the catalog; never invent a new one.
    category: category && categories.find((c) => c.toLowerCase() === category.toLowerCase()) ? category : null,
    description: clean(parsed.description, 240),
    visibleMarkings: markings,
    ambiguous: parsed.ambiguous === true || confidence === 'low',
    ambiguityNote: clean(parsed.ambiguity_note, 240),
    confidence,
  }
}

export async function suggestFromPhoto(opts: {
  apiKey: string | undefined
  model?: string
  imageDataUrl: string
  categories: string[]
  referer?: string
}): Promise<PhotoSuggestion> {
  if (!opts.apiKey) {
    throw new SuggestError('ai_unconfigured', 503, 'Photo suggestions are not configured. Enter details manually.')
  }
  if (!/^data:image\/(jpeg|png|webp);base64,/.test(opts.imageDataUrl) || opts.imageDataUrl.length > MAX_IMAGE_CHARS) {
    throw new SuggestError('bad_request', 400, 'Send a JPEG, PNG, or WebP image under about 2 MB.')
  }

  let response: Response
  try {
    response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        'Content-Type': 'application/json',
        'X-Title': 'Hatchery Electronics Library',
        ...(opts.referer ? { 'HTTP-Referer': opts.referer } : {}),
      },
      body: JSON.stringify({
        model: opts.model || DEFAULT_MODEL,
        temperature: 0.1,
        max_tokens: 400,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: [
              { type: 'text', text: `Category list: ${opts.categories.join(', ') || '(none)'}` },
              { type: 'image_url', image_url: { url: opts.imageDataUrl } },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(30_000),
    })
  } catch {
    throw new SuggestError('ai_unavailable', 502, 'Could not reach the AI service. Enter details manually.')
  }

  if (response.status === 429) {
    throw new SuggestError('ai_rate_limited', 429, 'The AI service is busy. Try again in a minute, or enter details manually.')
  }
  if (!response.ok) {
    throw new SuggestError('ai_unavailable', 502, `The AI service returned an error (${response.status}). Enter details manually.`)
  }
  const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> }
  const content = payload.choices?.[0]?.message?.content
  if (!content) throw new SuggestError('ai_unavailable', 502, 'The AI returned an empty answer.')
  return parseSuggestion(content, opts.categories)
}
