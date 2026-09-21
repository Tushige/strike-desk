import type { Company } from './cast';
import { NAME_MARK, PRODUCT_MARK, SITUATIONS, SOURCES } from './newsPool';
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
export { NAME_MARK, PRODUCT_MARK, SITUATIONS, SOURCES } from './newsPool';
export type { Situation } from './newsPool';

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
export const writeHeadlines: WriteHeadlines = (slots, cast, rng) => {
  const usedInGame = new Set<number>();
  const usedByCompany = new Map<number, Set<number>>();

  return slots.map((slot) => {
    const company = cast[slot.companyId];
    if (company === undefined) throw new Error(`headline ${slot.id} names company ${slot.companyId}, which is not in the cast`);
    const hadAlready = usedByCompany.get(slot.companyId) ?? new Set<number>();
    usedByCompany.set(slot.companyId, hadAlready);

    const sources = SOURCES[slot.trust];
    const source = sources[rng.nextInt(sources.length)] ?? '';

    const ofDirection = SITUATIONS.flatMap((situation, index) => (situation.direction === slot.direction ? [index] : []));
    const newToGame = ofDirection.filter((index) => !usedInGame.has(index));
    const newToCompany = ofDirection.filter((index) => !hadAlready.has(index));
    // Slots that break the market's rules can run a company out of situations. A repeat is kinder than a game that will not start.
    const open = newToGame.length > 0 ? newToGame : newToCompany.length > 0 ? newToCompany : ofDirection;
    const picked = open[rng.nextInt(open.length)] ?? 0;
    usedInGame.add(picked);
    hadAlready.add(picked);

    const situation = SITUATIONS[picked];
    return {
      source,
      title: fillIn(situation?.title ?? '', company),
      body: fillIn(situation?.body ?? '', company),
    };
  });
};
