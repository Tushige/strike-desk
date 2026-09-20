#!/usr/bin/env node
// Runs once, at the top of build/typecheck/lint/dev. Reads the commit and
// captures "now" exactly once, then writes the same bytes into the two
// generated version files the server and the page each import. Never reads
// the commit or the clock again after this — a free instance waking from
// sleep restarts the process without a new build, and reading either of
// these again at server start would make "build time" silently mean
// "last wake time" instead.
import { execSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

function resolveCommit() {
  if (process.env.RENDER_GIT_COMMIT) {
    return process.env.RENDER_GIT_COMMIT;
  }
  if (process.env.GITHUB_SHA) {
    return process.env.GITHUB_SHA;
  }
  try {
    return execSync('git rev-parse HEAD', { cwd: repoRoot, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return null;
  }
}

const commit = resolveCommit();
if (!commit) {
  console.error('cannot determine commit');
  process.exit(1);
}

const shortCommit = commit.slice(0, 7);
const buildTime = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

const body = `export const VERSION = ${JSON.stringify({ commit: shortCommit, buildTime })} as const;\n`;

for (const relDir of ['apps/server/src/generated', 'apps/web/src/generated']) {
  const dir = path.join(repoRoot, relDir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'version.ts'), body);
}

console.log(`version ${shortCommit} ${buildTime}`);
