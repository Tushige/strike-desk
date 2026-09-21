import { describe, expect, it } from 'vitest';
import { CAST } from '../src/cast';
import type { HeadlineSlot } from '../src/news';
import { writeHeadlines } from '../src/news';
import { scriptedRng, slotsOfGame } from './contracts/headlineWriter.contract';

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
    // 0.99 then 0. Were the first draw spent on the situation, 0.99 would pick the last good-news one.
    // It is spent on the source instead, and 0 of the situations is 0, floor 0: the first good-news situation.
    const [words] = writeHeadlines([slot({ trust: 1, direction: 'up' })], CAST, scriptedRng([0.99, 0]));

    expect(words?.title).toBe('RoboPup sells out everywhere');
    expect(words?.body).toBe('Shops cannot keep robot pets on the shelves. More are being made right now.');
  });

  it('picks the situation the second draw points at', () => {
    // Five bad-news situations: 0.5 of 5 is 2.5, floor 2, the third one.
    const [words] = writeHeadlines([slot({ trust: 2, direction: 'down', companyId: 5 })], CAST, scriptedRng([0, 0.5]));

    expect(words).toEqual({
      source: 'A store manager says',
      title: 'A new rival takes on ZapCharge',
      body: 'Another company has started selling its own super batteries at a lower price.',
    });
  });
});

describe('the choice of a situation', () => {
  it('uses no situation twice in a game while one of its direction is still unused', () => {
    // Five good-news slots on five companies, every draw zero: each takes the first situation still unused.
    const slots = [0, 1, 2, 3, 4].map((companyId, id) => slot({ id, companyId, trust: 1, direction: 'up' }));

    const titles = writeHeadlines(slots, CAST, scriptedRng(script(10))).map((words) => words.title);

    expect(titles).toEqual([
      'RoboPup sells out everywhere',
      'Fizzly wins a big award',
      'JetKicks video goes viral',
      'Giant order lands at MoonMunch',
      'PixelPals opens a huge new factory',
    ]);
  });

  it('falls back to a situation this company has not had, once the game has used them all', () => {
    // Six good-news slots and five good-news situations. The sixth slot is JetKicks again, which had
    // the third situation; every draw is zero, so it takes the first one it has not had itself.
    const companies = [0, 1, 2, 3, 4, 2];
    const slots = companies.map((companyId, id) => slot({ id, day: id < 3 ? 1 : 2, companyId, trust: 1, direction: 'up' }));

    const titles = writeHeadlines(slots, CAST, scriptedRng(script(12))).map((words) => words.title);

    expect(titles[2]).toBe('JetKicks video goes viral');
    expect(titles[5]).toBe('JetKicks sells out everywhere');
    expect(new Set(titles).size).toBe(6);
  });

  it('refuses a slot whose company is not in the cast', () => {
    expect(() => writeHeadlines([slot({ trust: 3, direction: 'up', companyId: 6 })], CAST, scriptedRng([0, 0]))).toThrow(
      'headline 0 names company 6, which is not in the cast',
    );
  });
});
