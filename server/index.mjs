// Production server: the built app (dist/) + the project hub API. `npm run build && npm run serve`.
// Env: PORT (default 8080), PROJECT_DIR (default ./projects).
import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import { hubHandler } from './hub.mjs'

const DIST = path.resolve('dist'), PORT = Number(process.env.PORT ?? 8080), DIR = path.resolve(process.env.PROJECT_DIR ?? 'projects')
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.csv': 'text/csv', '.xml': 'application/xml' }
const hub = hubHandler(DIR)

http.createServer((req, res) => hub(req, res, async () => {
  const p = path.join(DIST, decodeURIComponent(new URL(req.url, 'http://x').pathname))
  const file = p.startsWith(DIST + path.sep) && (await fs.stat(p).catch(() => null))?.isFile() ? p : path.join(DIST, 'index.html') // SPA fallback
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream' })
  res.end(await fs.readFile(file))
})).listen(PORT, () => console.log(`motion-editor http://localhost:${PORT} · projects ${DIR}`))
