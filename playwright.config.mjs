import { defineConfig, devices } from '@playwright/test';

const integrationPort = Number.parseInt(process.env.PLAYWRIGHT_PORT || '4173', 10);
const integrationBaseURL = `http://127.0.0.1:${integrationPort}`;

export default defineConfig({
  testDir: './tests/integration',
  timeout: 30_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['list']],
  use: {
    baseURL: integrationBaseURL,
    trace: 'on-first-retry',
    serviceWorkers: 'block'
  },
  webServer: {
    command: `python3 -m http.server ${integrationPort} --bind 127.0.0.1`,
    url: `${integrationBaseURL}/index.html`,
    reuseExistingServer: false,
    timeout: 120_000
  },
  projects: [
    {
      name: 'mobile-chromium',
      use: {
        ...devices['Pixel 5']
      }
    },
    {
      name: 'desktop-chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1366, height: 900 }
      }
    }
  ]
});
