#!/usr/bin/env node
// Checks the built browser bundle for text that only the engine contains, and
// checks that the hidden module lab was built and reaches no further than it
// says. No dependencies: plain Node over the files `vite build` leaves behind.
//
// The engine works out a market's whole future from its seed. This repository
// is public, so if the engine ever reached the browser bundle, anyone with a
// leaked seed could compute every price to come. The export map and a lint
// rule both refuse that import; this is the check on the artefact itself,
// which is the only one that cannot be talked around.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const distDir = path.join(repoRoot, 'apps/web/dist');
const assetsDir = path.join(distDir, 'assets');

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

// The lab is a second page in the same build, and it talks to nothing. Two
// things have to hold on the artefact, and only on the artefact. First, the
// page has to be there at all: the service answers with its one page for
// anything it cannot find, so a build that stopped emitting the lab's page
// would quietly serve the *game* at /lab on the public address — which opens
// a socket and starts a real game — with every other check still green.
// Second, nothing the lab loads may hold the key the page's socket feed keeps
// its session under: that key is in the running game's start-up path, so
// finding it in the lab's scripts means the lab has pulled the game in.
const GAME_PAGE = 'index.html';
const LAB_PAGE = 'lab/index.html';
const LAB_ROOT = 'id="lab-root"';
const SESSION_KEY = 'strike-desk.session';

function fail(message) {
  console.error(`BUNDLE FAIL: ${message}`);
  process.exitCode = 1;
}

/** Whether the built script `assets/<name>` holds `text`. */
function assetHolds(name, text) {
  return readFileSync(path.join(assetsDir, name), 'utf8').includes(text);
}

/**
 * The built scripts a page pulls in, by name under `assets/`: both the one it
 * runs and the shared chunks it preloads, since the page loads those too.
 */
function scriptsOf(html) {
  return [...new Set([...html.matchAll(/\/assets\/([^"']+\.js)/g)].map((found) => found[1]))];
}

/** How many of the lab's scripts were read, or 0 if something was wrong. */
function checkLabPage() {
  let labHtml;
  let gameHtml;
  try {
    labHtml = readFileSync(path.join(distDir, LAB_PAGE), 'utf8');
  } catch {
    fail(`the build left no ${LAB_PAGE}, so /lab would answer with the game's page — which starts a real game.`);
    return 0;
  }
  if (!labHtml.includes(LAB_ROOT)) {
    fail(`${LAB_PAGE} holds no ${LAB_ROOT}, so it is not the lab's page.`);
    return 0;
  }

  try {
    gameHtml = readFileSync(path.join(distDir, GAME_PAGE), 'utf8');
  } catch {
    fail(`the build left no ${GAME_PAGE}.`);
    return 0;
  }

  const labScripts = scriptsOf(labHtml);
  const gameScripts = scriptsOf(gameHtml);
  if (labScripts.length === 0 || gameScripts.length === 0) {
    fail(`${LAB_PAGE} names ${labScripts.length} script(s) and ${GAME_PAGE} names ${gameScripts.length}: a page that loads nothing means the check was looking at the wrong or a stale build.`);
    return 0;
  }

  // The same control the engine markers get: the game's own page must hold
  // the key, or the text has been renamed and searching for it proves nothing.
  if (!gameScripts.some((name) => assetHolds(name, SESSION_KEY))) {
    fail(
      `none of the game page's ${gameScripts.length} script(s) hold "${SESSION_KEY}", which the page's socket feed keeps its session under. The check was looking at the wrong or a stale build, or the key was renamed, so its result means nothing.`,
    );
    return 0;
  }

  for (const name of labScripts) {
    if (assetHolds(name, SESSION_KEY)) {
      fail(`the lab loads assets/${name}, which holds "${SESSION_KEY}": the lab has pulled the running game in.`);
    }
  }

  return labScripts.length;
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

  const labScriptCount = checkLabPage();
  if (process.exitCode === 1) return;

  console.log(
    `BUNDLE OK (${scripts.length} script(s) checked, ${ENGINE_ONLY_MARKERS.length} engine markers absent, the lab's ${labScriptCount} script(s) free of the session key)`,
  );
}

main();
