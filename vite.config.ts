/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'
import { hubHandler } from './server/hub.mjs'

// project hub API (server/hub.mjs) on the dev and preview servers too
const hub = (): Plugin => {
  const h = hubHandler(path.resolve(process.env.PROJECT_DIR ?? 'projects'))
  return { name: 'project-hub', configureServer: s => { s.middlewares.use(h) }, configurePreviewServer: s => { s.middlewares.use(h) } } // braces: a returned fn would run as a post hook
}

// GO2 block CSVs in public/go2-blocks/<folder>/*.csv, listed at dev/build time as `virtual:go2-blocks` ([{ folder, file }], file without .csv)
const go2Blocks = (): Plugin => {
  const dir = path.resolve('public/go2-blocks'), id = 'virtual:go2-blocks'
  return {
    name: 'go2-blocks',
    resolveId: s => s === id ? '\0' + id : undefined,
    configureServer(server) { // a CSV added or removed: rebuild the list and reload
      server.watcher.add(dir)
      const changed = (f: string) => {
        if (!path.resolve(f).startsWith(dir) || !f.endsWith('.csv')) return
        const m = server.moduleGraph.getModuleById('\0' + id)
        if (m) server.moduleGraph.invalidateModule(m)
        server.ws.send({ type: 'full-reload' })
      }
      server.watcher.on('add', changed).on('unlink', changed)
    },
    load(s) {
      if (s !== '\0' + id) return
      const list = fs.readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory()).flatMap(d =>
        fs.readdirSync(path.join(dir, d.name)).filter(f => f.endsWith('.csv')).map(f => ({ folder: d.name, file: f.slice(0, -4) })))
      return `export default ${JSON.stringify(list)}`
    },
  }
}

export default defineConfig({
  plugins: [react(), hub(), go2Blocks()],
  build: {
    // three.js and React rarely change: their own chunks stay cached across app updates
    rolldownOptions: { output: { codeSplitting: { groups: [
      { name: 'three', test: /node_modules\/three\// },
      { name: 'react', test: /node_modules\/(react|react-dom|scheduler|zustand)\// },
    ] } } },
    chunkSizeWarningLimit: 600, // three.js alone is ~585 kB minified
  },
  test: { testTimeout: 20000, environment: 'node', exclude: ['e2e/**', 'node_modules/**'] },
})
