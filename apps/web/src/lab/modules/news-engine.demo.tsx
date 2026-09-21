import sheetText from './news-engine.sheet.json?raw';

/**
 * The news engine, shown as something to read. This page runs no game code:
 * the headlines were written on the server side by
 * `apps/server/scripts/news-sheet.ts` and committed as the sheet beside this
 * file, and the page only lays them out.
 */

type Trust = 1 | 2 | 3;

export interface SheetHeadline {
  day: number;
  company: string;
  trust: Trust;
  direction: 'up' | 'down';
  source: string;
  title: string;
  body: string;
}

export interface SheetGame {
  label: string;
  headlines: readonly SheetHeadline[];
}

export interface NewsSheet {
  games: readonly SheetGame[];
}

/** The trust levels in the game's own words. */
const TRUST_WORDS: Record<Trust, string> = { 3: 'Solid news', 2: 'Could be true', 1: 'Wild rumor' };

const DAYS = [1, 2, 3, 4, 5];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isHeadline(value: unknown): value is SheetHeadline {
  if (!isRecord(value)) return false;
  const { day, company, trust, direction, source, title, body } = value;
  return (
    typeof day === 'number' &&
    typeof company === 'string' &&
    (trust === 1 || trust === 2 || trust === 3) &&
    (direction === 'up' || direction === 'down') &&
    typeof source === 'string' &&
    typeof title === 'string' &&
    typeof body === 'string'
  );
}

function isGame(value: unknown): value is SheetGame {
  return isRecord(value) && typeof value.label === 'string' && Array.isArray(value.headlines) && value.headlines.every(isHeadline);
}

/** The sheet, its outer shape checked by hand; `null` when it is not a sheet. */
export function readSheet(text: string): NewsSheet | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(raw) || !Array.isArray(raw.games) || !raw.games.every(isGame)) return null;
  return { games: raw.games };
}

function HeadlineCard({ headline }: { headline: SheetHeadline }) {
  return (
    <li className="rounded-md border border-border bg-card p-3">
      <p className="text-xs text-muted-foreground">
        <span className="font-semibold text-gold">{TRUST_WORDS[headline.trust]}</span>
        {' · '}
        {headline.source}
      </p>
      <p className="mt-1 text-sm font-semibold text-card-foreground">{headline.title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{headline.body}</p>
    </li>
  );
}

function GameDays({ game }: { game: SheetGame }) {
  return (
    <section aria-label={game.label}>
      <h3 className="text-base font-semibold text-foreground">{game.label}</h3>
      {DAYS.map((day) => (
        <div className="mt-4" key={day}>
          <h4 className="text-xs font-semibold text-muted-foreground">Day {day}</h4>
          <ul className="mt-2 grid list-none gap-2 p-0 md:grid-cols-3">
            {game.headlines
              .filter((headline) => headline.day === day)
              .map((headline) => (
                <HeadlineCard headline={headline} key={`${headline.day}-${headline.trust}`} />
              ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

/** The part that draws: it is handed the sheet, so it can be shown any sheet. */
export function NewsSheetView({ sheet }: { sheet: NewsSheet | null }) {
  const first = sheet?.games[0];
  return (
    <div className="mt-6 text-foreground" id="lab-demo-news-engine">
      {first === undefined ? <p className="text-sm text-muted-foreground">The news sheet could not be read.</p> : <GameDays game={first} />}
    </div>
  );
}

export default function NewsEngineDemo() {
  return <NewsSheetView sheet={readSheet(sheetText)} />;
}
