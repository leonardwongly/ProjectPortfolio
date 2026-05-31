import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const RUNTIME_FILES = [
  'js/main.js',
  'js/site.js'
];

const DISALLOWED_RUNTIME_PATTERNS = [
  { pattern: /\bfetch\s*\(/, reason: 'runtime telemetry must not use fetch' },
  { pattern: /\bsendBeacon\s*\(/, reason: 'runtime telemetry must not use sendBeacon' },
  { pattern: /\bXMLHttpRequest\b/, reason: 'runtime telemetry must not use XMLHttpRequest' },
  { pattern: /\bdataLayer\b/, reason: 'runtime telemetry must not use dataLayer adapters' },
  { pattern: /\bgtag\b/, reason: 'runtime telemetry must not use gtag adapters' },
  { pattern: /\bplausible\b/i, reason: 'runtime telemetry must not use Plausible adapters' }
];

const ALLOWED_EVENTS = new Set([
  'portfolio_action_clicked',
  'reading_filter_changed',
  'reading_view_changed',
  'reading_share_clicked',
  'reading_share_completed'
]);

function collectTelemetryPolicyFindings({ rootDir = projectRoot } = {}) {
  const findings = [];

  RUNTIME_FILES.forEach((file) => {
    const content = fs.readFileSync(path.join(rootDir, file), 'utf8');
    DISALLOWED_RUNTIME_PATTERNS.forEach(({ pattern, reason }) => {
      if (pattern.test(content)) {
        findings.push(`${file}: ${reason}`);
      }
    });

    const eventMatches = content.matchAll(/['"]([a-z0-9_]+)['"]/g);
    for (const match of eventMatches) {
      const value = match[1];
      if (value.endsWith('_clicked') || value.endsWith('_changed') || value.endsWith('_completed')) {
        if (!ALLOWED_EVENTS.has(value)) {
          findings.push(`${file}: unapproved telemetry event "${value}"`);
        }
      }
    }
  });

  return findings;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const findings = collectTelemetryPolicyFindings();
  if (findings.length > 0) {
    console.error(`Telemetry policy failed with ${findings.length} finding(s):`);
    findings.forEach((finding) => console.error(`- ${finding}`));
    process.exitCode = 1;
  } else {
    console.log('Telemetry policy OK: no external runtime analytics adapters are enabled.');
  }
}

export {
  collectTelemetryPolicyFindings
};
