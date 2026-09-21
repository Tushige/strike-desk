import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildMarket, CONTENT_VERSION, ENGINE_VERSION, SITUATIONS, SOURCES } from '@strike-desk/shared/engine';

/**
 * Writes the news sheet: every string of the headline pool, and the fifteen
 * headlines of three sample games, for the lab's news page to show. The page
 * runs no game code; it reads this file.
 *
 * Run it from anywhere in the repository:
 *
 *   pnpm --filter @strike-desk/server exec tsx scripts/news-sheet.ts
 *
 * It writes apps/web/src/lab/modules/news-engine.sheet.json. Run it again
 * after the pool or the writer changes: a test compares the committed file
 * with what `buildSheet` gives today, and fails when they differ.
 *
 * Only what a player may read from the start of a day goes in: the day, the
 * company, the trust level, what the headline claims, and its words. Whether
 * a claim holds, the moment its news lands, the number a market is made from
 * and every price stay out, and so do the time and the machine, so two runs
 * give the same bytes. The three sample markets are fixed ones that no live
 * game uses: live games draw theirs from the operating system's random
 * source.
 */

const SAMPLE_GAMES = [
  { label: 'Game A', market: 1101 },
  { label: 'Game B', market: 2203 },
  { label: 'Game C', market: 3303 },
] as const;

const OUTPUT = fileURLToPath(new URL('../../web/src/lab/modules/news-engine.sheet.json', import.meta.url));

export interface SheetHeadline {
  day: number;
  /** The company's name. */
  company: string;
  trust: 1 | 2 | 3;
  direction: 'up' | 'down';
  source: string;
  title: string;
  body: string;
}

export interface Sheet {
  recordedWith: { content: string };
  pool: {
    /** The source phrases, by trust level. */
    sources: { 3: string[]; 2: string[]; 1: string[] };
    /** Every situation, as written in the pool: the marked places are not filled in. */
    situations: { direction: 'up' | 'down'; title: string; body: string }[];
  };
  games: { label: string; headlines: SheetHeadline[] }[];
}

export function buildSheet(): Sheet {
  return {
    recordedWith: { content: CONTENT_VERSION },
    pool: {
      sources: { 3: [...SOURCES[3]], 2: [...SOURCES[2]], 1: [...SOURCES[1]] },
      situations: SITUATIONS.map(({ direction, title, body }) => ({ direction, title, body })),
    },
    games: SAMPLE_GAMES.map(({ label, market: number }) => {
      const market = buildMarket({ seed: number, engine: ENGINE_VERSION, content: CONTENT_VERSION });
      const headlines = market.days.flatMap((day) =>
        day.news.map(({ headline }): SheetHeadline => {
          const company = market.cast[headline.companyId];
          if (company === undefined) throw new Error(`headline ${headline.id} names a company that is not in the cast`);
          return {
            day: headline.day,
            company: company.name,
            trust: headline.trust,
            direction: headline.direction,
            source: headline.source,
            title: headline.title,
            body: headline.body,
          };
        }),
      );
      return { label, headlines };
    }),
  };
}

/** The sheet as the file holds it: indented, so a changed string is a one-line diff. */
export function renderSheet(sheet: Sheet): string {
  return `${JSON.stringify(sheet, null, 2)}\n`;
}

// Written only when this file is the one being run, never when a test imports it.
if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  writeFileSync(OUTPUT, renderSheet(buildSheet()));
  process.stdout.write(`wrote the news sheet: ${SAMPLE_GAMES.length} games\n`);
}
