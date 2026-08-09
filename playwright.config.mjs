import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

function parsePort(rawPort) {
  const normalizedPort = String(rawPort ?? '');
  const port = Number(normalizedPort);
  if (!/^\d+$/.test(normalizedPort) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PLAYWRIGHT_PORT must be an integer in the range 1..65535');
  }
  return port;
}

const integrationPort = parsePort(process.env.PLAYWRIGHT_PORT || '4173');
const integrationBaseURL = `http://127.0.0.1:${integrationPort}`;

const STATIC_FILES = [
  'case-study-agentforge.html',
  'case-study-agentic.html',
  'case-study-apple-calendar-mcp.html',
  'index.html',
  'offline.html',
  'reading.html',
  'work.html',
  'manifest.json',
  'pwabuilder-sw.js',
  'robots.txt',
  'sitemap.xml'
];
const STATIC_DIRECTORIES = ['book', 'css', 'favicon', 'fonts', 'images', 'js'];

function copyDeploymentPath(sourcePath, targetPath) {
  const sourceStat = fs.lstatSync(sourcePath);
  if (sourceStat.isSymbolicLink()) {
    throw new Error(`Refusing to stage symbolic link for Playwright: ${sourcePath}`);
  }
  if (sourceStat.isDirectory()) {
    fs.mkdirSync(targetPath, { recursive: true });
    fs.readdirSync(sourcePath, { withFileTypes: true }).forEach((entry) => {
      copyDeploymentPath(
        path.join(sourcePath, entry.name),
        path.join(targetPath, entry.name)
      );
    });
    return;
  }
  if (!sourceStat.isFile()) {
    throw new Error(`Refusing to stage unsupported file type for Playwright: ${sourcePath}`);
  }
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(sourcePath, targetPath);
}

function stageStaticSite() {
  const stagingRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'projectportfolio-playwright-'));
  [...STATIC_FILES, ...STATIC_DIRECTORIES].forEach((relativePath) => {
    const sourcePath = path.join(projectRoot, relativePath);
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Playwright static artifact is missing: ${sourcePath}`);
    }
    copyDeploymentPath(sourcePath, path.join(stagingRoot, relativePath));
  });
  return stagingRoot;
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

const playwrightStaticRoot = stageStaticSite();
const webServerCommand = [
  'python3 -m http.server',
  String(integrationPort),
  '--bind 127.0.0.1',
  '--directory',
  shellQuote(playwrightStaticRoot)
].join(' ');

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
    command: webServerCommand,
    url: `${integrationBaseURL}/index.html`,
    // A pre-existing listener may serve arbitrary content. Always force
    // Playwright to own the loopback port instead of silently reusing it.
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

export {
  integrationBaseURL,
  parsePort,
  parsePort as parseIntegrationPort,
  playwrightStaticRoot,
  webServerCommand
};
