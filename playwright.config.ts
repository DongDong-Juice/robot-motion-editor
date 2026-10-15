import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e',
  workers: 1, // MuJoCo workers + WebGL in parallel browsers starve each other (physics stays queued, exports time out)
  timeout: 60000, // first load (robot meshes + vite dep optimize) can take ~30s on a cold server
  use: { baseURL: 'http://localhost:5173' },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: { command: 'npm run dev', port: 5173, reuseExistingServer: true },
})
