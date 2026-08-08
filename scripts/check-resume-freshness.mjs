#!/usr/bin/env node
/**
 * Guards against stale, replaced, or structurally invalid resume artifacts.
 *
 * The PDF and DOCX outputs are non-deterministic, so this check compares the
 * deterministic rendered HTML hash and the exact validated artifact bytes with
 * docs/resume.manifest.json. Artifact reads are bounded, no-follow, and tied to
 * one stable descriptor so path replacement cannot mix validation and hashing.
 */

import path from 'node:path';
import { TextDecoder } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  loadResumeData,
  renderResumeHtml,
  validateResumeSources,
  computeResumeHtmlHash,
  computeBytesSha256,
  readStableFileNoFollow,
  StableFileReadError,
  RESUME_MANIFEST_DESCRIPTION,
  RESUME_SOURCE_FILES
} from './build-resume.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

const PDF_REL = 'docs/resume.pdf';
const DOCX_REL = 'docs/resume.docx';
const MANIFEST_REL = 'docs/resume.manifest.json';

const MAX_MANIFEST_BYTES = 64 * 1024;
const MAX_PDF_BYTES = 32 * 1024 * 1024;
const MAX_DOCX_BYTES = 32 * 1024 * 1024;
const MAX_DOCX_ENTRIES = 4096;
const MAX_DOCX_UNCOMPRESSED_BYTES = 128 * 1024 * 1024;
const SHA256_PATTERN = /^sha256-[0-9a-f]{64}$/;
const MANIFEST_KEYS = [
  '$generatedBy',
  'description',
  'htmlSha256',
  'pdfSha256',
  'docxSha256',
  'sources'
];
const EXPECTED_SOURCES = RESUME_SOURCE_FILES.map((name) => `data/${name}`);
const REQUIRED_DOCX_ENTRIES = ['[Content_Types].xml', '_rels/.rels', 'word/document.xml'];

function validatePdfBytes(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 16) {
    throw new Error('PDF is too small to contain a valid header and EOF marker');
  }
  if (!bytes.subarray(0, 5).equals(Buffer.from('%PDF-', 'ascii'))) {
    throw new Error('PDF magic header is missing');
  }

  const eofOffset = bytes.lastIndexOf(Buffer.from('%%EOF', 'ascii'));
  if (eofOffset < 0) {
    throw new Error('PDF EOF marker is missing');
  }
  for (let index = eofOffset + 5; index < bytes.length; index += 1) {
    if (![0x09, 0x0a, 0x0c, 0x0d, 0x20].includes(bytes[index])) {
      throw new Error('PDF contains non-whitespace bytes after its EOF marker');
    }
  }
  if (bytes.lastIndexOf(Buffer.from('startxref', 'ascii'), eofOffset) < 0) {
    throw new Error('PDF startxref marker is missing');
  }
  return true;
}

function findZipEndOfCentralDirectory(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 22) return -1;
  const minimumOffset = Math.max(0, bytes.length - 22 - 0xffff);
  for (let offset = bytes.length - 22; offset >= minimumOffset; offset -= 1) {
    if (bytes.readUInt32LE(offset) !== 0x06054b50) continue;
    const commentLength = bytes.readUInt16LE(offset + 20);
    if (offset + 22 + commentLength === bytes.length) return offset;
  }
  return -1;
}

function decodeZipEntryName(nameBytes, flags) {
  if ((flags & 0x0800) !== 0) {
    return new TextDecoder('utf-8', { fatal: true }).decode(nameBytes);
  }
  return nameBytes.toString('latin1');
}

function validateDocxEntryName(name) {
  if (!name || name.includes('\0') || name.includes('\\') || name.startsWith('/')) {
    throw new Error(`DOCX contains an unsafe ZIP entry name: ${JSON.stringify(name)}`);
  }
  const segments = name.split('/');
  if (segments.includes('..') || /^[A-Za-z]:/.test(name)) {
    throw new Error(`DOCX contains a path-traversing ZIP entry: ${JSON.stringify(name)}`);
  }
}

function validateDocxBytes(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 22) {
    throw new Error('DOCX is too small to contain a ZIP central directory');
  }

  const eocdOffset = findZipEndOfCentralDirectory(bytes);
  if (eocdOffset < 0) {
    throw new Error('DOCX ZIP end-of-central-directory record is missing or truncated');
  }

  const diskNumber = bytes.readUInt16LE(eocdOffset + 4);
  const centralDirectoryDisk = bytes.readUInt16LE(eocdOffset + 6);
  const entriesOnDisk = bytes.readUInt16LE(eocdOffset + 8);
  const entryCount = bytes.readUInt16LE(eocdOffset + 10);
  const centralDirectorySize = bytes.readUInt32LE(eocdOffset + 12);
  const centralDirectoryOffset = bytes.readUInt32LE(eocdOffset + 16);

  if (diskNumber !== 0 || centralDirectoryDisk !== 0 || entriesOnDisk !== entryCount) {
    throw new Error('DOCX uses an unsupported multi-disk ZIP structure');
  }
  if (entryCount === 0 || entryCount === 0xffff || entryCount > MAX_DOCX_ENTRIES) {
    throw new Error(`DOCX ZIP entry count is outside the allowed range (1-${MAX_DOCX_ENTRIES})`);
  }
  if (centralDirectorySize === 0xffffffff || centralDirectoryOffset === 0xffffffff) {
    throw new Error('DOCX ZIP64 central directories are not supported');
  }

  const centralDirectoryEnd = centralDirectoryOffset + centralDirectorySize;
  if (centralDirectoryEnd !== eocdOffset || centralDirectoryEnd > bytes.length) {
    throw new Error('DOCX ZIP central-directory bounds are inconsistent');
  }

  const names = new Set();
  const localOffsets = new Set();
  let totalUncompressedBytes = 0;
  let cursor = centralDirectoryOffset;

  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > centralDirectoryEnd || bytes.readUInt32LE(cursor) !== 0x02014b50) {
      throw new Error(`DOCX ZIP central entry ${index} is missing or truncated`);
    }

    const flags = bytes.readUInt16LE(cursor + 8);
    const compressionMethod = bytes.readUInt16LE(cursor + 10);
    const compressedSize = bytes.readUInt32LE(cursor + 20);
    const uncompressedSize = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32);
    const startingDisk = bytes.readUInt16LE(cursor + 34);
    const localHeaderOffset = bytes.readUInt32LE(cursor + 42);
    const entryEnd = cursor + 46 + nameLength + extraLength + commentLength;

    if (entryEnd > centralDirectoryEnd) {
      throw new Error(`DOCX ZIP central entry ${index} exceeds central-directory bounds`);
    }
    if ((flags & 0x0001) !== 0) {
      throw new Error('DOCX contains an encrypted ZIP entry');
    }
    if (compressionMethod !== 0 && compressionMethod !== 8) {
      throw new Error(`DOCX uses unsupported ZIP compression method ${compressionMethod}`);
    }
    if (startingDisk !== 0 || localHeaderOffset === 0xffffffff) {
      throw new Error('DOCX entry references an unsupported disk or ZIP64 offset');
    }

    let name;
    try {
      name = decodeZipEntryName(bytes.subarray(cursor + 46, cursor + 46 + nameLength), flags);
    } catch (error) {
      throw new Error(`DOCX ZIP entry ${index} has an invalid UTF-8 name: ${error.message}`);
    }
    validateDocxEntryName(name);
    if (names.has(name)) throw new Error(`DOCX contains duplicate ZIP entry ${JSON.stringify(name)}`);
    if (localOffsets.has(localHeaderOffset)) {
      throw new Error(`DOCX ZIP entries share local-header offset ${localHeaderOffset}`);
    }
    names.add(name);
    localOffsets.add(localHeaderOffset);

    totalUncompressedBytes += uncompressedSize;
    if (uncompressedSize > MAX_DOCX_UNCOMPRESSED_BYTES || totalUncompressedBytes > MAX_DOCX_UNCOMPRESSED_BYTES) {
      throw new Error(`DOCX declared uncompressed content exceeds ${MAX_DOCX_UNCOMPRESSED_BYTES} bytes`);
    }

    if (localHeaderOffset + 30 > centralDirectoryOffset || bytes.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
      throw new Error(`DOCX ZIP entry ${JSON.stringify(name)} has an invalid local header`);
    }
    const localFlags = bytes.readUInt16LE(localHeaderOffset + 6);
    const localMethod = bytes.readUInt16LE(localHeaderOffset + 8);
    const localNameLength = bytes.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = bytes.readUInt16LE(localHeaderOffset + 28);
    const localNameStart = localHeaderOffset + 30;
    const localDataStart = localNameStart + localNameLength + localExtraLength;
    const localDataEnd = localDataStart + compressedSize;
    if (localDataEnd > centralDirectoryOffset) {
      throw new Error(`DOCX ZIP entry ${JSON.stringify(name)} exceeds local-data bounds`);
    }
    if (localFlags !== flags || localMethod !== compressionMethod) {
      throw new Error(`DOCX ZIP entry ${JSON.stringify(name)} disagrees with its local header`);
    }
    const localName = decodeZipEntryName(
      bytes.subarray(localNameStart, localNameStart + localNameLength),
      localFlags
    );
    if (localName !== name) {
      throw new Error(`DOCX ZIP entry ${JSON.stringify(name)} has a mismatched local name`);
    }

    cursor = entryEnd;
  }

  if (cursor !== centralDirectoryEnd) {
    throw new Error('DOCX ZIP central directory contains unexplained trailing bytes');
  }
  for (const requiredName of REQUIRED_DOCX_ENTRIES) {
    if (!names.has(requiredName)) {
      throw new Error(`DOCX is missing required ZIP entry ${requiredName}`);
    }
  }
  return true;
}

function validateResumeManifest(manifest) {
  const errors = [];
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return ['expected a non-null object'];
  }

  const keys = Object.keys(manifest);
  const missing = MANIFEST_KEYS.filter((key) => !Object.hasOwn(manifest, key));
  const extras = keys.filter((key) => !MANIFEST_KEYS.includes(key));
  if (missing.length) errors.push(`missing key(s): ${missing.join(', ')}`);
  if (extras.length) errors.push(`unexpected key(s): ${extras.join(', ')}`);
  if (manifest.$generatedBy !== 'scripts/build-resume.mjs') {
    errors.push('$generatedBy must equal scripts/build-resume.mjs');
  }
  if (manifest.description !== RESUME_MANIFEST_DESCRIPTION) {
    errors.push('description does not match the generator contract');
  }
  for (const key of ['htmlSha256', 'pdfSha256', 'docxSha256']) {
    if (typeof manifest[key] !== 'string' || !SHA256_PATTERN.test(manifest[key])) {
      errors.push(`${key} must be a lowercase sha256- hash`);
    }
  }
  if (!Array.isArray(manifest.sources) ||
      manifest.sources.length !== EXPECTED_SOURCES.length ||
      manifest.sources.some((source, index) => source !== EXPECTED_SOURCES[index])) {
    errors.push(`sources must exactly equal ${JSON.stringify(EXPECTED_SOURCES)}`);
  }
  return errors;
}

function readIssueCode(prefix, reason) {
  return `${prefix}_${reason.toUpperCase()}`;
}

function checkResumeFreshness({ rootDir = projectRoot, afterArtifactRead } = {}) {
  const issues = [];
  const addIssue = (code, message, artifact) => issues.push({ code, message, artifact });
  const pathFor = (relativePath) => path.join(rootDir, relativePath);
  const hookFor = (relativePath) => afterArtifactRead
    ? (context) => afterArtifactRead({ relativePath, ...context })
    : undefined;

  let manifest;
  try {
    const manifestBytes = readStableFileNoFollow(pathFor(MANIFEST_REL), {
      rootDir,
      label: MANIFEST_REL,
      maxBytes: MAX_MANIFEST_BYTES,
      afterRead: hookFor(MANIFEST_REL)
    });
    try {
      const manifestText = new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes);
      manifest = JSON.parse(manifestText);
    } catch (error) {
      addIssue('MANIFEST_PARSE', `Could not parse ${MANIFEST_REL}: ${error.message}`, MANIFEST_REL);
    }
  } catch (error) {
    if (error instanceof StableFileReadError) {
      addIssue(
        readIssueCode('MANIFEST', error.reason),
        error.reason === 'missing'
          ? `Missing ${MANIFEST_REL}. Run \`npm run build:resume\`.`
          : `Unsafe ${MANIFEST_REL}: ${error.message}. Run \`npm run build:resume\`.`,
        MANIFEST_REL
      );
    } else {
      addIssue('MANIFEST_READ', `Could not read ${MANIFEST_REL}: ${error.message}`, MANIFEST_REL);
    }
  }

  if (manifest !== undefined) {
    for (const error of validateResumeManifest(manifest)) {
      addIssue(
        'MANIFEST_SCHEMA',
        `Invalid ${MANIFEST_REL}: ${error}. Run \`npm run build:resume\`.`,
        MANIFEST_REL
      );
    }
  }

  const artifactSpecs = [
    { label: 'PDF', relativePath: PDF_REL, manifestKey: 'pdfSha256', maxBytes: MAX_PDF_BYTES, validate: validatePdfBytes },
    { label: 'DOCX', relativePath: DOCX_REL, manifestKey: 'docxSha256', maxBytes: MAX_DOCX_BYTES, validate: validateDocxBytes }
  ];
  for (const spec of artifactSpecs) {
    let bytes;
    try {
      bytes = readStableFileNoFollow(pathFor(spec.relativePath), {
        rootDir,
        label: spec.relativePath,
        maxBytes: spec.maxBytes,
        afterRead: hookFor(spec.relativePath)
      });
    } catch (error) {
      if (error instanceof StableFileReadError) {
        addIssue(
          readIssueCode('ARTIFACT', error.reason),
          error.reason === 'missing'
            ? `Missing ${spec.relativePath}. Run \`npm run build:resume\`.`
            : `Unsafe resume ${spec.label} at ${spec.relativePath}: ${error.message}.`,
          spec.relativePath
        );
      } else {
        addIssue('ARTIFACT_READ', `Could not read ${spec.relativePath}: ${error.message}`, spec.relativePath);
      }
      continue;
    }

    try {
      spec.validate(bytes);
    } catch (error) {
      addIssue(
        'ARTIFACT_INVALID',
        `Resume ${spec.label} structure is invalid: ${error.message}. Run \`npm run build:resume\`.`,
        spec.relativePath
      );
      continue;
    }

    const sha256 = computeBytesSha256(bytes);
    if (manifest && typeof manifest[spec.manifestKey] === 'string' &&
        SHA256_PATTERN.test(manifest[spec.manifestKey]) && manifest[spec.manifestKey] !== sha256) {
      addIssue(
        'ARTIFACT_HASH_MISMATCH',
        `Resume ${spec.label} bytes do not match ${MANIFEST_REL}. Run \`npm run build:resume\`.`,
        spec.relativePath
      );
    }
  }

  let currentHash;
  try {
    const data = loadResumeData({ rootDir });
    validateResumeSources(data);
    currentHash = computeResumeHtmlHash(renderResumeHtml(data));
  } catch (error) {
    addIssue('SOURCE_INVALID', `Could not validate resume sources: ${error.message}`, 'data');
  }

  if (currentHash && manifest && typeof manifest.htmlSha256 === 'string' &&
      SHA256_PATTERN.test(manifest.htmlSha256) && manifest.htmlSha256 !== currentHash) {
    addIssue(
      'SOURCE_HASH_MISMATCH',
      'Resume sources changed but docs/resume.pdf and docs/resume.docx were not regenerated.\n' +
        `  manifest htmlSha256: ${manifest.htmlSha256}\n` +
        `  current  htmlSha256: ${currentHash}\n` +
        '  Fix: run `npm run build:resume`, then commit docs/resume.pdf, docs/resume.docx, and docs/resume.manifest.json.',
      'data'
    );
  }

  return {
    ok: issues.length === 0,
    failures: issues.map((issue) => issue.message),
    issues,
    currentHash
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { ok, failures } = checkResumeFreshness();
  if (!ok) {
    console.error('Resume freshness check failed:');
    failures.forEach((failure) => console.error(`- ${failure}`));
    process.exitCode = 1;
  } else {
    console.log('Resume freshness check passed.');
  }
}

export {
  checkResumeFreshness,
  computeBytesSha256,
  readStableFileNoFollow,
  validatePdfBytes,
  validateDocxBytes,
  validateResumeManifest,
  StableFileReadError,
  MAX_MANIFEST_BYTES,
  MAX_PDF_BYTES,
  MAX_DOCX_BYTES
};
