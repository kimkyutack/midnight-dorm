import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 12_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'mobile-chromium',
      // Galaxy Z Flip6 inner-display portrait CSS viewport. Keeping the test
      // portrait catches card clipping and sprite alignment regressions that a
      // landscape simulator hides.
      use: { ...devices['iPhone 13'], browserName: 'chromium', viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true },
    },
  ],
  webServer: {
    command: 'CLOUDFLARE_ENV=e2e npm run dev -- --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173/api/health',
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
