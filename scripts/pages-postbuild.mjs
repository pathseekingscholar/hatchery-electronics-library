// GitHub Pages serves 404.html for unknown paths. Making it a copy of index.html lets
// deep links like /<repo>/part/abc and browser refreshes load the SPA, which then routes.
import { copyFileSync, writeFileSync } from 'node:fs'
copyFileSync('dist/index.html', 'dist/404.html')
writeFileSync('dist/.nojekyll', '')
console.log('pages-postbuild: wrote dist/404.html and dist/.nojekyll')
