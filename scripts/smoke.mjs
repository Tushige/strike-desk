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
const expectCommitFlagIndex = args.indexOf('--expect-commit');
const expectCommit = expectCommitFlagIndex !== -1 ? args[expectCommitFlagIndex + 1] : null;

const SHORT_COMMIT_RE = /^[0-9a-f]{7}$/;

// The wire contract's version number is written out here because this file
// cannot import TypeScript. Bumping the protocol version must change it.
const PROTOCOL_VERSION = 1;
// The fastest pace the game offers, so three frames with a rising step arrive
// inside a second and this check never waits for the market to open.
const SMOKE_PACE = 7.5;
const FRAMES_WANTED = 3;
const WS_TIMEOUT_MS = 15000;
const COMPANY_COUNT = 6;
// Six companies, 21 targets each, UP and DOWN on every target.
const TICKET_COUNT = 252;

function wsUrlFor(baseUrl) {
  const url = new URL('/ws', baseUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

function dollars(cents) {
  return (cents / 100).toFixed(2);
}

/**
 * Speaks the real protocol: hello, then start, then reads the live stream.
 * Prints one `prices` line per frame so a person running this by hand can see
 * six share prices moving, not just a pass or a fail, and one `tickets` line
 * with how many ticket prices the first streamed frame carried.
 */
function checkStream(wsUrl) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl);
    let stage = 'lobby';
    const steps = [];

    const timer = setTimeout(() => {
      finish(() => reject(new Error(`ws: timed out after ${WS_TIMEOUT_MS}ms in stage "${stage}"`)));
    }, WS_TIMEOUT_MS);

    function finish(fn) {
      clearTimeout(timer);
      try {
        socket.close();
      } catch {
        // already closed
      }
      fn();
    }

    function fail(message) {
      finish(() => reject(new Error(`ws: ${message}`)));
    }

    /** True when the frame carries six whole-cent share prices. */
    function pricesAreWholeCents(frame) {
      if (!Array.isArray(frame.prices) || frame.prices.length !== COMPANY_COUNT) {
        fail(`expected ${COMPANY_COUNT} prices, got ${JSON.stringify(frame.prices)}`);
        return false;
      }
      for (const price of frame.prices) {
        if (!Number.isInteger(price)) {
          fail(`a price is not a whole number of cents: ${JSON.stringify(price)}`);
          return false;
        }
      }
      return true;
    }

    function isWholeCentsFromZero(value) {
      return Number.isInteger(value) && value >= 0;
    }

    /**
     * True when the frame of a started game carries the board, the six names
     * and one whole-cent ticket price per contract, each with a real value
     * and a hope value that add up to it, and a whole-cent break-even.
     */
    function ticketsAddUp(frame) {
      if (!Array.isArray(frame.companies) || frame.companies.length !== COMPANY_COUNT) {
        fail(`expected ${COMPANY_COUNT} company names, got ${JSON.stringify(frame.companies)}`);
        return false;
      }
      if (!Array.isArray(frame.board?.companies) || frame.board.companies.length !== COMPANY_COUNT) {
        fail(`expected a board of ${COMPANY_COUNT} companies, got ${JSON.stringify(frame.board?.companies?.length)}`);
        return false;
      }
      for (const name of ['quotes', 'quoteReals', 'quoteHopes', 'quoteBreakEvens']) {
        const values = frame[name];
        if (!Array.isArray(values) || values.length !== TICKET_COUNT) {
          fail(`expected ${TICKET_COUNT} entries in ${name}, got ${Array.isArray(values) ? values.length : JSON.stringify(values)}`);
          return false;
        }
        const bad = values.findIndex((value) => !isWholeCentsFromZero(value));
        if (bad !== -1) {
          fail(`${name}[${bad}] is not a whole number of cents at or above zero: ${JSON.stringify(values[bad])}`);
          return false;
        }
      }
      const apart = frame.quotes.findIndex((price, id) => frame.quoteReals[id] + frame.quoteHopes[id] !== price);
      if (apart !== -1) {
        fail(`ticket ${apart}: real ${frame.quoteReals[apart]} plus hope ${frame.quoteHopes[apart]} is not its price ${frame.quotes[apart]}`);
        return false;
      }
      return true;
    }

    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION }));
    });

    socket.addEventListener('message', (event) => {
      let message;
      try {
        message = JSON.parse(event.data.toString());
      } catch {
        fail('the server sent text that is not JSON');
        return;
      }
      // The heartbeat carries no `t`; it is not part of this check.
      if (message === null || typeof message !== 'object' || typeof message.t !== 'string') return;
      if (message.t === 'error') {
        fail(`the server refused a message: ${message.code}`);
        return;
      }

      if (stage === 'lobby') {
        if (message.t !== 'frame') {
          fail(`expected a frame in answer to hello, got "${message.t}"`);
          return;
        }
        if (message.clock?.phase !== 'lobby') {
          fail(`expected the first frame to be the lobby, got "${message.clock?.phase}"`);
          return;
        }
        if (!pricesAreWholeCents(message)) return;
        stage = 'starting';
        socket.send(JSON.stringify({ t: 'start', commandId: crypto.randomUUID(), pace: SMOKE_PACE }));
        return;
      }

      if (stage === 'starting') {
        // A sampled lobby frame may still be on its way; the reply is what matters.
        if (message.t !== 'reply') return;
        if (message.receipt?.outcome !== 'accepted') {
          fail(`start was not accepted: ${JSON.stringify(message.receipt)}`);
          return;
        }
        stage = 'streaming';
        return;
      }

      if (message.t !== 'frame') return;
      if (!pricesAreWholeCents(message)) return;
      if (!ticketsAddUp(message)) return;
      const previous = steps.length === 0 ? -1 : steps[steps.length - 1];
      if (!(message.step > previous)) {
        fail(`step did not rise: ${previous} then ${message.step}`);
        return;
      }
      if (steps.length === 0) {
        console.log(`tickets ${message.quotes.length}`);
        console.log(`break-evens ${message.quoteBreakEvens.length}`);
      }
      steps.push(message.step);
      console.log(`prices ${message.prices.map(dollars).join(' ')}`);
      if (steps.length >= FRAMES_WANTED) finish(resolve);
    });

    socket.addEventListener('error', () => {
      fail('connection error');
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
  const healthKeys = Object.keys(healthBody).sort();
  if (healthKeys.join(',') !== 'buildTime,commit,ok,sessions,sockets') {
    throw new Error(`healthz: expected exactly the keys ok, commit, buildTime, sessions, sockets (got ${healthKeys.join(', ')})`);
  }
  for (const name of ['sessions', 'sockets']) {
    const count = healthBody[name];
    if (!Number.isInteger(count) || count < 0) {
      throw new Error(`healthz: ${name} is not a count (got ${JSON.stringify(count)})`);
    }
  }
  if (!SHORT_COMMIT_RE.test(healthBody.commit)) {
    throw new Error(`healthz: commit "${healthBody.commit}" is not 7 hex characters`);
  }
  if (expectCommit !== null && healthBody.commit !== expectCommit) {
    throw new Error(`healthz: expected commit "${expectCommit}", got "${healthBody.commit}"`);
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
  const assetText = await assetRes.text();
  if (!assetText.includes(healthBody.commit)) {
    throw new Error(`asset: page bundle does not contain the healthz commit "${healthBody.commit}"`);
  }
  if (!assetText.includes(healthBody.buildTime)) {
    throw new Error(`asset: page bundle does not contain the healthz buildTime "${healthBody.buildTime}"`);
  }

  await checkStream(wsUrlFor(baseUrl));
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

const SHUTDOWN_TIMEOUT_MS = 5000;

function waitForExit(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`server did not exit within ${timeoutMs}ms of SIGTERM`));
    }, timeoutMs);
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
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
  let exited = false;
  child.once('exit', () => {
    exited = true;
  });

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

    child.kill('SIGTERM');
    const { code, signal } = await waitForExit(child, SHUTDOWN_TIMEOUT_MS);
    if (code !== 0) {
      throw new Error(`server exited with code ${code} (signal ${signal}) after SIGTERM, expected 0`);
    }
  } finally {
    if (!exited) {
      child.kill('SIGTERM');
    }
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
