#!/usr/bin/env node
// Holds one WebSocket open against any address and reports how long it
// lasted and how it closed. No dependencies: Node 24's global WebSocket
// only. Never sends a message on its own, like a browser tab left open.
//
// Usage:
//   node scripts/measure-ws-idle.mjs <ws-or-wss-url> --minutes <n> [--label <text>] [--connect-wait-s <n>]

const args = process.argv.slice(2);
const url = args[0];

function flagValue(name, fallback) {
  const index = args.indexOf(name);
  return index !== -1 ? args[index + 1] : fallback;
}

const label = flagValue('--label', null);
const minutes = Number(flagValue('--minutes', null));
const connectWaitS = Number(flagValue('--connect-wait-s', '90'));

if (!url || url.startsWith('--')) {
  console.error(
    'usage: node scripts/measure-ws-idle.mjs <ws-or-wss-url> --minutes <n> [--label <text>] [--connect-wait-s <n>]',
  );
  process.exit(1);
}

if (!Number.isFinite(minutes) || minutes <= 0) {
  console.error('error: --minutes must be a positive number');
  process.exit(1);
}

const start = Date.now();

function elapsedS() {
  return Math.round((Date.now() - start) / 1000);
}

function connectOnce(target) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(target);
    const onOpen = () => {
      socket.removeEventListener('error', onError);
      resolve(socket);
    };
    const onError = () => {
      socket.removeEventListener('open', onOpen);
      reject(new Error('connect failed'));
    };
    socket.addEventListener('open', onOpen, { once: true });
    socket.addEventListener('error', onError, { once: true });
  });
}

async function connectWithRetry(target, waitS) {
  const deadline = Date.now() + waitS * 1000;
  for (;;) {
    try {
      return await connectOnce(target);
    } catch {
      if (Date.now() >= deadline) {
        return null;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
}

async function main() {
  if (label !== null) {
    console.log(`label=${label}`);
  }

  const ws = await connectWithRetry(url, connectWaitS);
  if (ws === null) {
    console.log('RESULT connect-failed');
    process.exitCode = 3;
    return;
  }

  let messageCount = 0;
  let lastTick = null;
  let closedInfo = null;

  ws.addEventListener('message', (event) => {
    messageCount += 1;
    try {
      const data = JSON.parse(String(event.data));
      if (data && data.type === 'tick' && typeof data.tick === 'number') {
        lastTick = data.tick;
      }
    } catch {
      // Not JSON, or not a tick — still counted as a message.
    }
  });

  const closed = new Promise((resolve) => {
    ws.addEventListener(
      'close',
      (event) => {
        closedInfo = { code: event.code, reason: String(event.reason ?? '') };
        resolve();
      },
      { once: true },
    );
  });

  const minuteTimer = setInterval(() => {
    console.log(`t=${elapsedS()}s open messages=${messageCount} lastTick=${lastTick === null ? '-' : lastTick}`);
  }, 60_000);

  const targetMs = minutes * 60_000;
  const ranFullDuration = new Promise((resolve) => setTimeout(resolve, targetMs));

  await Promise.race([closed, ranFullDuration]);
  clearInterval(minuteTimer);

  if (closedInfo !== null) {
    console.log(`CLOSED t=${elapsedS()}s code=${closedInfo.code} reason=${closedInfo.reason}`);
    console.log(`RESULT closed-after=${elapsedS()}s code=${closedInfo.code}`);
    process.exitCode = 2;
    return;
  }

  console.log(`RESULT open-after=${minutes}min messages=${messageCount}`);
  ws.close();
  process.exitCode = 0;
}

main().catch((err) => {
  console.error(`error: ${err.message ?? String(err)}`);
  process.exitCode = 1;
});
