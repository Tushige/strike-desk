import type { Company } from './cast';
import { EVENTS, NAME_MARK, PRODUCT_MARK, SOURCES } from './newsPool';
import type { NewsPool } from './newsPool';
import type { Trust } from './pricing';
import type { Side } from './protocol';
import type { Rng } from './rng';

/**
 * The words of the news: one function from what the market has already
 * decided about every headline of a game to what each one says.
 */

/**
 * What the market has decided about one headline before a word is written:
 * which day, which company, how far the source can be trusted, and what the
 * headline claims.
 *
 * Missing on purpose: whether the claim is true, the moment the news lands
 * in the price, and the seed, the number the whole market is made from. A
 * writer that is never handed them cannot leak them, however it is written.
 */
export interface HeadlineSlot {
  /** 0 to 14, unique in the game. */
  id: number;
  /** 1 to 5. */
  day: number;
  /** Index into the cast. */
  companyId: number;
  trust: Trust;
  /** What the headline claims: `'up'` for good news, `'down'` for bad. */
  direction: Side;
}

/** What one headline says. */
export interface HeadlineWords {
  /** Who is speaking. It belongs to one trust level and to no other. */
  source: string;
  title: string;
  body: string;
}

/**
 * Words for every headline of one game. The rules any writer obeys:
 *
 * - One entry per slot, in slot order.
 * - It draws only from `rng`. That stream is the game's wording stream and
 *   nobody else's, so the same slots, cast and stream always give the same
 *   words, and no draw made here can move a price or an outcome.
 * - The source phrase belongs to the slot's trust level and to no other.
 * - No title repeats within one game. A title may name its company, so a
 *   pool of about a dozen situations is enough to start with.
 * - It chooses constructively and never throws for slots that follow the
 *   market's rules: three a day, one per trust level, about three different
 *   companies.
 */
export type WriteHeadlines = (slots: readonly HeadlineSlot[], cast: readonly Company[], rng: Rng) => HeadlineWords[];

// The pool is listed through this file, so that a script on the server can
// show every string of it beside the games it writes.
export { EVENTS, NAME_MARK, PRODUCT_MARK, SITUATIONS, SOURCES } from './newsPool';
export type { EventType, HeadlineText, NewsPool, Situation } from './newsPool';

/** A text of the pool with the company's name and what it makes filled in. */
function fillIn(text: string, company: Company): string {
  return text.split(NAME_MARK).join(company.name).split(PRODUCT_MARK).join(company.product);
}

/**
 * The writer: a headline is a source phrase and a situation from the pool in
 * `newsPool.ts`, put together by the game's wording stream.
 *
 * It goes through the slots in order and makes exactly two draws for each,
 * whatever it finds: the first picks the source phrase among those of the
 * slot's trust level, the second picks the situation. So the words of a day
 * depend on that day's slots, on the days before it and on nothing after it:
 * no headline can give away what a later day holds.
 *
 * The situation is picked among those of the slot's direction that this game
 * has not used yet. When the game has used them all, it is picked among those
 * this company has not had: a title names its company, so it still cannot
 * repeat. A company has at most one headline a day, five in a game, and the
 * pool holds at least five situations for each direction, so that second
 * list is never empty for slots that follow the market's rules.
 *
 * It reads the slots, the cast and the stream, and nothing else: no clock, no
 * global, and nothing remembered from one call to the next.
 */
export function createHeadlineWriter(pool: NewsPool): WriteHeadlines {
  if (pool.events.length === 0) throw new Error('news pool needs events');
  const ids = new Set<string>();
  const sourcesSeen = new Set<string>();
  for (const trust of [3, 2, 1] as const) {
    if (pool.sources[trust].length === 0) throw new Error(`news pool needs sources for trust ${trust}`);
    for (const source of pool.sources[trust]) {
      if (!source.trim() || source !== source.trim() || sourcesSeen.has(source)) throw new Error(`invalid or duplicate source: ${source}`);
      sourcesSeen.add(source);
    }
  }
  for (const event of pool.events) {
    if (!event.id.trim() || ids.has(event.id)) throw new Error(`invalid or duplicate event id: ${event.id}`);
    ids.add(event.id);
    if (event.direction !== 'up' && event.direction !== 'down') throw new Error(`invalid direction for event ${event.id}`);
    if (event.kinds.length === 0 || new Set(event.kinds).size !== event.kinds.length) throw new Error(`invalid kinds for event ${event.id}`);
    if (Object.keys(event.wordings).some((kind) => !event.kinds.some((declared) => declared === kind))) throw new Error(`orphan wording for event ${event.id}`);
    for (const kind of event.kinds) {
      const wordings = event.wordings[kind];
      if (wordings === undefined || wordings.length === 0) throw new Error(`missing wordings for event ${event.id}/${kind}`);
      for (const { title, body } of wordings) {
        if (!title.trim() || !body.trim() || title !== title.trim() || body !== body.trim()) throw new Error(`empty or untrimmed wording for event ${event.id}/${kind}`);
      }
    }
  }
  return (slots, cast, rng) => {
    const usedInGame = new Set<string>();
    const usedByCompany = new Map<number, Set<string>>();

    return slots.map((slot) => {
      const company = cast.find((entry) => entry.id === slot.companyId);
      if (company === undefined) throw new Error(`headline ${slot.id} names company ${slot.companyId}, which is not in the cast`);
      const hadAlready = usedByCompany.get(slot.companyId) ?? new Set<string>();
      usedByCompany.set(slot.companyId, hadAlready);

      const sources = pool.sources[slot.trust];
      const source = sources[rng.nextInt(sources.length)];
      if (source === undefined) throw new Error(`missing source for trust ${slot.trust}`);

      const compatible = pool.events.filter((event) => event.direction === slot.direction && event.kinds.includes(company.kind));
      const newToGame = compatible.filter((event) => !usedInGame.has(event.id));
      const open = newToGame.length > 0 ? newToGame : compatible.filter((event) => !hadAlready.has(event.id));
      if (open.length === 0) throw new Error(`no unused ${slot.direction} event for company ${company.id} (${company.kind})`);
      const selection = rng.nextFloat() * open.length;
      const index = Math.floor(selection);
      const picked = open[index];
      if (picked === undefined) throw new Error('event draw must be in [0, 1)');
      usedInGame.add(picked.id);
      hadAlready.add(picked.id);

      const variants = picked.wordings[company.kind];
      const situation = variants?.[Math.floor((selection - index) * variants.length)];
      if (situation === undefined) throw new Error(`missing wording for event ${picked.id}/${company.kind}`);
      return {
        source,
        title: fillIn(situation.title, company),
        body: fillIn(situation.body, company),
      };
    });
  };
}

export const writeHeadlines: WriteHeadlines = createHeadlineWriter({ sources: SOURCES, events: EVENTS });
