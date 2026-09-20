#!/usr/bin/env node
// End-to-end check of a local build or a deployed URL. No dependencies:
// uses Node 24's global fetch and WebSocket only.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

const args = process.argv.slice(2);
const urlFlagIndex = args.indexOf('--url');
const targetUrl = urlFlagIndex !== -1 ? args[urlFlagIndex + 1] : null;

function wsUrlFor(baseUrl) {
  const url = new URL('/ws', baseUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

function checkTicks(wsUrl) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl);
    const ticks = [];
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error('ws: timed out waiting for tick messages'));
    }, 15000);

    function finish(fn) {
      clearTimeout(timer);
      try {
        socket.close();
      } catch {
        // already closed
      }
      fn();
    }

    socket.addEventListener('message', (event) => {
      try {
        const data = JSON.parse(event.data.toString());
        if (data.type === 'tick' && typeof data.tick === 'number') {
          ticks.push(data.tick);
          if (ticks.length >= 3) {
            for (let i = 1; i < ticks.length; i += 1) {
              if (ticks[i] !== ticks[i - 1] + 1) {
                finish(() => reject(new Error(`ws: tick did not increase by exactly 1 (${ticks.join(',')})`)));
                return;
              }
            }
            finish(resolve);
          }
        }
      } catch {
        // Ignore malformed frames.
      }
    });

    socket.addEventListener('error', () => {
      finish(() => reject(new Error('ws: connection error')));
    });
  });
}

async function runChecks(baseUrl) {
  const healthRes = await fetch(new URL('/healthz', baseUrl));
  if (healthRes.status !== 200) {
    throw new Error(`healthz: expected 200, got ${healthRes.status}`);
  }
  const healthBody = await healthRes.json();
  if (healthBody.ok !== true) {
    throw new Error('healthz: body did not report ok true');
  }

  const pageRes = await fetch(new URL('/', baseUrl));
  if (pageRes.status !== 200) {
    throw new Error(`page: expected 200, got ${pageRes.status}`);
  }
  const pageCacheControl = pageRes.headers.get('cache-control') ?? '';
  if (!pageCacheControl.includes('no-cache')) {
    throw new Error(`page: cache-control missing no-cache (got "${pageCacheControl}")`);
  }
  const html = await pageRes.text();
  if (!html.includes('id="root"')) {
    throw new Error('page: root element not found in HTML');
  }

  const assetMatch = html.match(/\/assets\/[^"'\s]+\.js/);
  if (assetMatch === null) {
    throw new Error('asset: no /assets/*.js reference found in page HTML');
  }
  const assetRes = await fetch(new URL(assetMatch[0], baseUrl));
  if (assetRes.status !== 200) {
    throw new Error(`asset: expected 200, got ${assetRes.status}`);
  }
  const assetCacheControl = assetRes.headers.get('cache-control') ?? '';
  if (!assetCacheControl.includes('immutable')) {
    throw new Error(`asset: cache-control missing immutable (got "${assetCacheControl}")`);
  }

  await checkTicks(wsUrlFor(baseUrl));
}

async function waitForFirstAnswer(baseUrl, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(new URL('/healthz', baseUrl));
      if (res.ok) return;
      lastError = new Error(`healthz: status ${res.status}`);
    } catch (err) {
      lastError = err;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw lastError ?? new Error('timed out waiting for an answer');
}

async function runAgainstDeployedUrl(url) {
  await waitForFirstAnswer(url, 90000);
  await runChecks(url);
}

async function runAgainstLocalBuild() {
  const serverPath = path.join(repoRoot, 'apps/server/dist/server.js');
  const child = spawn(process.execPath, [serverPath], {
    cwd: repoRoot,
    env: { ...process.env, PORT: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdoutBuffer = '';
  let stderrBuffer = '';

  try {
    const port = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`server did not print a listening line in time (stderr: ${stderrBuffer})`));
      }, 15000);

      child.stdout.on('data', (chunk) => {
        stdoutBuffer += chunk.toString();
        const match = stdoutBuffer.match(/listening on (\d+)/);
        if (match) {
          clearTimeout(timer);
          resolve(Number(match[1]));
        }
      });
      child.stderr.on('data', (chunk) => {
        stderrBuffer += chunk.toString();
      });
      child.on('exit', (code) => {
        clearTimeout(timer);
        reject(new Error(`server exited early (code ${code}): ${stderrBuffer}`));
      });
    });

    await runChecks(`http://127.0.0.1:${port}`);
  } finally {
    child.kill('SIGTERM');
  }
}

async function main() {
  if (targetUrl) {
    await runAgainstDeployedUrl(targetUrl);
  } else {
    await runAgainstLocalBuild();
  }
  console.log('SMOKE OK');
}

main().catch((err) => {
  console.error(`SMOKE FAIL: ${err.message ?? String(err)}`);
  process.exitCode = 1;
});
