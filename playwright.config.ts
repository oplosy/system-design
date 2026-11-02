import os from 'node:os';
import path from 'node:path';
import { defineConfig } from '@playwright/test';

// Each app runs against its own data folder (its parent holds hooks, plugins and MCP files), never the user's designs.
const BASE = path.join(os.tmpdir(), 'system-design-e2e');
export const BASE_DIR = BASE;
export const DATA_DIR = path.join(BASE, 'main', 'designs');
export const HUB_DATA_DIR = path.join(BASE, 'hub', 'designs');
const [PORT, HUB_PORT, IDP_PORT] = [5191, 5192, 5193];
/** The example plugin the repository ships, so it stays tested. */
const PLUGINS = path.join(import.meta.dirname, 'examples', 'plugins');

export default defineConfig({
  testDir: 'e2e',
  globalSetup: './e2e/setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { viewport: { width: 1400, height: 900 }, trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', testMatch: ['app.spec.ts', 'editing.spec.ts', 'plugins.spec.ts'], use: { browserName: 'chromium', baseURL: `http://127.0.0.1:${PORT}` } },
    { name: 'hub', testMatch: 'hub.spec.ts', use: { browserName: 'chromium', baseURL: `http://127.0.0.1:${HUB_PORT}` } },
  ],
  webServer: [
    {
      command: `npx vite --port ${PORT} --strictPort`,
      url: `http://127.0.0.1:${PORT}`,
      env: { SYSTEM_DESIGN_DIR: DATA_DIR, SYSTEM_DESIGN_PLUGINS: PLUGINS },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    // A stand-in for the team's sign-in provider.
    { command: `node e2e/fake-oidc.ts ${IDP_PORT}`, url: `http://127.0.0.1:${IDP_PORT}/.well-known/openid-configuration`, reuseExistingServer: false, timeout: 20_000 },
    // Sign-in belongs to the production server, so the hub is tested on the built app.
    {
      command: 'npm run build && node server/main.ts',
      url: `http://127.0.0.1:${HUB_PORT}`,
      env: {
        PORT: String(HUB_PORT),
        SYSTEM_DESIGN_DIR: HUB_DATA_DIR,
        SYSTEM_DESIGN_OIDC_ISSUER: `http://127.0.0.1:${IDP_PORT}`,
        SYSTEM_DESIGN_OIDC_CLIENT_ID: 'e2e',
        SYSTEM_DESIGN_OIDC_CLIENT_SECRET: 'e2e-secret',
        SYSTEM_DESIGN_URL: `http://127.0.0.1:${HUB_PORT}`,
        SYSTEM_DESIGN_ALLOWED: 'ann@example.com, bob@example.com',
        SYSTEM_DESIGN_EDITORS: 'ann@example.com',
        SYSTEM_DESIGN_SESSION_SECRET: 'e2e-session-secret-that-is-long-enough-1234',
      },
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
