import { defineConfig } from '@playwright/test';
import { loadEnvFile } from 'node:process';
import { existsSync } from 'node:fs';

try {
  loadEnvFile('.env');
} catch {
  /* CI injects environment. */
}
const edge = existsSync('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe');
process.env.QUEUE_NAME = 'niticket-test';
process.env.CACHE_REDIS_URL ||= 'redis://127.0.0.1:6380';

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  expect: { timeout: 10000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:3001',
    headless: true,
    launchOptions: {
      args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    },
    ...(edge ? { channel: 'msedge' } : {}),
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'bun --env-file=.env scripts/test-web.mjs',
    url: 'http://localhost:3001/login',
    reuseExistingServer: false,
    timeout: 120000,
  },
});
