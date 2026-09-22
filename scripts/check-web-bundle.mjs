#!/usr/bin/env node
// Checks the built browser bundle for text that only the engine contains.
// No dependencies: plain Node over the files `vite build` leaves behind.
//
// The engine works out a market's whole future from its seed. This repository
// is public, so if the engine ever reached the browser bundle, anyone with a
// leaked seed could compute every price to come. The export map and a lint
// rule both refuse that import; this is the check on the artefact itself,
// which is the only one that cannot be talked around.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const assetsDir = path.join(repoRoot, 'apps/web/dist/assets');

// Error messages that exist only in engine files, chosen because a production
// build keeps a string literal whole even though it shortens every function
// name around it. Searching for an identifier instead would not work: the
// build renames them, and `marketCode` is a field of the shared wire contract
// that the browser must hold, so finding it proves nothing.
const ENGINE_ONLY_MARKERS = [
  { text: 'seed must be an integer in [0, 2^48)', source: 'packages/shared/src/rng.ts' },
  { text: 'nextInt needs a positive integer', source: 'packages/shared/src/rng.ts' },
  { text: 'no such price', source: 'packages/shared/src/market.ts' },
];

// A text the browser's own copy of the wire contract must contain. Without
// this the check would pass on an empty file, a stale build or the wrong
// folder — that is, it would pass most loudly exactly when it is broken.
const MUST_BE_PRESENT = 'versionMismatch';

function fail(message) {
  console.error(`BUNDLE FAIL: ${message}`);
  process.exitCode = 1;
}

function main() {
  let entries;
  try {
    entries = readdirSync(assetsDir);
  } catch {
    fail(`no built bundle at ${path.relative(repoRoot, assetsDir)} — run \`pnpm run build\` first.`);
    return;
  }

  const scripts = entries.filter((name) => name.endsWith('.js'));
  if (scripts.length === 0) {
    fail(`${path.relative(repoRoot, assetsDir)} holds no .js file — run \`pnpm run build\` first.`);
    return;
  }

  let found = false;
  let controlSeen = false;

  for (const name of scripts) {
    const filePath = path.join(assetsDir, name);
    const text = readFileSync(filePath, 'utf8');
    if (text.includes(MUST_BE_PRESENT)) controlSeen = true;
    for (const marker of ENGINE_ONLY_MARKERS) {
      if (text.includes(marker.text)) {
        found = true;
        fail(`engine text "${marker.text}" (from ${marker.source}) is in assets/${name}.`);
      }
    }
  }

  if (found) {
    console.error('The browser must not be able to compute the future. Find the import that pulled the engine in.');
    return;
  }

  if (!controlSeen) {
    fail(
      `none of the ${scripts.length} built script(s) contain "${MUST_BE_PRESENT}", which the browser's copy of the wire contract must hold. The check was looking at the wrong or a stale build, so its result means nothing.`,
    );
    return;
  }

  const manifest = JSON.parse(readFileSync(path.join(assetsDir, '../.vite/manifest.json'), 'utf8'));
  const initial = new Set();
  function visit(key) {
    if (initial.has(key)) return;
    initial.add(key);
    for (const dependency of manifest[key]?.imports ?? []) visit(dependency);
  }
  for (const [key, chunk] of Object.entries(manifest)) if (chunk.isEntry) visit(key);
  const grid = Object.entries(manifest).find(([key]) => key.endsWith('/CompareOptions.tsx'));
  if (!grid || initial.has(grid[0])) {
    fail('Comparison/grid must be a deferred chunk, outside the initial entry graph.');
    return;
  }
  const initialScripts = [...initial].map((key) => readFileSync(path.join(assetsDir, '..', manifest[key].file)));
  if (initialScripts.some((source) => source.includes('AG Grid'))) {
    fail('AG Grid implementation leaked into the initial route.');
    return;
  }
  const gridScript = readFileSync(path.join(assetsDir, '..', grid[1].file));
  const bytes = initialScripts.reduce((sum, source) => sum + source.length, 0);
  const compressed = initialScripts.reduce((sum, source) => sum + gzipSync(source).length, 0);
  console.log(`Initial JavaScript: ${bytes} bytes (${compressed} gzip); deferred grid: ${gridScript.length} bytes (${gzipSync(gridScript).length} gzip). CSS/fonts are separate.`);

  console.log(`BUNDLE OK (${scripts.length} script(s) checked, ${ENGINE_ONLY_MARKERS.length} engine markers absent)`);
}

main();
