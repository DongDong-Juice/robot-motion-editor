/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { hubHandler } from './server/hub.mjs'

// project hub API (server/hub.mjs) on the dev and preview servers too
const hub = (): Plugin => {
  const h = hubHandler(path.resolve(process.env.PROJECT_DIR ?? 'projects'))
  return { name: 'project-hub', configureServer: s => { s.middlewares.use(h) }, configurePreviewServer: s => { s.middlewares.use(h) } } // braces: a returned fn would run as a post hook
}

export default defineConfig({
  plugins: [react(), hub()],
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
