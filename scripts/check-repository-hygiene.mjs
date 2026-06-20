import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const JUNK_FILE_NAMES = new Set([
  '.DS_Store',
  'Thumbs.db',
  'ehthumbs.db',
  'Desktop.ini',
  'npm-debug.log',
  'yarn-debug.log',
  'yarn-error.log',
  'pnpm-debug.log'
]);

const JUNK_PATH_SEGMENTS = new Set([
  '__MACOSX'
]);

const JUNK_EXTENSIONS = [
  '.log',
  '.orig',
  '.rej',
  '.swo',
  '.swp',
  '.tmp'
];

const SKIPPED_DIRECTORY_NAMES = new Set([
  '.git',
  '.idea',
  '.claude',
  'artifacts',
  'node_modules',
  'playwright-report',
  'test-results'
]);

function listGitVisibleFiles({ cwd = process.cwd() } = {}) {
  const output = execFileSync('git', [
    'ls-files',
    '--cached',
    '--others',
    '--exclude-standard',
    '-z'
  ], {
    cwd,
    encoding: 'utf8'
  });

  return output
    .split('\0')
    .filter(Boolean)
    .sort();
}

function listFilesystemJunkFiles({
  cwd = process.cwd(),
  skippedDirectoryNames = SKIPPED_DIRECTORY_NAMES
} = {}) {
  const findings = [];

  function visit(directory, prefix = '') {
    const entries = fs.readdirSync(directory, { withFileTypes: true });

    for (const entry of entries) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolutePath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        if (!skippedDirectoryNames.has(entry.name)) {
          visit(absolutePath, relativePath);
        }
        continue;
      }

      if (entry.isFile() && isJunkPath(relativePath)) {
        findings.push(relativePath);
      }
    }
  }

  visit(cwd);

  return findings.sort();
}

function isJunkPath(filePath) {
  const normalizedPath = filePath.replaceAll(path.sep, '/');
  const segments = normalizedPath.split('/');
  const baseName = segments.at(-1);
  const lowerBaseName = baseName.toLowerCase();

  if (JUNK_FILE_NAMES.has(baseName) || JUNK_FILE_NAMES.has(lowerBaseName)) {
    return true;
  }

  if (segments.some((segment) => JUNK_PATH_SEGMENTS.has(segment))) {
    return true;
  }

  if (baseName.endsWith('~') || baseName.endsWith('.icloud')) {
    return true;
  }

  return JUNK_EXTENSIONS.some((extension) => lowerBaseName.endsWith(extension));
}

function collectRepositoryHygieneFindings({ cwd = process.cwd() } = {}) {
  return [...new Set([
    ...listGitVisibleFiles({ cwd }).filter(isJunkPath),
    ...listFilesystemJunkFiles({ cwd })
  ])].sort();
}

function formatFindings(findings) {
  return [
    'Repository hygiene check failed. Remove or ignore these generated/local files:',
    ...findings.map((finding) => `- ${finding}`)
  ].join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const findings = collectRepositoryHygieneFindings();
    if (findings.length > 0) {
      console.error(formatFindings(findings));
      process.exit(1);
    }
    console.log('Repository hygiene check passed.');
  } catch (error) {
    console.error(error?.message || 'Repository hygiene check failed.');
    process.exit(1);
  }
}

export {
  collectRepositoryHygieneFindings,
  formatFindings,
  isJunkPath,
  listFilesystemJunkFiles,
  listGitVisibleFiles
};
