// Upload the workspace evidence photos (web + thumb JPEGs) to the PRIVATE `catalog-drafts`
// bucket so staff can see them on Admin → Inventory review in production.
//
//   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=... node scripts/inventory/upload-evidence.mjs
//
// The service-role key is only used on your machine for this one-off upload. Never put it in
// .env files that are bundled (VITE_*), in the repo, or in GitHub variables.
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (local shell only).')
  process.exit(1)
}
const sb = createClient(url, key, { auth: { persistSession: false } })
let n = 0
for (const size of ['web', 'thumb']) {
  const dir = join('inventory', 'photos', size)
  for (const file of (await readdir(dir)).filter((f) => f.endsWith('.jpg'))) {
    const { error } = await sb.storage
      .from('catalog-drafts')
      .upload(`evidence/${size}/${file}`, await readFile(join(dir, file)), { contentType: 'image/jpeg', upsert: true })
    if (error) {
      console.error(file, error.message)
      process.exitCode = 1
    } else n++
  }
}
console.log(`Uploaded ${n} files to catalog-drafts/evidence/`)
