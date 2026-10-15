import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.mjs',
  fullyParallel: true,
  workers: 2,
  use: { screenshot: 'only-on-failure' },
  projects: [
    { name: 'desktop-chromium', use: { browserName: 'chromium', viewport: { width: 1280, height: 900 } } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
    { name: 'small-mobile-chromium', use: { ...devices['Pixel 7'], viewport: { width: 360, height: 740 } } },
    { name: 'desktop-firefox', use: { browserName: 'firefox', viewport: { width: 1280, height: 900 } } },
  ],
});
