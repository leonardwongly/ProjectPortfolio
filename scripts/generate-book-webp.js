#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const projectRoot = process.cwd();
const dataPath = path.join(projectRoot, 'data', 'reading.json');

if (!fs.existsSync(dataPath)) {
  console.error(`Missing reading data: ${dataPath}`);
  process.exit(1);
}

function derive2xPath(coverPath) {
  let derived = coverPath.replace('-300.jpg', '.jpg').replace('-300.jpeg', '.jpeg');
  if (derived === coverPath) {
    derived = coverPath;
  }
  return derived;
}

function toWebpPath(coverPath) {
  return coverPath.replace(/\.(jpe?g)$/i, '.webp');
}

try {
  execFileSync('cwebp', ['-version'], { stdio: 'ignore' });
} catch (error) {
  console.error('cwebp is required. Install it with `brew install webp` and try again.');
  process.exit(1);
}

const reading = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
const coverPaths = new Set();

reading.forEach((entry) => {
  if (entry.cover) {
    coverPaths.add(String(entry.cover));
  }
});

const sources = new Set();
coverPaths.forEach((cover) => {
  sources.add(cover);
  sources.add(derive2xPath(cover));
});

const missing = new Set();
const converted = [];
const skipped = [];

sources.forEach((relativePath) => {
  if (!relativePath) {
    return;
  }

  if (!/\.(jpe?g)$/i.test(relativePath)) {
    console.warn(`Skipping non-JPEG cover: ${relativePath}`);
    return;
  }

  const sourcePath = path.join(projectRoot, relativePath);
  if (!fs.existsSync(sourcePath)) {
    missing.add(relativePath);
    return;
  }

  const targetRelative = toWebpPath(relativePath);
  const targetPath = path.join(projectRoot, targetRelative);

  if (fs.existsSync(targetPath)) {
    skipped.push(targetRelative);
    return;
  }

  execFileSync('cwebp', ['-q', '80', '-mt', sourcePath, '-o', targetPath], { stdio: 'inherit' });
  converted.push(targetRelative);
});

if (missing.size > 0) {
  console.warn(`Missing cover sources (${missing.size}):\n- ${Array.from(missing).join('\n- ')}`);
}

console.log(`WebP generation complete. Created ${converted.length}, skipped ${skipped.length}, missing ${missing.size}.`);
