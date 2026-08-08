import { defineConfig, devices } from '@playwright/test';

function parseIntegrationPort(rawValue = process.env.PLAYWRIGHT_PORT ?? '4173') {
  const value = String(rawValue);
  if (!/^\d+$/.test(value)) {
    throw new Error('PLAYWRIGHT_PORT must be an integer in the range 1..65535');
  }

  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new Error('PLAYWRIGHT_PORT must be an integer in the range 1..65535');
  }
  return port;
}

const integrationPort = parseIntegrationPort();
const integrationBaseURL = `http://127.0.0.1:${integrationPort}`;

export default defineConfig({
  testDir: './tests/integration',
  timeout: 30_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: integrationBaseURL,
    trace: 'on-first-retry',
    serviceWorkers: 'block'
  },
  webServer: {
    command: `python3 -m http.server ${integrationPort} --bind 127.0.0.1`,
    url: `${integrationBaseURL}/index.html`,
    reuseExistingServer: !process.env.CI,
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

export { parseIntegrationPort };
