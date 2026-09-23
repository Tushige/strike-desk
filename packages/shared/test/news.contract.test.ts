import { describe, expect, it } from 'vitest';
import { writeHeadlines } from '../src/news';
import { describeHeadlineWriterContract, referenceWriter, scriptedRng, slotsOfGame, wordingStream } from './contracts/headlineWriter.contract';
import { TEST_SEED, testMarket } from './helpers';

describeHeadlineWriterContract('the reference writer', referenceWriter, { games: 200 });

// The real writer, at the contract's own count of games.
describeHeadlineWriterContract('the starter pool', writeHeadlines);

describe('the scripted random stream', () => {
  it('says exactly what the script says, then runs out', () => {
    const rng = scriptedRng([0, 0.5, 0.999]);

    expect(rng.nextInt(4)).toBe(0);
    expect(rng.nextInt(4)).toBe(2);
    expect(rng.nextInt(4)).toBe(3);
    expect(() => rng.nextInt(4)).toThrow('the script ran out of numbers');
  });

  it('picks from a list by the same rule, and has no normal draw to give', () => {
    const rng = scriptedRng([0.5, 0.25]);

    expect(rng.pick(['a', 'b', 'c', 'd'])).toBe('c');
    expect(rng.nextU32()).toBe(1073741824);
    expect(() => rng.nextNormal()).toThrow('a headline writer has no use for a normal draw');
  });
});

describe('the market writes its headlines through the writer', () => {
  it('gives its fifteen headlines exactly the words the writer gives for its fifteen slots and its wording stream', () => {
    const market = testMarket();
    const headlines = market.days.flatMap((day) => day.news.map((item) => item.headline));
    const slots = headlines.map(({ id, day, companyId, trust, direction }) => ({ id, day, companyId, trust, direction }));

    const words = writeHeadlines(slots, market.cast, wordingStream(TEST_SEED));

    expect(headlines).toHaveLength(15);
    expect(headlines.map(({ eventId, source, title, body }) => ({ eventId, source, title, body }))).toEqual(words);
    // The test market opens with Fizzly: real words, with the company's name filled in.
    expect(headlines[0]?.companyId).toBe(1);
    expect(headlines[0]?.title).toContain('Fizzly');
  });

  it('numbers the slots 0 to 14, three a day, one per trust level, about three different companies', () => {
    const slots = slotsOfGame(7);

    expect(slots.map((entry) => entry.id)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    for (let day = 1; day <= 5; day += 1) {
      const today = slots.filter((entry) => entry.day === day);
      expect(today.map((entry) => entry.trust)).toEqual([3, 2, 1]);
      expect(new Set(today.map((entry) => entry.companyId)).size).toBe(3);
    }
  });
});
