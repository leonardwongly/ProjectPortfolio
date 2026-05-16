import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const KiB = 1024;
const MiB = 1024 * KiB;

const FILE_BUDGETS = [
  { path: 'index.html', maxBytes: 90 * KiB },
  { path: 'reading.html', maxBytes: 140 * KiB },
  { path: 'offline.html', maxBytes: 20 * KiB },
  { path: 'css/custom.css', maxBytes: 50 * KiB },
  { path: 'js/main.js', maxBytes: 32 * KiB },
  { path: 'js/site.js', maxBytes: 8 * KiB },
  { path: 'pwabuilder-sw.js', maxBytes: 8 * KiB }
];

const DIRECTORY_BUDGETS = [
  { path: 'book', maxBytes: 80 * MiB },
  { path: 'fonts', maxBytes: 45 * MiB },
  { path: 'images', maxBytes: 8 * MiB },
  { path: 'js/vendor', maxBytes: 2 * MiB }
];

const MAX_SINGLE_ASSET_BYTES = 20 * MiB;

function formatBytes(bytes) {
  if (bytes >= MiB) return `${(bytes / MiB).toFixed(2)} MiB`;
  return `${(bytes / KiB).toFixed(1)} KiB`;
}

function fileSize(relativePath, { rootDir = projectRoot } = {}) {
  return fs.statSync(path.join(rootDir, relativePath)).size;
}

function walkFiles(relativePath, { rootDir = projectRoot } = {}) {
  const root = path.join(rootDir, relativePath);
  if (!fs.existsSync(root)) return [];

  const files = [];
  const queue = [root];
  while (queue.length > 0) {
    const current = queue.pop();
    fs.readdirSync(current, { withFileTypes: true }).forEach((entry) => {
      const absolutePath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(absolutePath);
      } else if (entry.isFile()) {
        files.push(path.relative(rootDir, absolutePath).split(path.sep).join('/'));
      }
    });
  }
  return files.sort();
}

function directorySize(relativePath, { rootDir = projectRoot } = {}) {
  return walkFiles(relativePath, { rootDir }).reduce((sum, file) => sum + fileSize(file, { rootDir }), 0);
}

function checkPerformanceBudget({ rootDir = projectRoot } = {}) {
  const failures = [];
  const report = [];

  FILE_BUDGETS.forEach((budget) => {
    const size = fileSize(budget.path, { rootDir });
    report.push(`${budget.path}: ${formatBytes(size)} / ${formatBytes(budget.maxBytes)}`);
    if (size > budget.maxBytes) {
      failures.push(`${budget.path} is ${formatBytes(size)}, above ${formatBytes(budget.maxBytes)}`);
    }
  });

  DIRECTORY_BUDGETS.forEach((budget) => {
    const size = directorySize(budget.path, { rootDir });
    report.push(`${budget.path}/: ${formatBytes(size)} / ${formatBytes(budget.maxBytes)}`);
    if (size > budget.maxBytes) {
      failures.push(`${budget.path}/ is ${formatBytes(size)}, above ${formatBytes(budget.maxBytes)}`);
    }
  });

  walkFiles('book', { rootDir })
    .concat(walkFiles('images', { rootDir }), walkFiles('fonts', { rootDir }))
    .forEach((file) => {
      const size = fileSize(file, { rootDir });
      if (size > MAX_SINGLE_ASSET_BYTES) {
        failures.push(`${file} is ${formatBytes(size)}, above single-asset budget ${formatBytes(MAX_SINGLE_ASSET_BYTES)}`);
      }
    });

  return { failures, report };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = checkPerformanceBudget();
  console.log('Performance budget report:');
  result.report.forEach((line) => console.log(`- ${line}`));
  if (result.failures.length > 0) {
    console.error(`Performance budget failed with ${result.failures.length} finding(s):`);
    result.failures.forEach((failure) => console.error(`- ${failure}`));
    process.exitCode = 1;
  }
}

export {
  checkPerformanceBudget
};
