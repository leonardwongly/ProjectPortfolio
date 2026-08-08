import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import assetPaths from './lib/asset-paths.cjs';
import { decodeHtmlAttributeEntities, scanHtmlAttributes } from './lib/html-attributes.mjs';
import safeInput from './lib/safe-input.cjs';

const { resolveContainedPath, sanitizeRelativeAssetPath } = assetPaths;
const { readStableFileNoFollow } = safeInput;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const KiB = 1024;
const MiB = 1024 * KiB;

const FILE_BUDGETS = [
  { path: 'index.html', maxBytes: 90 * KiB },
  { path: 'work.html', maxBytes: 90 * KiB },
  { path: 'case-study-agentforge.html', maxBytes: 48 * KiB },
  { path: 'case-study-agentic.html', maxBytes: 48 * KiB },
  { path: 'case-study-apple-calendar-mcp.html', maxBytes: 48 * KiB },
  { path: 'reading.html', maxBytes: 140 * KiB },
  { path: 'offline.html', maxBytes: 20 * KiB },
  { path: 'css/custom.css', maxBytes: 50 * KiB },
  { path: 'css/case-study.css', maxBytes: 8 * KiB },
  { path: 'js/main.js', maxBytes: 32 * KiB },
  { path: 'js/site.js', maxBytes: 8 * KiB },
  { path: 'pwabuilder-sw.js', maxBytes: 8 * KiB }
];

const DIRECTORY_BUDGETS = [
  { path: 'book', maxBytes: 80 * MiB },
  { path: 'fonts', maxBytes: 512 * KiB },
  { path: 'images', maxBytes: 8 * MiB },
  { path: 'js/vendor', maxBytes: 2 * MiB }
];

const MAX_SINGLE_ASSET_BYTES = 20 * MiB;
const MAX_UNREFERENCED_BOOK_ASSET_BYTES = 512 * KiB;
const MAX_RENDERED_READING_MEDIA_BYTES = 12 * MiB;
const MAX_RENDERED_READING_2X_BYTES = 6 * MiB;
const MAX_RENDERED_HTML_BYTES = 1024 * KiB;
const MAX_RENDERED_ASSET_REFERENCES = 5000;
const MAX_ASSET_INVENTORY_ENTRIES = 20000;
const DISALLOWED_WEB_ROOT_ASSET_PATTERNS = [
  /^css\/bootstrap(?:-grid|-reboot|-utilities|\.rtl|\.css|\.min\.css\.map)/,
  /^css\/bootstrap.*\.map$/,
  /^js\/bootstrap.*\.js(?:\.map)?$/,
  /^fonts\/.*\.otf$/,
  /^fonts\/bootstrap-icons\.(?:woff2?|ttf|eot|svg)$/
];
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
  const absolutePath = resolveContainedPath(rootDir, relativePath, 'performance asset');
  const stats = fs.lstatSync(absolutePath);
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new Error(`${relativePath} must be a non-symlink regular file`);
  }
  return stats.size;
}

function walkFiles(relativePath, {
  rootDir = projectRoot,
  maxEntries = MAX_ASSET_INVENTORY_ENTRIES
} = {}) {
  const root = resolveContainedPath(rootDir, relativePath, 'performance asset directory');
  if (!fs.existsSync(root)) return [];
  const rootStats = fs.lstatSync(root);
  if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
    throw new Error(`${relativePath} must be a non-symlink directory`);
  }

  const files = [];
  const queue = [root];
  let visitedEntries = 0;
  while (queue.length > 0) {
    const current = queue.pop();
    const currentStats = fs.lstatSync(current);
    if (currentStats.isSymbolicLink() || !currentStats.isDirectory()) {
      throw new Error(`${path.relative(rootDir, current)} must remain a non-symlink directory`);
    }
    fs.readdirSync(current, { withFileTypes: true }).forEach((entry) => {
      visitedEntries += 1;
      if (visitedEntries > maxEntries) {
        throw new Error(`${relativePath} exceeds ${maxEntries} inventory entry limit`);
      }
      const absolutePath = path.join(current, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`${path.relative(rootDir, absolutePath)} must not be a symbolic link`);
      } else if (entry.isDirectory()) {
        queue.push(absolutePath);
      } else if (entry.isFile()) {
        files.push(path.relative(rootDir, absolutePath).split(path.sep).join('/'));
      } else {
        throw new Error(`${path.relative(rootDir, absolutePath)} must be a regular file or directory`);
      }
    });
  }
  return files.sort();
}

function directorySize(relativePath, { rootDir = projectRoot } = {}) {
  return walkFiles(relativePath, { rootDir }).reduce((sum, file) => sum + fileSize(file, { rootDir }), 0);
}

function readBoundedTextFile(relativePath, maxBytes, {
  rootDir = projectRoot,
  openSync = fs.openSync
} = {}) {
  const resolvedRoot = path.resolve(rootDir);
  const absolutePath = resolveContainedPath(resolvedRoot, relativePath, relativePath);
  return readStableFileNoFollow(absolutePath, {
    label: relativePath,
    rootDir: resolvedRoot,
    maxBytes,
    minBytes: 0,
    openSync
  }).toString('utf8');
}

function normalizeRenderedAssetReference(rawUrl, findings) {
  let value;
  try {
    value = decodeHtmlAttributeEntities(rawUrl).trim();
  } catch (error) {
    findings.push(error.message);
    return null;
  }
  if (!value || value.startsWith('data:') || value.startsWith('//') || /^[a-z][a-z\d+.-]*:/i.test(value)) {
    return null;
  }
  if (/[\u0000-\u001f\u007f\\]/.test(value)) {
    findings.push(`asset reference contains disallowed characters: "${value}"`);
    return null;
  }

  try {
    const pathSource = value.split(/[?#]/, 1)[0];
    const decodedPath = decodeURIComponent(pathSource).replace(/^\/+/, '');
    if (!decodedPath) return null;
    const relativePath = sanitizeRelativeAssetPath(decodedPath, 'rendered asset reference');
    resolveContainedPath('/rendered-assets', relativePath, 'rendered asset reference');
    return relativePath;
  } catch (error) {
    findings.push(`asset reference is malformed: "${value}" (${error?.message || 'invalid path'})`);
    return null;
  }
}

function collectRenderedAssetReferences(html) {
  if (typeof html !== 'string') {
    throw new TypeError('Rendered HTML must be a string');
  }
  if (Buffer.byteLength(html, 'utf8') > MAX_RENDERED_HTML_BYTES) {
    throw new RangeError(`Rendered HTML exceeds ${MAX_RENDERED_HTML_BYTES} byte parse limit`);
  }

  const references = new Set();
  const highDpiReferences = new Set();
  const scanned = scanHtmlAttributes(html, {
    attributeNames: ['src', 'srcset'],
    maxAttributes: MAX_RENDERED_ASSET_REFERENCES,
    maxBytes: MAX_RENDERED_HTML_BYTES
  });
  const findings = [...scanned.findings];
  let referenceCount = 0;

  for (const { name: attrName, value: rawValue } of scanned.attributes) {
    if (!rawValue.trim()) {
      findings.push(`${attrName} has an empty value`);
      continue;
    }
    if (/[<>]/.test(rawValue)) {
      findings.push(`${attrName} contains an invalid tag boundary`);
      continue;
    }

    if (attrName === 'srcset') {
      const candidates = rawValue.split(',');
      if (referenceCount + candidates.length > MAX_RENDERED_ASSET_REFERENCES) {
        findings.push(`rendered asset references exceed ${MAX_RENDERED_ASSET_REFERENCES} entry limit`);
        break;
      }
      candidates.forEach((candidate) => {
        const parts = candidate.trim().split(/\s+/);
        const url = parts[0];
        if (url) {
          referenceCount += 1;
          references.add(url);
          if (parts.includes('2x')) {
            highDpiReferences.add(url);
          }
        }
        if (!url || parts.length > 2 || (parts[1] && !/^(?:\d+(?:\.\d+)?x|\d+w)$/.test(parts[1]))) {
          findings.push(`srcset contains malformed candidate "${candidate.trim()}"`);
        }
      });
    } else {
      referenceCount += 1;
      references.add(rawValue.trim());
    }

    if (referenceCount > MAX_RENDERED_ASSET_REFERENCES) {
      findings.push(`rendered asset references exceed ${MAX_RENDERED_ASSET_REFERENCES} entry limit`);
      break;
    }
  }

  return {
    references: [...new Set(Array.from(references)
      .map((url) => normalizeRenderedAssetReference(url, findings))
      .filter(Boolean))],
    highDpiReferences: [...new Set(Array.from(highDpiReferences)
      .map((url) => normalizeRenderedAssetReference(url, findings))
      .filter(Boolean))],
    findings
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

function checkPerformanceBudget({ rootDir = projectRoot, openSync = fs.openSync } = {}) {
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

  const bookFiles = walkFiles('book', { rootDir });
  const fontFiles = walkFiles('fonts', { rootDir });
  const imageFiles = walkFiles('images', { rootDir });
  const cssFiles = walkFiles('css', { rootDir });
  const jsFiles = walkFiles('js', { rootDir });

  cssFiles
    .concat(jsFiles, fontFiles)
    .filter((file) => DISALLOWED_WEB_ROOT_ASSET_PATTERNS.some((pattern) => pattern.test(file)))
    .forEach((file) => {
      failures.push(`${file} is a disallowed unreferenced deployed asset`);
    });

  bookFiles
    .concat(imageFiles, fontFiles)
    .forEach((file) => {
      const size = fileSize(file, { rootDir });
      if (size > MAX_SINGLE_ASSET_BYTES) {
        failures.push(`${file} is ${formatBytes(size)}, above single-asset budget ${formatBytes(MAX_SINGLE_ASSET_BYTES)}`);
      }
    });

  const readingHtmlPath = path.join(rootDir, 'reading.html');
  if (fs.existsSync(readingHtmlPath)) {
    let renderedAssets = { references: [], highDpiReferences: [], findings: [] };
    try {
      renderedAssets = collectRenderedAssetReferences(
        readBoundedTextFile('reading.html', MAX_RENDERED_HTML_BYTES, { rootDir, openSync })
      );
    } catch (error) {
      failures.push(`reading.html asset parsing failed: ${error?.message || 'invalid HTML'}`);
    }
    renderedAssets.findings.forEach((finding) => failures.push(`reading.html: ${finding}`));
    const readingMediaReferences = renderedAssets.references.filter((reference) => reference.startsWith('book/'));
    const highDpiReadingReferences = renderedAssets.highDpiReferences.filter((reference) => reference.startsWith('book/'));
    const renderedReadingBytes = sumExistingFiles(readingMediaReferences, { rootDir });
    const renderedReadingHighDpiBytes = sumExistingFiles(highDpiReadingReferences, { rootDir });
    const renderedBookReferences = new Set(readingMediaReferences);

    report.push(`rendered reading media: ${formatBytes(renderedReadingBytes)} / ${formatBytes(MAX_RENDERED_READING_MEDIA_BYTES)}`);
    report.push(`rendered reading 2x media: ${formatBytes(renderedReadingHighDpiBytes)} / ${formatBytes(MAX_RENDERED_READING_2X_BYTES)}`);

    if (renderedReadingBytes > MAX_RENDERED_READING_MEDIA_BYTES) {
      failures.push(`rendered reading media is ${formatBytes(renderedReadingBytes)}, above ${formatBytes(MAX_RENDERED_READING_MEDIA_BYTES)}`);
    }
    if (renderedReadingHighDpiBytes > MAX_RENDERED_READING_2X_BYTES) {
      failures.push(`rendered reading 2x media is ${formatBytes(renderedReadingHighDpiBytes)}, above ${formatBytes(MAX_RENDERED_READING_2X_BYTES)}`);
    }

    bookFiles.forEach((file) => {
      const size = fileSize(file, { rootDir });
      if (!renderedBookReferences.has(file) && size > MAX_UNREFERENCED_BOOK_ASSET_BYTES) {
        failures.push(`${file} is ${formatBytes(size)}, above unreferenced book asset budget ${formatBytes(MAX_UNREFERENCED_BOOK_ASSET_BYTES)}`);
      }
    });
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
  MAX_ASSET_INVENTORY_ENTRIES,
  checkPerformanceBudget,
  collectRenderedAssetReferences,
  createAssetInventoryReport,
  walkFiles
};
