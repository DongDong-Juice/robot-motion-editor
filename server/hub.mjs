// Project hub API over one server folder: list / read / write `*.motion.json`. Shared by the Vite dev server and server/index.mjs.
import fs from 'node:fs/promises'
import path from 'node:path'

const MAX = 200 * 1024 * 1024
const NAME = /^[^/\\:*?"<>|]+\.motion\.json$/
const ok = name => NAME.test(name) && !name.includes('..')

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers })
  res.end(typeof body === 'string' ? body : JSON.stringify(body))
}

async function readBody(req) {
  const chunks = []
  let n = 0
  for await (const c of req) { n += c.length; if (n > MAX) throw new Error('too large'); chunks.push(c) }
  return Buffer.concat(chunks).toString('utf8')
}

const mtimeOf = async file => { try { return (await fs.stat(file)).mtimeMs } catch { return null } }

/** Connect-style middleware for `/api/projects[/<name>]`; other URLs go to `next`. */
export function hubHandler(dir) {
  return async (req, res, next) => {
    const url = new URL(req.url, 'http://x')
    if (!url.pathname.startsWith('/api/projects')) return next?.()
    try {
      await fs.mkdir(dir, { recursive: true })
      if (url.pathname === '/api/projects' && req.method === 'GET') {
        const names = (await fs.readdir(dir)).filter(ok)
        const list = await Promise.all(names.map(async name => { const s = await fs.stat(path.join(dir, name)); return { name, mtime: s.mtimeMs, size: s.size } }))
        return send(res, 200, list.sort((a, b) => b.mtime - a.mtime))
      }
      const name = decodeURIComponent(url.pathname.slice('/api/projects/'.length))
      if (!ok(name)) return send(res, 400, { error: 'bad name' })
      const file = path.join(dir, name)
      if (req.method === 'GET') {
        const m = await mtimeOf(file)
        if (m === null) return send(res, 404, { error: 'not found' })
        return send(res, 200, await fs.readFile(file, 'utf8'), { 'X-Mtime': String(m) })
      }
      if (req.method === 'PUT') {
        const text = await readBody(req)
        JSON.parse(text) // never store a file that is not JSON
        const cur = await mtimeOf(file), base = url.searchParams.get('base')
        if (url.searchParams.has('create') && cur !== null) return send(res, 409, { error: 'exists' })
        if (base !== null && cur !== null && String(cur) !== base) return send(res, 409, { error: 'conflict', mtime: cur })
        // ponytail: check-then-write race between two saves in the same instant; a lock file if teams hit it
        await fs.writeFile(file, text)
        return send(res, 200, { mtime: await mtimeOf(file) })
      }
      send(res, 405, { error: 'method' })
    } catch (e) { send(res, 400, { error: e instanceof Error ? e.message : String(e) }) }
  }
}
