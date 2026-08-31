import { readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

const releaseRoot = process.argv[2];
if (!releaseRoot) throw new Error('Usage: node compact-chrome-release.mjs <extension-dir>');

const backgroundPath = join(releaseRoot, 'background.js');
const offscreenHtml = await readFile(join(releaseRoot, 'offscreen.html'), 'utf8');
const offscreenScript = /src="\/?([^"]*offscreen-[^"]+\.js)"/.exec(offscreenHtml)?.[1];
if (!offscreenScript) throw new Error('Could not locate the offscreen runtime');

const background = await readFile(backgroundPath, 'utf8');
const offscreen = await readFile(join(releaseRoot, offscreenScript), 'utf8');
const workerPattern = /assets\/((pii|ocr|vision)\.worker-[A-Za-z0-9_-]+\.js)/g;

function workerReferences(source) {
  const references = new Map();
  for (const match of source.matchAll(workerPattern)) {
    const file = match[1];
    const kind = match[2];
    if (file && kind) references.set(kind, file);
  }
  return references;
}

const backgroundWorkers = workerReferences(background);
const offscreenWorkers = workerReferences(offscreen);
if (backgroundWorkers.size !== 3 || offscreenWorkers.size !== 3) {
  throw new Error('Expected Rampart, OCR, and vision worker references');
}

let compactedBackground = background;
let removedBytes = 0;
for (const [kind, largeWorker] of backgroundWorkers) {
  const sharedWorker = offscreenWorkers.get(kind);
  if (!sharedWorker) throw new Error(`Missing shared ${kind} worker`);
  compactedBackground = compactedBackground.replaceAll(largeWorker, sharedWorker);
  if (largeWorker === sharedWorker) continue;
  const largePath = join(releaseRoot, 'assets', basename(largeWorker));
  removedBytes += (await stat(largePath)).size;
  await unlink(largePath);
}
await writeFile(backgroundPath, compactedBackground, 'utf8');

const remainingFiles = await readdir(join(releaseRoot, 'assets'));
for (const sharedWorker of offscreenWorkers.values()) {
  if (!remainingFiles.includes(basename(sharedWorker))) {
    throw new Error(`Compaction removed required worker ${sharedWorker}`);
  }
}

process.stdout.write(`Removed ${removedBytes} duplicate Chrome worker bytes.\n`);
