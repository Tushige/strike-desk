import { describe, expect, it } from 'vitest';
import { CAST } from '../src/cast';
import type { HeadlineSlot } from '../src/news';
import { writeHeadlines } from '../src/news';
import { describeHeadlineWriterContract, referenceWriter, scriptedRng, slotsOfGame, wordingStream } from './contracts/headlineWriter.contract';
import { testMarket } from './helpers';

describeHeadlineWriterContract('the reference writer', referenceWriter, { games: 200 });

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

describe('the stand-in wording', () => {
  const slot = (fields: Pick<HeadlineSlot, 'trust' | 'direction'>): HeadlineSlot => ({ id: 0, day: 1, companyId: 0, ...fields });
  // The stand-in draws nothing, so a stream with nothing in it is enough.
  const write = (slots: HeadlineSlot[]) => writeHeadlines(slots, CAST, scriptedRng([]));

  it('is pinned word for word', () => {
    expect(CAST[0]?.name).toBe('RoboPup');

    expect(write([slot({ trust: 3, direction: 'up' })])).toEqual([
      { source: 'Company statement', title: 'Good news for RoboPup?', body: 'RoboPup may be about to have a very good day.' },
    ]);
    expect(write([slot({ trust: 2, direction: 'down' })])).toEqual([
      { source: 'A store manager says', title: 'Trouble at RoboPup?', body: 'RoboPup may be about to have a very bad day.' },
    ]);
    expect(write([slot({ trust: 1, direction: 'up' })])[0]?.source).toBe('Someone online says');
  });

  it('answers every slot, in order', () => {
    const slots = slotsOfGame(7);

    const words = write(slots);

    expect(words).toHaveLength(15);
    words.forEach((entry, index) => {
      expect(entry).toEqual(write([slots[index] ?? slot({ trust: 1, direction: 'up' })])[0]);
    });
  });

  it('is only a stand-in: its titles can repeat within a game, which the writer contract forbids', () => {
    const repeats = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].filter((seed) => {
      const titles = writeHeadlines(slotsOfGame(seed), CAST, wordingStream(seed)).map((entry) => entry.title);
      return new Set(titles).size < titles.length;
    });

    expect(repeats.length).toBeGreaterThan(0);
  });
});

describe('the market writes its headlines through the writer', () => {
  it('gives every headline exactly the words the stand-in gives for its slot', () => {
    const market = testMarket();
    const headlines = market.days.flatMap((day) => day.news.map((item) => item.headline));

    expect(headlines).toHaveLength(15);
    for (const headline of headlines) {
      const { source, title, body, ...asSlot } = headline;
      expect({ source, title, body }).toEqual(writeHeadlines([asSlot], market.cast, scriptedRng([]))[0]);
    }
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
