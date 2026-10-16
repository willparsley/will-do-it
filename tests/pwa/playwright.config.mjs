import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.mjs',
  use: { baseURL: 'http://127.0.0.1:3101', screenshot: 'only-on-failure' },
  projects: [
    { name: 'desktop-chromium', use: { browserName: 'chromium' } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: 'npm run start -- --hostname 127.0.0.1 --port 3101',
    wait: { stdout: /Ready in/ },
  },
});
