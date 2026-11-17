// Serves dist/ the way GitHub Pages does for a project site: files under /<repo>/,
// and 404.html (with status 404) for anything else. Used to verify subpath deep links.
//   node scripts/serve-pages.mjs [base=/hatchery-electronics-library/] [port=4174]
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'

const base = process.argv[2] ?? '/hatchery-electronics-library/'
const port = Number(process.argv[3] ?? 4174)
const root = join(process.cwd(), 'dist')
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.md': 'text/markdown', '.json': 'application/json', '.webp': 'image/webp' }

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x')
  let rel = url.pathname.startsWith(base) ? url.pathname.slice(base.length) : null
  if (rel !== null) {
    if (rel === '' || rel.endsWith('/')) rel += 'index.html'
    const file = normalize(join(root, decodeURIComponent(rel)))
    if (file.startsWith(root)) {
      try {
        if ((await stat(file)).isFile()) {
          res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream' })
          return res.end(await readFile(file))
        }
      } catch { /* fall through */ }
    }
  }
  res.writeHead(404, { 'Content-Type': 'text/html' })
  res.end(await readFile(join(root, '404.html')))
}).listen(port, '127.0.0.1', () => console.log(`GitHub Pages emulation: http://127.0.0.1:${port}${base}`))
