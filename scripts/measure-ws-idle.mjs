#!/usr/bin/env node
// Holds one WebSocket open against any address and reports how long it
// lasted and how it closed. No dependencies: Node 24's global WebSocket
// only. By default it never sends a message on its own, like a browser tab
// left open. With --start it says hello and starts a game at pace 1 first,
// so a connection that also carries the live price stream can be measured.
//
// Usage:
//   node scripts/measure-ws-idle.mjs <ws-or-wss-url> --minutes <n> [--label <text>] [--connect-wait-s <n>] [--start]

const args = process.argv.slice(2);
const url = args[0];

function flagValue(name, fallback) {
  const index = args.indexOf(name);
  return index !== -1 ? args[index + 1] : fallback;
}

const label = flagValue('--label', null);
const minutes = Number(flagValue('--minutes', null));
const connectWaitS = Number(flagValue('--connect-wait-s', '90'));
const alsoStart = args.includes('--start');

// Written out because this file cannot import TypeScript; a protocol version
// bump must change it.
const PROTOCOL_VERSION = 1;

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
  let lastStep = null;
  let closedInfo = null;

  ws.addEventListener('message', (event) => {
    messageCount += 1;
    try {
      const data = JSON.parse(String(event.data));
      if (data && data.t === 'frame' && typeof data.step === 'number') {
        lastStep = data.step;
      }
    } catch {
      // Not JSON, or not a frame — still counted as a message.
    }
  });

  if (alsoStart) {
    ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION }));
    ws.send(JSON.stringify({ t: 'start', commandId: crypto.randomUUID(), pace: 1 }));
  }

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
    console.log(`t=${elapsedS()}s open messages=${messageCount} lastStep=${lastStep === null ? '-' : lastStep}`);
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
