import type { CompanyBoard, Trust } from '@strike-desk/shared/engine';
import {
  boardFor,
  buildMarket,
  centsToDollars,
  contractId,
  expectedMove,
  isTradable,
  marketCodeToSeed,
  marketDay,
  quoteAt,
  seedToMarketCode,
  sharePriceCents,
  CONTENT_VERSION,
  DAYS,
  ENGINE_VERSION,
  OPEN_STEPS,
} from '@strike-desk/shared/engine';
import { drawSeed } from '../src/seed';

/**
 * Prints one day of a market: the six share paths through the open market,
 * and the whole contract board priced at the opening bell, with Close, Far
 * and Moonshot marked on the targets a simple choice buys.
 *
 * Run it with a market number and a day to print that day; run it with
 * nothing to draw a fresh market and print its first day. It starts no
 * server, opens no socket and reads no running game: the only thing it knows
 * is the number it is given.
 *
 * It prints what is public at the start of the day — the opening price, the
 * expected move and how much the day's headline is worth believing — and
 * never the hidden outcome or the moment it lands.
 *
 * The output is plain text and nothing but the market goes into it — no time,
 * no file path, no machine detail — so two runs of the same market number and
 * day can be compared byte for byte.
 */

/** Every 50th price of the open market: 11 rows, from the open to the bell. */
const PRINT_EVERY = 50;

const USAGE = 'usage: day [--market <market number>] [--day <1 to 5>]';

/** The three simple choices, in the order `SIMPLE_CHOICES` holds them. */
const CHOICE_WORDS = ['Close', 'Far', 'Moonshot'] as const;
const CHOICES = [0, 1, 2] as const;

/** How much the day's headline is worth believing. Public from the start of the day. */
const HEADLINE_STATE: Record<Trust, string> = { 3: 'solid', 2: 'could be true', 1: 'rumor' };
const NO_HEADLINE = 'quiet';

interface Options {
  code: string | null;
  day: number;
}

/** Reads the command line, or returns a message saying why it could not be read. */
function readOptions(args: readonly string[]): Options | string {
  let code: string | null = null;
  let day = 1;
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i];
    const value = args[i + 1];
    if (value === undefined) return USAGE;
    if (flag === '--market') {
      if (marketCodeToSeed(value) === null) return `not a market number: ${value}`;
      code = value;
    } else if (flag === '--day') {
      const asked = Number(value);
      if (!Number.isInteger(asked) || asked < 1 || asked > DAYS) return `not a day of this game: ${value}`;
      day = asked;
    } else {
      return USAGE;
    }
  }
  return { code, day };
}

/** A whole-cent amount as dollars and cents. */
function centsText(cents: number): string {
  return centsToDollars(cents).toFixed(2);
}

/** A share price, through the one rounding function for share money. */
function dollars(price: number): string {
  return centsText(sharePriceCents(price));
}

/** A ticket price in whole dollars, or a dash when it is too cheap to trade. */
function ticket(priceCents: number | null): string {
  if (priceCents === null || !isTradable(priceCents)) return '-';
  return String(priceCents / 100);
}

function priceRow(cells: readonly string[]): string {
  const [index, ...prices] = cells;
  return [(index ?? '').padStart(6), ...prices.map((cell) => cell.padStart(9))].join(' ');
}

/** Target index to the words naming the simple choices that land on it. */
function choiceMarks(companyBoard: CompanyBoard): Map<number, string[]> {
  const marks = new Map<number, string[]>();
  const add = (targetIndex: number, word: string): void => {
    const held = marks.get(targetIndex);
    if (held === undefined) marks.set(targetIndex, [word]);
    else held.push(word);
  };
  CHOICES.forEach((choice) => {
    add(companyBoard.simpleUp[choice], `${CHOICE_WORDS[choice]} UP`);
    add(companyBoard.simpleDown[choice], `${CHOICE_WORDS[choice]} DOWN`);
  });
  return marks;
}

function main(): number {
  const options = readOptions(process.argv.slice(2));
  if (typeof options === 'string') {
    process.stderr.write(`${options}\n`);
    return 2;
  }

  const seed = options.code === null ? drawSeed() : (marketCodeToSeed(options.code) ?? 0);
  const market = buildMarket({ seed, engine: ENGINE_VERSION, content: CONTENT_VERSION });
  const day = options.day;
  const data = marketDay(market, day);
  const board = boardFor(market, day);

  const lines = [
    `market ${seedToMarketCode(seed)} engine ${ENGINE_VERSION} content ${CONTENT_VERSION} day ${day}`,
    'prices',
    priceRow(['index', ...market.cast.map((company) => company.ticker)]),
  ];
  for (let index = 0; index <= OPEN_STEPS; index += PRINT_EVERY) {
    const prices = market.cast.map((company) => dollars(data.paths[company.id]?.[index] ?? 0));
    lines.push(priceRow([String(index), ...prices]));
  }

  lines.push('board');
  const indexWidth = String(board.targetsPerCompany - 1).length;
  for (const company of market.cast) {
    const companyBoard = board.companies[company.id];
    if (companyBoard === undefined) continue;
    const headline = data.news.find((item) => item.headline.companyId === company.id);
    const state = headline === undefined ? NO_HEADLINE : HEADLINE_STATE[headline.headline.trust];
    const openPrice = data.paths[company.id]?.[0] ?? company.startPrice;
    const move = (expectedMove(data, company.id) * 100).toFixed(2);
    lines.push(`${company.ticker} open ${dollars(openPrice)} move ${move}% ${state}`);

    const marks = choiceMarks(companyBoard);
    companyBoard.targets.forEach((targetCents, targetIndex) => {
      const idFor = (side: 'up' | 'down'): number => contractId(board.targetsPerCompany, { companyId: company.id, targetIndex, side });
      const up = quoteAt(market, day, 0, board, idFor('up'));
      const down = quoteAt(market, day, 0, board, idFor('down'));
      lines.push(
        [
          String(targetIndex).padStart(indexWidth),
          centsText(targetCents).padStart(9),
          ticket(up === null ? null : up.priceCents).padStart(7),
          ticket(down === null ? null : down.priceCents).padStart(7),
          ...(marks.get(targetIndex) ?? []),
        ].join(' '),
      );
    });
  }

  process.stdout.write(`${lines.join('\n')}\n`);
  return 0;
}

process.exitCode = main();
