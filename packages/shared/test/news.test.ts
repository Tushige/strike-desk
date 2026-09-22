import { describe, expect, it, vi } from 'vitest';
import { CAST } from '../src/cast';
import { CONTENT_VERSION, ENGINE_VERSION, buildMarket } from '../src/market';
import type { HeadlineSlot, NewsPool } from '../src/news';
import { EVENTS, SOURCES, createHeadlineWriter, writeHeadlines } from '../src/news';
import { scriptedRng, slotsOfGame, wordingStream } from './contracts/headlineWriter.contract';

/**
 * Everything the market hands the writer, written down as it goes by. The
 * writer itself is untouched: every call is passed straight on to it, so the
 * cases below still drive the real one. This is how a test can see what
 * crosses from the market, which knows every outcome, to the writer, which
 * must know none.
 */
const handedOver = vi.hoisted(() => ({ calls: [] as unknown[][] }));

vi.mock('../src/news', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/news')>();
  const recorded: typeof real.writeHeadlines = (...args) => {
    handedOver.calls.push(args);
    return real.writeHeadlines(...args);
  };
  return { ...real, writeHeadlines: recorded };
});

/**
 * The headline writer, driven by a scripted stream: the test says which
 * numbers the stream gives, and so knows which words must come out. Every
 * expected word here is typed in by hand, never read back from the pool.
 */

/** A script of the same number, `count` times. */
function script(count: number, value = 0): number[] {
  return Array.from({ length: count }, () => value);
}

/** One slot, so a case can say only the part it is about. */
function slot(fields: Partial<HeadlineSlot> & Pick<HeadlineSlot, 'trust' | 'direction'>): HeadlineSlot {
  return { id: 0, day: 1, companyId: 0, ...fields };
}

const CANDIDATE: NewsPool = {
  sources: { 3: ['Official A', 'Official B'], 2: ['Worker A'], 1: ['Online A'] },
  events: [
    { id: 'drink-only', direction: 'up', kinds: ['drinks'], wordings: { drinks: [{ title: '{name} drinks', body: 'More drinks.' }] } },
    { id: 'order', direction: 'up', kinds: ['toys', 'drinks'], wordings: {
      toys: [{ title: '{name} order', body: 'More {product} ordered.' }, { title: '{name} order', body: 'Extra {product} ordered.' }],
      drinks: [{ title: '{name} bottles', body: 'More bottles ordered.' }],
    } },
    { id: 'delivery', direction: 'up', kinds: ['toys', 'drinks'], wordings: {
      toys: [{ title: '{name} delivery', body: 'Delivery A.' }, { title: '{name} delivery', body: 'Delivery B.' }, { title: '{name} delivery', body: 'Delivery C.' }],
      drinks: [{ title: '{name} cans', body: 'More cans delivered.' }],
    } },
    { id: 'delay', direction: 'down', kinds: ['toys'], wordings: { toys: [{ title: '{name} delay', body: 'Fewer toys delivered.' }] } },
  ],
};

describe('a pool-bound headline writer', () => {
  it('uses source then event and fractional variant draws for the supplied company kind', () => {
    const write = createHeadlineWriter(CANDIDATE);
    // Two fitting events: .375 * 2 = .75 selects the first event, then wording 2 of 2.
    expect(write([slot({ trust: 3, direction: 'up' })], CAST, scriptedRng([0.99, 0.375]))).toEqual([
      { source: 'Official B', title: 'RoboPup order', body: 'Extra robot pets ordered.' },
    ]);
    // .95 * 2 = 1.9 selects the second event, then wording 3 of 3.
    expect(write([slot({ trust: 3, direction: 'up' })], CAST, scriptedRng([0, 0.95]))).toEqual([
      { source: 'Official A', title: 'RoboPup delivery', body: 'Delivery C.' },
    ]);
  });

  it('uses supplied ids, names and products rather than a fixed six-company position', () => {
    const original = CAST[0];
    if (original === undefined) throw new Error('missing test company');
    const cast = [{ ...original, id: 42, name: 'Acme', product: 'test toys' }];
    expect(createHeadlineWriter(CANDIDATE)([slot({ companyId: 42, trust: 2, direction: 'up' })], cast, scriptedRng([0, 0]))).toEqual([
      { source: 'Worker A', title: 'Acme order', body: 'More test toys ordered.' },
    ]);
  });

  it('prefers globally unused events, then unused event/company pairs regardless of source or variant', () => {
    const write = createHeadlineWriter(CANDIDATE);
    const slots = [0, 1, 1, 1].map((companyId, id) => slot({ companyId, id, trust: 3, direction: 'up' }));
    // order used by toys; drinks choose drink-only, then delivery, then order (new to drinks).
    expect(write(slots, CAST, scriptedRng([0, 0, 0, 0, 0, 0, 0.9, 0.9])).map((words) => words.title)).toEqual([
      'RoboPup order', 'Fizzly drinks', 'Fizzly cans', 'Fizzly bottles',
    ]);
    const repeated = [0, 0, 0].map((companyId, id) => slot({ companyId, id, trust: 3, direction: 'up' }));
    expect(() => write(repeated, CAST, scriptedRng([0, 0, 0.9, 0.9, 0, 0]))).toThrow('no unused up event');
  });

  it('refuses missing company or direction capacity instead of emitting blank or incompatible words', () => {
    const write = createHeadlineWriter(CANDIDATE);
    expect(() => write([slot({ companyId: 99, trust: 1, direction: 'up' })], CAST, scriptedRng([0, 0]))).toThrow('not in the cast');
    expect(() => write([slot({ companyId: 1, trust: 1, direction: 'down' })], CAST, scriptedRng([0, 0]))).toThrow('no unused down event');
  });

  it('rejects empty and malformed pool data before writing', () => {
    expect(() => createHeadlineWriter({ ...CANDIDATE, events: [] })).toThrow('needs events');
    expect(() => createHeadlineWriter({ ...CANDIDATE, sources: { ...CANDIDATE.sources, 1: [] } })).toThrow('needs sources');
    const event = CANDIDATE.events[0];
    if (event === undefined) throw new Error('missing event');
    expect(() => createHeadlineWriter({ ...CANDIDATE, events: [event, event] })).toThrow('duplicate event');
    expect(() => createHeadlineWriter({ ...CANDIDATE, events: [{ ...event, wordings: {} }] })).toThrow('missing wordings');
    expect(() => createHeadlineWriter({ ...CANDIDATE, events: [{ ...event, wordings: { drinks: [{ title: ' ', body: 'Text.' }] } }] })).toThrow('empty');
  });

  it('does not mutate caller data or retain selection history between calls', () => {
    const pool = structuredClone(CANDIDATE);
    const slots = [slot({ trust: 3, direction: 'up' })];
    const cast = structuredClone(CAST);
    const before = JSON.stringify({ pool, slots, cast });
    const write = createHeadlineWriter(pool);
    expect(write(slots, cast, scriptedRng([0, 0]))).toEqual(write(slots, cast, scriptedRng([0, 0])));
    expect(JSON.stringify({ pool, slots, cast })).toBe(before);
  });

  it('makes exactly two draws per slot in a whole game', () => {
    const slots = slotsOfGame(7);
    expect(slots).toHaveLength(15);
    expect(writeHeadlines(slots, CAST, scriptedRng(script(30)))).toHaveLength(15);
    expect(() => writeHeadlines(slots, CAST, scriptedRng(script(29)))).toThrow('the script ran out of numbers');
  });
});

describe('committed wording constraints', () => {
  it('renders every kind variant as short plain text without giveaway words or substitution markers', () => {
    for (const company of CAST) {
      for (const direction of ['up', 'down'] as const) {
        const events = EVENTS.filter((event) => event.direction === direction && event.kinds.includes(company.kind));
        expect(events.length).toBeGreaterThanOrEqual(5);
        events.forEach((event, index) => {
          const variants = event.wordings[company.kind] ?? [];
          expect(variants.length).toBeGreaterThan(0);
          variants.forEach((_, variant) => {
            const [words] = writeHeadlines([slot({ companyId: company.id, direction, trust: 3 })], CAST,
              scriptedRng([0, (index + (variant + 0.5) / variants.length) / events.length]));
            expect(words?.title).toContain(company.name);
            for (const [value, limit] of [[words?.title, 60], [words?.body, 140]] as const) {
              expect(value).toMatch(/^[A-Za-z0-9 .,'!?:;-]+$/);
              expect(value?.length).toBeLessThanOrEqual(limit);
              expect(value).not.toMatch(/\b(true|false|confirmed|debunked|fake|hoax|turns out|proven)\b|seed/i);
            }
          });
        });
      }
    }
    const phrases = [...SOURCES[3], ...SOURCES[2], ...SOURCES[1]];
    expect(new Set(phrases).size).toBe(phrases.length);
    for (const phrase of phrases) {
      expect(phrase).toMatch(/^[A-Za-z0-9 .,'!?:;-]+$/);
      expect(phrase.length).toBeLessThanOrEqual(40);
      expect(phrase).not.toMatch(/\b(true|false|confirmed|debunked|fake|hoax|turns out|proven)\b|seed/i);
    }
  });
});

/**
 * The repository is public, so anyone can read the pool and the writer. What
 * they must not be able to do is read a later day off the words of an earlier
 * one, or an outcome off any word at all.
 */
describe('what the words cannot give away', () => {
  /** How many entries belong to days 1 to d: three headlines a day. */
  const ENTRIES_UP_TO_DAY = { 1: 3, 2: 6, 3: 9, 4: 12 } as const;

  it('no wording depends on a later day: days 1 to d read the same whatever the later days hold', () => {
    for (let game = 0; game < 200; game += 1) {
      const own = slotsOfGame(game);
      const other = slotsOfGame(game + 1);
      const unchanged = writeHeadlines(own, CAST, wordingStream(game));

      for (const day of [1, 2, 3, 4] as const) {
        const kept = ENTRIES_UP_TO_DAY[day];
        // This game's days 1 to d, then another game's later days, numbered 0 to 14 as ever.
        const swapped = [...own.slice(0, kept), ...other.slice(kept)].map((entry, id) => ({ ...entry, id }));
        expect(swapped).toHaveLength(15);
        expect(swapped.slice(kept)).not.toEqual(own.slice(kept));

        const words = writeHeadlines(swapped, CAST, wordingStream(game));

        expect(words.slice(0, kept), `game ${game}, days 1 to ${day}`).toEqual(unchanged.slice(0, kept));
      }
    }
  });

  it('a slot holds nothing hidden: id, day, companyId, trust and direction, and that is all', () => {
    // The type, first. A field added to `HeadlineSlot` is a typecheck error on this line until it is named here...
    const named: Record<keyof HeadlineSlot, true> = { companyId: true, day: true, direction: true, id: true, trust: true };
    // ...and then this list, typed in, no longer matches.
    expect(Object.keys(named).sort()).toEqual(['companyId', 'day', 'direction', 'id', 'trust']);

    expect(Object.keys(slotsOfGame(7)[0] ?? {}).sort()).toEqual(['companyId', 'day', 'direction', 'id', 'trust']);
  });

  it('the market hands the writer public slots, the cast and a stream, and nothing else', () => {
    handedOver.calls.length = 0;

    buildMarket({ seed: 7, engine: ENGINE_VERSION, content: CONTENT_VERSION });

    // One call for the whole game, with three things in it.
    expect(handedOver.calls).toHaveLength(1);
    const call = handedOver.calls[0] ?? [];
    expect(call).toHaveLength(3);
    const [slots, cast, rng] = call as [Record<string, unknown>[], unknown, Record<string, unknown>];

    expect(slots).toHaveLength(15);
    for (const entry of slots) {
      expect(Object.keys(entry).sort()).toEqual(['companyId', 'day', 'direction', 'id', 'trust']);
      // Plain values only: nothing to reach a hidden thing through.
      for (const value of Object.values(entry)) expect(['number', 'string']).toContain(typeof value);
    }
    expect(cast).toBe(CAST);
    // The stream is five functions and no number: the market's own number is not on it to be read.
    expect(Object.keys(rng).sort()).toEqual(['nextFloat', 'nextInt', 'nextNormal', 'nextU32', 'pick']);
    for (const value of Object.values(rng)) expect(typeof value).toBe('function');
  });

  it('the same slots and stream give the same words whatever was written before: nothing is remembered between calls', () => {
    // Two good-news slots, every draw zero: the first situation, then the first one the game has not used.
    // A writer that remembered an earlier game would think those two were taken and give something else.
    const slots = [slot({ id: 0, companyId: 0, trust: 3, direction: 'up' }), slot({ id: 1, companyId: 1, trust: 2, direction: 'up' })];
    const fresh = writeHeadlines(slots, CAST, scriptedRng(script(4))).map((words) => words.title);

    // Whole games are written before and in between, so there is plenty to remember.
    writeHeadlines(slotsOfGame(3), CAST, wordingStream(3));
    const first = writeHeadlines(slots, CAST, scriptedRng(script(4)));
    writeHeadlines(slotsOfGame(4), CAST, wordingStream(4));
    const again = writeHeadlines(slots, CAST, scriptedRng(script(4)));

    expect(first.map((words) => words.title)).toEqual(fresh);
    expect(again.map((words) => words.title)).toEqual(fresh);
  });

  it('remembers nothing about a company between calls either, where a game has used every situation', () => {
    // Seven good-news slots, six situations: the seventh, JetKicks again, picks among the five it has
    // not had (it had the third). Every draw is zero but the last: 0.45 of 5 is 2.25, floor 2, the third
    // of those five, which is the fourth situation. A writer that remembered JetKicks from an earlier
    // game would be picking from another list: with nothing left, from all six, where 0.45 of 6 is
    // 2.7, floor 2, the third situation, "JetKicks video goes viral".
    const companies = [0, 1, 2, 3, 4, 5, 2];
    const slots = companies.map((companyId, id) => slot({ id, day: id < 3 ? 1 : id < 6 ? 2 : 3, companyId, trust: 1, direction: 'up' }));
    const draws = [...script(13), 0.45];

    writeHeadlines(slotsOfGame(3), CAST, wordingStream(3));
    const first = writeHeadlines(slots, CAST, scriptedRng(draws));
    writeHeadlines(slotsOfGame(4), CAST, wordingStream(4));
    const again = writeHeadlines(slots, CAST, scriptedRng(draws));

    expect(first).toEqual(again);
  });
});
