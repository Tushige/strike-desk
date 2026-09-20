import {
  buildMarket,
  marketCodeToSeed,
  seedToMarketCode,
  sharePriceCents,
  ENGINE_VERSION,
  CONTENT_VERSION,
  DAYS,
  OPEN_STEPS,
} from '@strike-desk/shared/engine';
import { drawSeed } from '../src/seed';

/**
 * Prints a whole market's share prices, so that "the same market number gives
 * the same market" can be checked by eye and by CI.
 *
 * Run it with a market number to print that market; run it with nothing to
 * draw a fresh one. It starts no server, opens no socket and reads no running
 * game: the only thing it knows is the number it is given.
 *
 * The output is plain text and nothing but the market goes into it — no time,
 * no file path, no machine detail — so two runs of the same market number can
 * be compared byte for byte.
 */

/** Every 50th price of the open market: 11 rows a day, from the open to the bell. */
const PRINT_EVERY = 50;

const USAGE = 'usage: prices [--market <market number>]';

interface Options {
  code: string | null;
}

/** Reads the command line, or returns a message saying why it could not be read. */
function readOptions(args: readonly string[]): Options | string {
  if (args.length === 0) return { code: null };
  if (args.length === 2 && args[0] === '--market') {
    const code = args[1] ?? '';
    if (marketCodeToSeed(code) === null) return `not a market number: ${code}`;
    return { code };
  }
  return USAGE;
}

/** A price as dollars and cents, from the one rounding function. */
function dollars(price: number): string {
  return (sharePriceCents(price) / 100).toFixed(2);
}

function row(cells: readonly string[]): string {
  const [day, index, ...prices] = cells;
  return [(day ?? '').padStart(3), (index ?? '').padStart(6), ...prices.map((cell) => cell.padStart(9))].join(' ');
}

function main(): number {
  const options = readOptions(process.argv.slice(2));
  if (typeof options === 'string') {
    process.stderr.write(`${options}\n`);
    return 2;
  }

  const seed = options.code === null ? drawSeed() : (marketCodeToSeed(options.code) ?? 0);
  const market = buildMarket({ seed, engine: ENGINE_VERSION, content: CONTENT_VERSION });
  const tickers = market.cast.map((company) => company.ticker);

  const lines = [
    `market ${seedToMarketCode(seed)} engine ${ENGINE_VERSION} content ${CONTENT_VERSION}`,
    row(['day', 'index', ...tickers]),
  ];
  for (let day = 1; day <= DAYS; day += 1) {
    const paths = market.days[day - 1]?.paths ?? [];
    for (let index = 0; index <= OPEN_STEPS; index += PRINT_EVERY) {
      const prices = market.cast.map((company) => dollars(paths[company.id]?.[index] ?? 0));
      lines.push(row([String(day), String(index), ...prices]));
    }
  }
  process.stdout.write(`${lines.join('\n')}\n`);
  return 0;
}

process.exitCode = main();
