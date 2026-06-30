import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const readingPath = path.join(projectRoot, 'data', 'reading.json');
const ALLOWED_DUPLICATE_COVER_GROUPS = new Set([
  [
    'book/2019/2019-22-300.jpg',
    'book/2020/2020-15-300.jpg'
  ].sort().join('|')
]);

function normalize(value) {
  return String(value ?? '').trim().toLowerCase();
}

function fail(message) {
  throw new Error(message);
}

function readReadingData() {
  return JSON.parse(fs.readFileSync(readingPath, 'utf8'));
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function auditReadingMetadata(reading, { rootDir = projectRoot } = {}) {
  if (!Array.isArray(reading)) {
    fail('Expected data/reading.json to contain an array');
  }

  const findings = [];
  const seen = new Map();
  const coverHashes = new Map();

  reading.forEach((entry, index) => {
    const context = `reading[${index}]`;
    const title = normalize(entry.title);
    const isbn = normalize(entry.isbn);
    const year = normalize(entry.year);
    const author = normalize(entry.author);

    if (!title) findings.push(`${context}: missing title`);
    if (!author) findings.push(`${context}: missing author for "${entry.title}"`);
    if (!isbn) findings.push(`${context}: missing ISBN for "${entry.title}"`);
    if (!/^\d{4}$/.test(year)) findings.push(`${context}: invalid year "${entry.year}"`);

    [
      [`isbn:${isbn}`, isbn],
      [`title-year:${title}|${year}`, title && year]
    ].forEach(([key, enabled]) => {
      if (!enabled) return;
      if (seen.has(key)) {
        findings.push(`${context}: duplicate ${key} also appears at reading[${seen.get(key)}]`);
        return;
      }
      seen.set(key, index);
    });

    if (entry.cover) {
      const coverPath = path.join(rootDir, entry.cover);
      if (!fs.existsSync(coverPath)) {
        findings.push(`${context}: declared cover is missing: ${entry.cover}`);
      } else {
        const digest = sha256File(coverPath);
        const duplicates = coverHashes.get(digest) || [];
        duplicates.forEach((duplicate) => {
          const duplicateGroup = [duplicate.cover, entry.cover].sort().join('|');
          if (!ALLOWED_DUPLICATE_COVER_GROUPS.has(duplicateGroup)) {
            findings.push(`${context}: cover duplicates reading[${duplicate.index}] by content hash: ${entry.cover}`);
          }
        });
        duplicates.push({ cover: entry.cover, index });
        coverHashes.set(digest, duplicates);
      }
    }
  });

  return findings;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const findings = auditReadingMetadata(readReadingData());
    if (findings.length > 0) {
      console.error(`Reading metadata audit failed with ${findings.length} finding(s):`);
      findings.forEach((finding) => console.error(`- ${finding}`));
      process.exitCode = 1;
    } else {
      console.log('Reading metadata audit OK.');
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

export {
  ALLOWED_DUPLICATE_COVER_GROUPS,
  auditReadingMetadata
};
