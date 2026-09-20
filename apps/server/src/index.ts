import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createApp } from './app';

const here = path.dirname(fileURLToPath(import.meta.url));
const staticDir = path.resolve(here, '../../web/dist');

const portEnv = process.env.PORT;
const port = portEnv === undefined || portEnv === '' ? 10000 : Number(portEnv);

const { server } = createApp({ staticDir });

server.listen(port, '0.0.0.0', () => {
  const address = server.address();
  const actualPort = typeof address === 'object' && address !== null ? address.port : port;
  console.log(`listening on ${actualPort}`);
});
