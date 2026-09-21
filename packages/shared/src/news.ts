import type { Company } from './cast';
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

/**
 * The stand-in writer, until the reviewed headline pool replaces it. It
 * draws nothing. Its titles can repeat within a game, so it does not pass
 * the writer's contract; the pool that replaces it must.
 */
export const writeHeadlines: WriteHeadlines = (slots, cast) =>
  slots.map((slot) => {
    const name = cast[slot.companyId]?.name ?? '';
    const up = slot.direction === 'up';
    return {
      source: slot.trust === 3 ? 'Company statement' : slot.trust === 2 ? 'A store manager says' : 'Someone online says',
      title: up ? `Good news for ${name}?` : `Trouble at ${name}?`,
      body: up ? `${name} may be about to have a very good day.` : `${name} may be about to have a very bad day.`,
    };
  });
