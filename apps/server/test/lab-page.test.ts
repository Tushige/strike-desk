import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Harness } from './harness';
import { startHarness } from './harness';

/**
 * The lab is a second page of the same build, not a route inside the game's
 * page, so nothing in the service had to change to serve it: the static
 * handler resolves a folder holding an `index.html` by itself, and only falls
 * back to the game's page when no such file exists. That is the whole of the
 * claim, so it is the whole of this file — with its own static folder, so the
 * test says what it means whatever the real build has left in `apps/web/dist`.
 */

const GAME_PAGE = '<!doctype html><html><body><div id="root">GAME PAGE</div></body></html>';
const LAB_PAGE = '<!doctype html><html><body><div id="lab-root">LAB PAGE</div></body></html>';

let staticDir = '';
let harness: Harness | null = null;

beforeAll(() => {
  staticDir = mkdtempSync(path.join(tmpdir(), 'strike-desk-lab-'));
  writeFileSync(path.join(staticDir, 'index.html'), GAME_PAGE);
  mkdirSync(path.join(staticDir, 'assets'));
  mkdirSync(path.join(staticDir, 'lab'));
  writeFileSync(path.join(staticDir, 'lab', 'index.html'), LAB_PAGE);
});

afterAll(() => {
  rmSync(staticDir, { recursive: true, force: true });
});

afterEach(async () => {
  await harness?.close();
  harness = null;
});

async function boot(): Promise<Harness> {
  const running = await startHarness({ staticDir });
  harness = running;
  return running;
}

describe('the hidden lab page', () => {
  it('answers at /lab and at /lab/ with the lab own page, never the game page', async () => {
    const running = await boot();

    for (const route of ['/lab', '/lab/']) {
      const res = await fetch(`${running.baseUrl}${route}`);
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain('LAB PAGE');
      expect(text).not.toContain('GAME PAGE');
      // A page, not an asset: it must never be cached for a year, or a
      // deploy would leave the owner looking at yesterday's lab.
      expect(res.headers.get('cache-control')).toContain('no-cache');
    }
  });

  it('leaves the game at the root exactly where it was', async () => {
    const running = await boot();

    const res = await fetch(`${running.baseUrl}/`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('GAME PAGE');
    expect(text).not.toContain('LAB PAGE');
  });
});
