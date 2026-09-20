import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createApp } from './app';
import { VERSION } from './generated/version';

const here = path.dirname(fileURLToPath(import.meta.url));
const staticDir = path.resolve(here, '../../web/dist');

const portEnv = process.env.PORT;
const port = portEnv === undefined || portEnv === '' ? 10000 : Number(portEnv);

const app = createApp({ staticDir, version: VERSION });

app.server.listen(port, '0.0.0.0', () => {
  const address = app.server.address();
  const actualPort = typeof address === 'object' && address !== null ? address.port : port;
  console.log(`listening on ${actualPort}`);
});

const SHUTDOWN_TIMEOUT_MS = 5000;
let shuttingDown = false;

function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received, closing connections`);

  const forceExit = setTimeout(() => {
    console.error(`shutdown did not finish within ${SHUTDOWN_TIMEOUT_MS}ms, forcing exit`);
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExit.unref();

  app
    .close()
    .then(() => {
      clearTimeout(forceExit);
      process.exit(0);
    })
    .catch((err: unknown) => {
      clearTimeout(forceExit);
      console.error('error while closing', err);
      process.exit(1);
    });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
