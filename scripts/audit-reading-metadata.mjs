import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const readingPath = path.join(projectRoot, 'data', 'reading.json');

function normalize(value) {
  return String(value ?? '').trim().toLowerCase();
}

function fail(message) {
  throw new Error(message);
}

function readReadingData() {
  return JSON.parse(fs.readFileSync(readingPath, 'utf8'));
}

function auditReadingMetadata(reading, { rootDir = projectRoot } = {}) {
  if (!Array.isArray(reading)) {
    fail('Expected data/reading.json to contain an array');
  }

  const findings = [];
  const seen = new Map();

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

    if (entry.cover && !fs.existsSync(path.join(rootDir, entry.cover))) {
      findings.push(`${context}: declared cover is missing: ${entry.cover}`);
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
  auditReadingMetadata
};
