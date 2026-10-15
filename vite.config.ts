/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
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
