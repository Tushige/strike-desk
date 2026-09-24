import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createApp } from './app';
import { PUBLIC_MAX_BOARD_SIZE, isAllowedBoardSize } from './boardSizes';
import { VERSION } from './generated/version';
import { createNeonRepository } from './neon';
import { createResultsService } from './results';

const here = path.dirname(fileURLToPath(import.meta.url));
const staticDir = path.resolve(here, '../../web/dist');

const portEnv = process.env.PORT;
const port = portEnv === undefined || portEnv === '' ? 10000 : Number(portEnv);

// The measurement-only connection modes are off unless this instance was
// started for a measurement. The public host does not set it.
const probeModes = process.env.WS_PROBE_MODES === '1';

// The largest stress board this instance will build. Absent, unreadable or
// not an allow-listed size all mean the public maximum, so only an instance
// deliberately started for a measurement builds a larger one. `render.yaml`
// sets nothing, so the public host stays at the public maximum.
const maxBoardEnv = Number(process.env.STRESS_MAX_BOARD);
const maxBoardSize = isAllowedBoardSize(maxBoardEnv) ? maxBoardEnv : PUBLIC_MAX_BOARD_SIZE;

const databaseUrl = process.env.DATABASE_URL;
const statsEnvironment = process.env.STATS_ENVIRONMENT;
if (databaseUrl && statsEnvironment !== 'development' && statsEnvironment !== 'production') {
  throw new Error('Set STATS_ENVIRONMENT to development or production when DATABASE_URL is configured.');
}
const results = databaseUrl && (statsEnvironment === 'development' || statsEnvironment === 'production')
  ? createResultsService(createNeonRepository(databaseUrl, statsEnvironment)) : undefined;
const app = createApp({ staticDir, version: VERSION, probeModes, maxBoardSize, results });

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
