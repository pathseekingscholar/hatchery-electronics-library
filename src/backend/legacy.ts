// Migration path from the legacy "Eagle Circuit Library" app, which kept everything in this
// browser's localStorage under `eagle-demo-components`. Its 24 built-in sample records were
// fictional, so they are skipped; anything a person added through the old UI is converted to the
// new CSV format (without counts or locations, which the old app made up) for review + import.
import Papa from 'papaparse'
import { CSV_COLUMNS } from '../lib/csv'

const LEGACY_KEY = 'eagle-demo-components'
const LEGACY_SAMPLE_IDS = new Set(Array.from({ length: 24 }, (_, i) => `component-${i + 1}`))

const CATEGORY_MAP: Record<string, string> = {
  'Electronic Components': '',
  'LEDs & Lighting': 'LEDs & Lighting',
  Sensors: 'Sensors',
  'Motors & Drivers': 'Motors & Drivers',
  Connectors: 'Connectors',
  Switches: 'Switches & Buttons',
  Power: 'Power',
  Microcontrollers: 'Microcontrollers',
  Displays: 'Displays',
  Audio: 'Audio',
  Wireless: 'Wireless',
  'Cables & Wire': 'Cables & Wire',
  'Kits & Misc': 'Tools & Misc',
  Other: '',
}

interface LegacyComponent {
  id: string
  name: string
  description?: string
  category?: string
  tags?: string[]
  location?: string
  datasheetUrl?: string
}

export function readLegacyComponents(): LegacyComponent[] {
  try {
    const raw = localStorage.getItem(LEGACY_KEY)
    if (!raw) return []
    const list = JSON.parse(raw) as LegacyComponent[]
    return Array.isArray(list) ? list.filter((c) => c && c.name && !LEGACY_SAMPLE_IDS.has(c.id)) : []
  } catch {
    return []
  }
}

export function legacyToCsv(components: LegacyComponent[]): string {
  const rows = components.map((c) => {
    const description = [c.description ?? '', c.location ? `(Old app location: ${c.location})` : ''].filter(Boolean).join(' ')
    const datasheet = c.datasheetUrl && !c.datasheetUrl.includes('example.com') ? c.datasheetUrl : ''
    const tags = (c.tags ?? []).filter((t) => !['ai-draft', 'cataloged', 'makerspace'].includes(t))
    return ['', c.name, CATEGORY_MAP[c.category ?? ''] ?? '', '', '', '', '', tags.join('; '), description, datasheet, 'no', '', '', '', '', '']
  })
  return Papa.unparse({ fields: [...CSV_COLUMNS], data: rows })
}
