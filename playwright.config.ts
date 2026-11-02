import os from 'node:os';
import path from 'node:path';
import { defineConfig } from '@playwright/test';

// The app runs against its own data folder (its parent holds hooks, plugins and MCP files), never the user's designs.
export const DATA_DIR = path.join(os.tmpdir(), 'system-design-e2e', 'designs');
const PORT = 5191;

export default defineConfig({
  testDir: 'e2e',
  testMatch: '*.spec.ts',
  globalSetup: './e2e/setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: `http://127.0.0.1:${PORT}`, viewport: { width: 1400, height: 900 }, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}`,
    env: { SYSTEM_DESIGN_DIR: DATA_DIR },
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
