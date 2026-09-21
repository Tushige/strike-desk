import { useState } from 'react';
import sheetText from './news-engine.sheet.json?raw';

/**
 * The news engine, shown as something to read. This page runs no game code:
 * the headlines were written on the server side by
 * `apps/server/scripts/news-sheet.ts` and committed as the sheet beside this
 * file, and the page only lays them out.
 *
 * Two parts. The pool first: every source phrase by trust level and every
 * situation by what it claims, as written, so that every string a player
 * could ever read is in one place. Then three sample games, five days of
 * three headlines each, to see how the pool reads once a game's own stream
 * has put it together.
 */

type Trust = 1 | 2 | 3;
type Direction = 'up' | 'down';

export interface SheetSituation {
  direction: Direction;
  title: string;
  body: string;
}

export interface SheetHeadline {
  day: number;
  company: string;
  trust: Trust;
  direction: Direction;
  source: string;
  title: string;
  body: string;
}

export interface SheetGame {
  label: string;
  headlines: readonly SheetHeadline[];
}

export interface NewsSheet {
  pool: {
    sources: Record<Trust, readonly string[]>;
    situations: readonly SheetSituation[];
  };
  games: readonly SheetGame[];
}

/** The trust levels, most trusted first, in the game's own words. */
const TRUST_LEVELS: readonly { trust: Trust; words: string; who: string }[] = [
  { trust: 3, words: 'Solid news', who: 'the company itself' },
  { trust: 2, words: 'Could be true', who: 'someone close to it' },
  { trust: 1, words: 'Wild rumor', who: 'someone online' },
];

const DIRECTIONS: readonly { direction: Direction; words: string; tone: string }[] = [
  { direction: 'up', words: 'Claims good news', tone: 'text-up' },
  { direction: 'down', words: 'Claims bad news', tone: 'text-down' },
];

const DAYS = [1, 2, 3, 4, 5];

function trustWords(trust: Trust): string {
  return TRUST_LEVELS.find((level) => level.trust === trust)?.words ?? '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTexts(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((text) => typeof text === 'string');
}

function isDirection(value: unknown): value is Direction {
  return value === 'up' || value === 'down';
}

function isSituation(value: unknown): value is SheetSituation {
  return isRecord(value) && isDirection(value.direction) && typeof value.title === 'string' && typeof value.body === 'string';
}

function isHeadline(value: unknown): value is SheetHeadline {
  if (!isRecord(value)) return false;
  const { day, company, trust, direction, source, title, body } = value;
  return (
    typeof day === 'number' &&
    typeof company === 'string' &&
    (trust === 1 || trust === 2 || trust === 3) &&
    isDirection(direction) &&
    typeof source === 'string' &&
    typeof title === 'string' &&
    typeof body === 'string'
  );
}

function isGame(value: unknown): value is SheetGame {
  return isRecord(value) && typeof value.label === 'string' && Array.isArray(value.headlines) && value.headlines.every(isHeadline);
}

/** The sheet, its shape checked by hand; `null` when it is not a sheet. Anything else in the file is left behind. */
export function readSheet(text: string): NewsSheet | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(raw) || !isRecord(raw.pool) || !Array.isArray(raw.games)) return null;
  const { sources, situations } = raw.pool;
  if (!isRecord(sources) || !Array.isArray(situations) || !situations.every(isSituation)) return null;
  const solid = sources['3'];
  const couldBe = sources['2'];
  const rumor = sources['1'];
  if (!isTexts(solid) || !isTexts(couldBe) || !isTexts(rumor)) return null;
  if (raw.games.length === 0 || !raw.games.every(isGame)) return null;

  return {
    pool: { sources: { 3: solid, 2: couldBe, 1: rumor }, situations },
    games: raw.games.map((game) => ({ label: game.label, headlines: game.headlines })),
  };
}

const SECTION_HEAD = 'text-base font-semibold text-foreground';
const SMALL_HEAD = 'text-xs font-semibold text-muted-foreground';
const CARD = 'rounded-md border border-border bg-card p-3';
const PLAIN_LIST = 'mt-2 grid list-none gap-2 p-0';

function PoolSources({ sources }: { sources: NewsSheet['pool']['sources'] }) {
  return (
    <section aria-labelledby="news-pool-sources" className="mt-6">
      <h3 className={SECTION_HEAD} id="news-pool-sources">
        Who is speaking
      </h3>
      <p className="mt-1 text-sm text-muted-foreground">The speaker sets the trust level. A phrase belongs to one level and to no other.</p>
      <div className="mt-3 grid gap-3 md:grid-cols-3">
        {TRUST_LEVELS.map((level) => (
          <div className={CARD} key={level.trust}>
            <h4 className="text-sm font-semibold text-gold">{level.words}</h4>
            <p className="text-xs text-muted-foreground">{level.who}</p>
            <ul className={PLAIN_LIST}>
              {sources[level.trust].map((phrase) => (
                <li className="text-sm text-card-foreground" key={phrase}>
                  {phrase}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

function PoolSituations({ situations }: { situations: readonly SheetSituation[] }) {
  return (
    <section aria-labelledby="news-pool-situations" className="mt-8">
      <h3 className={SECTION_HEAD} id="news-pool-situations">
        What is said to have happened
      </h3>
      <p className="mt-1 text-sm text-muted-foreground">
        As written in the pool: the company&apos;s name and what it makes are filled in when a headline is put together. Any situation can arrive from any speaker.
      </p>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        {DIRECTIONS.map((side) => (
          <div key={side.direction}>
            <h4 className={`text-sm font-semibold ${side.tone}`}>{side.words}</h4>
            <ul className={PLAIN_LIST}>
              {situations
                .filter((situation) => situation.direction === side.direction)
                .map((situation) => (
                  <li className={CARD} key={situation.title}>
                    <p className="text-sm font-semibold text-card-foreground">{situation.title}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{situation.body}</p>
                  </li>
                ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

function HeadlineCard({ headline }: { headline: SheetHeadline }) {
  return (
    <li className={CARD}>
      <p className="text-xs text-muted-foreground">
        <span className="font-semibold text-gold">{trustWords(headline.trust)}</span>
        {' · '}
        <span className="font-semibold text-card-foreground">{headline.company}</span>
      </p>
      <p className="mt-2 text-xs text-muted-foreground">{headline.source}</p>
      <p className="text-sm font-semibold text-card-foreground">{headline.title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{headline.body}</p>
    </li>
  );
}

function GameDays({ game }: { game: SheetGame }) {
  return (
    <div>
      {DAYS.map((day) => {
        const today = game.headlines.filter((headline) => headline.day === day);
        if (today.length === 0) return null;
        return (
          <div className="mt-4" key={day}>
            <h4 className={SMALL_HEAD}>Day {day}</h4>
            <ul className={`${PLAIN_LIST} md:grid-cols-3`}>
              {today.map((headline) => (
                <HeadlineCard headline={headline} key={`${headline.day}-${headline.trust}`} />
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

function SampleGames({ games, initialGame }: { games: readonly SheetGame[]; initialGame: number }) {
  const [shown, setShown] = useState(initialGame);
  const game = games[shown] ?? games[0];

  return (
    <section aria-labelledby="news-sample-games" className="mt-8">
      <h3 className={SECTION_HEAD} id="news-sample-games">
        Sample games
      </h3>
      <p className="mt-1 text-sm text-muted-foreground">Five days of three headlines, one of each trust level, as three different games put the pool together.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {games.map((one, index) => (
          <button
            aria-pressed={index === shown}
            className={`rounded-md border px-3 py-1 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${
              index === shown ? 'border-ring bg-accent text-accent-foreground' : 'border-border bg-card text-muted-foreground hover:text-card-foreground'
            }`}
            key={one.label}
            onClick={() => setShown(index)}
            type="button"
          >
            {one.label}
          </button>
        ))}
      </div>
      {game === undefined ? null : <GameDays game={game} />}
    </section>
  );
}

/** The part that draws: it is handed the sheet, so it can be shown any sheet. */
export function NewsSheetView({ sheet, initialGame = 0 }: { sheet: NewsSheet | null; initialGame?: number }) {
  return (
    <div className="mt-6 min-w-0 text-foreground" id="lab-demo-news-engine">
      {sheet === null ? (
        <p className="text-sm text-muted-foreground">The news sheet could not be read.</p>
      ) : (
        <>
          <p className="max-w-prose text-sm text-muted-foreground">
            Every string of the headline pool, then three sample games. This page runs no game code: the headlines were written ahead of time by a script on the
            server side and saved as a file, and the page only lays that file out. It holds what a player may read at the start of a day, and nothing about how a
            claim ends.
          </p>
          <PoolSources sources={sheet.pool.sources} />
          <PoolSituations situations={sheet.pool.situations} />
          <SampleGames games={sheet.games} initialGame={initialGame} />
        </>
      )}
    </div>
  );
}

export default function NewsEngineDemo() {
  return <NewsSheetView sheet={readSheet(sheetText)} />;
}
