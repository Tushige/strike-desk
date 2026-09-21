import { describe, expect, it, vi } from 'vitest';
import { CAST } from '../src/cast';
import { CONTENT_VERSION, ENGINE_VERSION, buildMarket } from '../src/market';
import type { HeadlineSlot } from '../src/news';
import { SITUATIONS, SOURCES, writeHeadlines } from '../src/news';
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

describe('the draws of the headline writer', () => {
  it('makes exactly two draws a slot: 30 numbers write a whole game, 29 do not', () => {
    const slots = slotsOfGame(7);

    expect(slots).toHaveLength(15);
    expect(writeHeadlines(slots, CAST, scriptedRng(script(30)))).toHaveLength(15);
    expect(() => writeHeadlines(slots, CAST, scriptedRng(script(29)))).toThrow('the script ran out of numbers');
  });

  it('writes the first slot of game 7 from the first phrase and the first situation when every draw is zero', () => {
    const first = slotsOfGame(7)[0];

    // Game 7 opens with Fizzly, solid news, claiming bad news.
    expect(first).toEqual({ id: 0, day: 1, companyId: 1, trust: 3, direction: 'down' });
    expect(CAST[1]?.name).toBe('Fizzly');
    expect(CAST[1]?.product).toBe('fizzy drinks');

    // 0 of any count is 0, floor 0: the first source phrase of solid news, then the first bad-news situation.
    expect(writeHeadlines(slotsOfGame(7), CAST, scriptedRng(script(30)))[0]).toEqual({
      source: 'The company itself says',
      title: 'Fizzly runs low on supplies',
      body: 'Something needed to make fizzy drinks is hard to get, so fewer can be made this month.',
    });
  });

  it('spends the first draw on the source and the second on the situation', () => {
    // 0.99 then 0. Three wild-rumor phrases: 0.99 of 3 is 2.97, floor 2, the third phrase.
    // Six good-news situations: 0 of 6 is 0, floor 0, the first one. Were the draws the other way
    // round, this would be the first phrase and the last situation.
    const [words] = writeHeadlines([slot({ trust: 1, direction: 'up' })], CAST, scriptedRng([0.99, 0]));

    expect(words).toEqual({
      source: 'A friend of a friend says',
      title: 'RoboPup sells out everywhere',
      body: 'Shops cannot keep robot pets on the shelves. More are being made right now.',
    });
  });

  it('picks the phrase and the situation the two draws point at', () => {
    // Three could-be-true phrases: 0.5 of 3 is 1.5, floor 1, the second phrase.
    // Six bad-news situations: 0.5 of 6 is 3, floor 3, the fourth one.
    const [words] = writeHeadlines([slot({ trust: 2, direction: 'down', companyId: 5 })], CAST, scriptedRng([0.5, 0.5]));

    expect(words).toEqual({
      source: 'A worker at the company says',
      title: 'Low scores pile up for ZapCharge',
      body: 'People who tried its newest super batteries are giving them low scores.',
    });
  });
});

describe('the choice of a situation', () => {
  it('uses no situation twice in a game while one of its direction is still unused', () => {
    // Six good-news slots on six companies, every draw zero: each takes the first situation still unused.
    const slots = [0, 1, 2, 3, 4, 5].map((companyId, id) => slot({ id, day: id < 3 ? 1 : 2, companyId, trust: 1, direction: 'up' }));

    const titles = writeHeadlines(slots, CAST, scriptedRng(script(12))).map((words) => words.title);

    expect(titles).toEqual([
      'RoboPup sells out everywhere',
      'Fizzly wins a big award',
      'JetKicks video goes viral',
      'Giant order lands at MoonMunch',
      'PixelPals opens a huge new factory',
      'A famous star loves ZapCharge',
    ]);
  });

  it('falls back to a situation this company has not had, once the game has used them all', () => {
    // Seven good-news slots and six good-news situations. The seventh slot is JetKicks again, which had
    // the third situation; every draw is zero, so it takes the first one it has not had itself.
    const companies = [0, 1, 2, 3, 4, 5, 2];
    const slots = companies.map((companyId, id) => slot({ id, day: id < 3 ? 1 : id < 6 ? 2 : 3, companyId, trust: 1, direction: 'up' }));

    const titles = writeHeadlines(slots, CAST, scriptedRng(script(14))).map((words) => words.title);

    expect(titles[2]).toBe('JetKicks video goes viral');
    expect(titles[6]).toBe('JetKicks sells out everywhere');
    expect(new Set(titles).size).toBe(7);
  });

  it('refuses a slot whose company is not in the cast', () => {
    expect(() => writeHeadlines([slot({ trust: 3, direction: 'up', companyId: 6 })], CAST, scriptedRng([0, 0]))).toThrow(
      'headline 0 names company 6, which is not in the cast',
    );
  });
});

/** The twelve titles as written in the pool, good news first. Typed in, so a changed title is a changed test. */
const TITLES = [
  '{name} sells out everywhere',
  '{name} wins a big award',
  '{name} video goes viral',
  'Giant order lands at {name}',
  '{name} opens a huge new factory',
  'A famous star loves {name}',
  '{name} runs low on supplies',
  '{name} calls back a batch',
  'A new rival takes on {name}',
  'Low scores pile up for {name}',
  '{name} delays its big launch',
  'Factory trouble at {name}',
];

/** Words that would tell a player how a claim ends. */
const GIVE_AWAY_WORDS = ['true', 'false', 'confirmed', 'debunked', 'fake', 'hoax', 'turns out', 'proven'];

/** Plain letters, digits, spaces and ordinary punctuation: so no emoji, and no marker left behind. */
const PLAIN_TEXT = /^[A-Za-z0-9 .,'!?:;-]+$/;

/**
 * Every situation written out for every company, through the writer itself:
 * one slot, and a second draw that points at the situation. Six situations a
 * direction, so the draw for place `i` is (i + 0.5) / 6: times 6 that is
 * i + 0.5, floor i.
 */
function everyHeadlineWrittenOut(): { company: string; title: string; body: string }[] {
  return CAST.flatMap((company) =>
    (['up', 'down'] as const).flatMap((direction) =>
      [0, 1, 2, 3, 4, 5].map((place) => {
        const [words] = writeHeadlines([slot({ trust: 3, direction, companyId: company.id })], CAST, scriptedRng([0, (place + 0.5) / 6]));
        return { company: company.name, title: words?.title ?? '', body: words?.body ?? '' };
      }),
    ),
  );
}

describe('the starter pool', () => {
  it('holds 12 situations, 6 that claim good news and 6 that claim bad, and 3 source phrases for each trust level', () => {
    // The floor is 5 a direction: a company has at most one headline a day, so at most 5 in a game of
    // five days, and a company must always be left a situation it has not had. 6 keeps one in hand.
    expect(SITUATIONS).toHaveLength(12);
    expect(SITUATIONS.filter((situation) => situation.direction === 'up')).toHaveLength(6);
    expect(SITUATIONS.filter((situation) => situation.direction === 'down')).toHaveLength(6);
    expect(SOURCES[3]).toHaveLength(3);
    expect(SOURCES[2]).toHaveLength(3);
    expect(SOURCES[1]).toHaveLength(3);
  });

  it('carries the twelve titles word for word, and every one has a place for the company', () => {
    expect(SITUATIONS.map((situation) => situation.title)).toEqual(TITLES);
    for (const title of TITLES) expect(title).toContain('{name}');
  });

  it('leaves no marked place unfilled, for any of the six companies', () => {
    const written = everyHeadlineWrittenOut();

    // 6 companies, 12 situations each.
    expect(written).toHaveLength(72);
    expect(new Set(written.map((one) => one.title)).size).toBe(72);
    for (const one of written) {
      expect(one.title).toContain(one.company);
      expect(`${one.title} ${one.body}`).not.toMatch(/[{}]/);
    }
  });

  it('shares no title between two situations and no source phrase between two trust levels', () => {
    const phrases = [...SOURCES[3], ...SOURCES[2], ...SOURCES[1]];

    expect(new Set(SITUATIONS.map((situation) => situation.title)).size).toBe(12);
    expect(phrases).toHaveLength(9);
    expect(new Set(phrases).size).toBe(9);
  });

  it('is plain text that fits its card: titles 60 characters, bodies 140, sources 40', () => {
    for (const one of everyHeadlineWrittenOut()) {
      expect(one.title, one.title).toMatch(PLAIN_TEXT);
      expect(one.body, one.body).toMatch(PLAIN_TEXT);
      expect(one.title.length, one.title).toBeLessThanOrEqual(60);
      expect(one.body.length, one.body).toBeLessThanOrEqual(140);
    }
    for (const phrase of [...SOURCES[3], ...SOURCES[2], ...SOURCES[1]]) {
      expect(phrase, phrase).toMatch(PLAIN_TEXT);
      expect(phrase.length, phrase).toBeLessThanOrEqual(40);
    }
  });

  it('never says how a claim ends, and never spells the word the recorded game refuses', () => {
    const texts = [
      ...SOURCES[3],
      ...SOURCES[2],
      ...SOURCES[1],
      ...everyHeadlineWrittenOut().flatMap((one) => [one.title, one.body]),
    ].map((text) => text.toLowerCase());

    for (const text of texts) {
      for (const word of GIVE_AWAY_WORDS) expect(text.includes(word), `"${text}" holds "${word}"`).toBe(false);
      // The recorded game is searched for these four letters in a row, in any case, and these words land in it.
      expect(text, text).not.toMatch(/seed/);
    }
  });

  it('is varied enough: 200 games use at least 10 of the 12 situations and all 9 phrases, and games 0 and 1 read differently', () => {
    const names = CAST.map((company) => company.name);
    const situationsUsed = new Set<string>();
    const phrasesUsed = new Set<string>();
    const titlesOf: string[][] = [];

    for (let game = 0; game < 200; game += 1) {
      const words = writeHeadlines(slotsOfGame(game), CAST, wordingStream(game));
      titlesOf.push(words.map((entry) => entry.title));
      for (const entry of words) {
        phrasesUsed.add(entry.source);
        // Back to the title as the pool writes it: the company's name out, its place back in.
        const name = names.find((candidate) => entry.title.includes(candidate)) ?? '';
        situationsUsed.add(entry.title.split(name).join('{name}'));
      }
    }

    for (const used of situationsUsed) expect(TITLES).toContain(used);
    expect(situationsUsed.size).toBeGreaterThanOrEqual(10);
    expect(phrasesUsed.size).toBe(9);
    expect(titlesOf[0]).not.toEqual(titlesOf[1]);
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
    const fresh = ['RoboPup sells out everywhere', 'Fizzly wins a big award'];

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

    expect(first[6]?.title).toBe('Giant order lands at JetKicks');
    expect(again[6]?.title).toBe('Giant order lands at JetKicks');
  });
});
