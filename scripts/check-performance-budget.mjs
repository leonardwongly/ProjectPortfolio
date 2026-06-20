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
const MAX_RENDERED_READING_MEDIA_BYTES = 12 * MiB;
const MAX_RENDERED_READING_2X_BYTES = 6 * MiB;
const ASSET_INVENTORY_DIRECTORIES = [
  'book',
  'fonts',
  'images',
  'js/vendor'
];

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

function collectRenderedAssetReferences(html) {
  const references = new Set();
  const highDpiReferences = new Set();
  const attrPattern = /\b(src|srcset)="([^"]+)"/g;
  let match = attrPattern.exec(html);

  while (match) {
    const [, attrName, rawValue] = match;
    if (attrName === 'srcset') {
      rawValue.split(',').forEach((candidate) => {
        const parts = candidate.trim().split(/\s+/);
        const url = parts[0];
        if (url) {
          references.add(url);
          if (parts.includes('2x')) {
            highDpiReferences.add(url);
          }
        }
      });
    } else {
      references.add(rawValue.trim());
    }
    match = attrPattern.exec(html);
  }

  return {
    references: Array.from(references).filter((url) => url && !url.startsWith('data:') && !/^[a-z][a-z\d+.-]*:/i.test(url)),
    highDpiReferences: Array.from(highDpiReferences).filter((url) => url && !url.startsWith('data:') && !/^[a-z][a-z\d+.-]*:/i.test(url))
  };
}

function sumExistingFiles(relativePaths, { rootDir = projectRoot } = {}) {
  return relativePaths.reduce((sum, relativePath) => {
    const absolutePath = path.join(rootDir, relativePath);
    if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
      return sum;
    }
    return sum + fs.statSync(absolutePath).size;
  }, 0);
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

  const readingHtmlPath = path.join(rootDir, 'reading.html');
  if (fs.existsSync(readingHtmlPath)) {
    const renderedAssets = collectRenderedAssetReferences(fs.readFileSync(readingHtmlPath, 'utf8'));
    const readingMediaReferences = renderedAssets.references.filter((reference) => reference.startsWith('book/'));
    const highDpiReadingReferences = renderedAssets.highDpiReferences.filter((reference) => reference.startsWith('book/'));
    const renderedReadingBytes = sumExistingFiles(readingMediaReferences, { rootDir });
    const renderedReadingHighDpiBytes = sumExistingFiles(highDpiReadingReferences, { rootDir });

    report.push(`rendered reading media: ${formatBytes(renderedReadingBytes)} / ${formatBytes(MAX_RENDERED_READING_MEDIA_BYTES)}`);
    report.push(`rendered reading 2x media: ${formatBytes(renderedReadingHighDpiBytes)} / ${formatBytes(MAX_RENDERED_READING_2X_BYTES)}`);

    if (renderedReadingBytes > MAX_RENDERED_READING_MEDIA_BYTES) {
      failures.push(`rendered reading media is ${formatBytes(renderedReadingBytes)}, above ${formatBytes(MAX_RENDERED_READING_MEDIA_BYTES)}`);
    }
    if (renderedReadingHighDpiBytes > MAX_RENDERED_READING_2X_BYTES) {
      failures.push(`rendered reading 2x media is ${formatBytes(renderedReadingHighDpiBytes)}, above ${formatBytes(MAX_RENDERED_READING_2X_BYTES)}`);
    }
  }

  return { failures, report, inventory: createAssetInventoryReport({ rootDir }) };
}

function createAssetInventoryReport({ rootDir = projectRoot, limit = 20 } = {}) {
  const files = ASSET_INVENTORY_DIRECTORIES
    .flatMap((directory) => walkFiles(directory, { rootDir }))
    .map((file) => ({
      path: file,
      size: fileSize(file, { rootDir })
    }))
    .sort((a, b) => b.size - a.size || a.path.localeCompare(b.path));

  const directoryTotals = ASSET_INVENTORY_DIRECTORIES
    .map((directory) => ({
      path: `${directory}/`,
      size: directorySize(directory, { rootDir })
    }))
    .sort((a, b) => b.size - a.size || a.path.localeCompare(b.path));

  return {
    directoryTotals,
    largestFiles: files.slice(0, limit)
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = checkPerformanceBudget();
  console.log('Performance budget report:');
  result.report.forEach((line) => console.log(`- ${line}`));
  console.log('Largest asset files:');
  result.inventory.largestFiles.forEach((asset) => {
    console.log(`- ${asset.path}: ${formatBytes(asset.size)}`);
  });
  if (result.failures.length > 0) {
    console.error(`Performance budget failed with ${result.failures.length} finding(s):`);
    result.failures.forEach((failure) => console.error(`- ${failure}`));
    process.exitCode = 1;
  }
}

export {
  checkPerformanceBudget,
  collectRenderedAssetReferences,
  createAssetInventoryReport
};
