#!/usr/bin/env node
// Checks the built stylesheet keeps the two facts the table's look depends
// on. No dependencies: plain Node over the files `vite build` leaves behind.
//
// The page's styles and the table's styles are written by two different
// things. Ours are built into one file up front; the table writes its own
// into the page while it runs. Which of the two wins is decided by the
// order the browser is told to resolve its layers in, and that order is one
// line of CSS. Lose the line and the reset can reach inside the table, or a
// utility can no longer reach it — either way the table renders differently
// in the built page than it does in development, which is the one thing
// nobody would notice from a test.
//
// The order is also not safe to assume once written: the build is free to
// rewrite a layer statement whose names it can see are already established
// in that order, and it does exactly that to ours. That is why the line is
// stated twice, once in the stylesheet and once in the page's head, and why
// this check reads both.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const assetsDir = path.join(repoRoot, 'apps/web/dist/assets');
const pageFile = path.join(repoRoot, 'apps/web/dist/index.html');

// Weakest first. `base` is the framework's reset, `ag-grid` is the layer the
// table writes into, so the reset sits below the table and cannot reach it
// while the utilities sit above and can.
const REQUIRED_LAYER_ORDER = ['theme', 'base', 'ag-grid', 'components', 'utilities'];

// The table ships no stylesheet: it injects its styles at runtime. So the
// only `.ag-` selectors that belong in a built file are the handful the page
// writes itself, listed here by hand. Anything else means someone imported
// one of the library's legacy stylesheets, which would land unlayered, win
// over everything, and undo the ordering above.
//
// Adding a new `.ag-` rule to the page means adding it here too. That is on
// purpose: it is one line, and it keeps this list an accurate statement of
// every grid selector the page is allowed to write.
const PAGE_OWN_GRID_SELECTORS = new Set([
  'ag-cell',
  'ag-cell-focus',
  'ag-header-cell-text',
  'ag-row',
]);

// A token the built stylesheet must contain. Without this the check would
// pass on an empty file, a stale build or the wrong folder — that is, it
// would pass most loudly exactly when it is broken.
const MUST_BE_PRESENT = '--muted-foreground';

function fail(message) {
  console.error(`CSS FAIL: ${message}`);
  process.exitCode = 1;
}

/** Every `@layer a, b, c;` statement in the text, as arrays of layer names. */
function layerStatements(text) {
  return [...text.matchAll(/@layer\s+([a-zA-Z0-9_ ,-]+);/g)].map((m) =>
    m[1].split(',').map((name) => name.trim()).filter(Boolean),
  );
}

/** Does this statement name all of `REQUIRED_LAYER_ORDER`, in that order? */
function statesRequiredOrder(names) {
  let next = 0;
  for (const name of names) {
    if (name === REQUIRED_LAYER_ORDER[next]) next += 1;
    if (next === REQUIRED_LAYER_ORDER.length) return true;
  }
  return false;
}

function main() {
  let entries;
  try {
    entries = readdirSync(assetsDir);
  } catch {
    fail(`no built stylesheet at ${path.relative(repoRoot, assetsDir)} — run \`pnpm run build\` first.`);
    return;
  }

  const sheets = entries.filter((name) => name.endsWith('.css'));
  if (sheets.length === 0) {
    fail(`${path.relative(repoRoot, assetsDir)} holds no .css file — run \`pnpm run build\` first.`);
    return;
  }

  let page = '';
  try {
    page = readFileSync(pageFile, 'utf8');
  } catch {
    fail(`no built page at ${path.relative(repoRoot, pageFile)} — run \`pnpm run build\` first.`);
    return;
  }

  const styles = sheets.map((name) => ({ name, text: readFileSync(path.join(assetsDir, name), 'utf8') }));

  // 1. The layer order, in the stylesheet or in the page.
  const everywhere = [...styles.map((s) => s.text), page].join('\n');
  const stated = layerStatements(everywhere).some(statesRequiredOrder);
  if (!stated) {
    fail(
      `neither the built stylesheet nor the built page states the layer order ` +
        `\`@layer ${REQUIRED_LAYER_ORDER.join(', ')};\`. Without it the table's styles are ` +
        `not held between the reset and the utilities, and the built page can render ` +
        `differently from the development one.`,
    );
    return;
  }

  // 2. No grid stylesheet was bundled.
  let bundledGridCss = false;
  for (const sheet of styles) {
    const found = new Set([...sheet.text.matchAll(/\.(ag-[a-z0-9-]+)/g)].map((m) => m[1]));
    for (const selector of found) {
      if (!PAGE_OWN_GRID_SELECTORS.has(selector)) {
        bundledGridCss = true;
        fail(
          `assets/${sheet.name} contains the table rule \`.${selector}\`, which the page does ` +
            `not write. One of the library's stylesheets has been imported; it would land ` +
            `outside every layer and override the whole page. Remove the import.`,
        );
      }
    }
  }
  if (bundledGridCss) return;

  // 3. The positive control, last: if this is missing the two results above
  //    mean nothing, because the check was reading the wrong build.
  if (!styles.some((sheet) => sheet.text.includes(MUST_BE_PRESENT))) {
    fail(
      `none of the ${styles.length} built stylesheet(s) contain "${MUST_BE_PRESENT}", which the ` +
        `page's own colour block must hold. The check was looking at the wrong or a stale ` +
        `build, so its result means nothing.`,
    );
    return;
  }

  console.log(
    `CSS OK (${styles.length} stylesheet(s) checked, layers ordered ${REQUIRED_LAYER_ORDER.join(' < ')}, no bundled table CSS)`,
  );
}

main();
