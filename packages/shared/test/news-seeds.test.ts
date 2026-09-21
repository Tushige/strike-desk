import assert from 'node:assert/strict';
import { expect, it } from 'vitest';
import { CAST } from '../src/cast';
import { NAME_MARK, PRODUCT_MARK, SITUATIONS, SOURCES, writeHeadlines } from '../src/news';
import type { HeadlineSlot, WriteHeadlines } from '../src/news';
import { createStream } from '../src/rng';

/** Legal public inputs only: no market construction or price paths. */
function slotsFor(seed: number): HeadlineSlot[] {
  const random = createStream(seed, 'newsPick');
  const slots: HeadlineSlot[] = [];
  for (let day = 1; day <= 5; day += 1) {
    const remaining = CAST.map((company) => company.id);
    for (const trust of [3, 2, 1] as const) {
      const [companyId] = remaining.splice(random.nextInt(remaining.length), 1);
      assert.ok(companyId !== undefined);
      slots.push({ id: slots.length, day, companyId, trust, direction: random.nextInt(2) === 0 ? 'up' : 'down' });
    }
  }
  return slots;
}

const renderedPool = CAST.map((company) => SITUATIONS.map((event, index) => {
  const expand = (text: string): string => text.replaceAll(NAME_MARK, company.name).replaceAll(PRODUCT_MARK, company.product);
  return { index, direction: event.direction, title: expand(event.title), body: expand(event.body) };
}));

function checkGame(seed: number, writer: WriteHeadlines): number {
  const slots = slotsFor(seed);
  const words = writer(slots, CAST, createStream(seed, 'newsWording'));
  const label = `seed ${seed}`;
  // Five days × three headlines = fifteen public slots and written stories.
  assert.equal(slots.length, 15, label);
  assert.equal(words.length, 15, label);
  assert.equal(new Set(slots.map((slot) => slot.day)).size, 5, label);
  for (let day = 1; day <= 5; day += 1) {
    const today = slots.filter((slot) => slot.day === day);
    assert.equal(today.length, 3, label);
    assert.equal(new Set(today.map((slot) => slot.companyId)).size, 3, label);
    assert.deepEqual(today.map((slot) => slot.trust).sort(), [1, 2, 3], label);
  }
  const pairs = new Set<string>();
  for (const company of CAST) {
    assert.ok(slots.filter((slot) => slot.companyId === company.id).length <= 5, label);
    for (const direction of ['up', 'down']) {
      assert.ok((renderedPool[company.id]?.filter((event) => event.direction === direction).length ?? 0) >= 5,
        `${label}: five-day capacity for company ${company.id}, ${direction}`);
    }
  }
  words.forEach((word, index) => {
    const slot = slots[index];
    assert.ok(slot, label);
    for (const text of [word.source, word.title, word.body]) {
      assert.ok(text.trim().length > 0, `${label}: nonempty words`);
    }
    assert.deepEqual(([1, 2, 3] as const).filter((trust) => SOURCES[trust].includes(word.source)), [slot.trust], `${label}: source trust`);
    const pool = renderedPool[slot.companyId] ?? [];
    const matches = pool.filter((event) => event.title === word.title && event.body === word.body);
    assert.equal(matches.length, 1, `${label}: exactly one event fits the company`);
    const event = matches[0];
    assert.ok(event, label);
    assert.equal(event.direction, slot.direction, `${label}: event direction`);
    // The accepted company-specific set must still offer a fitting unused
    // event even after the game's globally unused set runs out.
    assert.ok(pool.some((candidate) => candidate.direction === slot.direction && !pairs.has(`${slot.companyId}:${candidate.index}`)),
      `${label}: unused fitting event remains`);
    const pair = `${slot.companyId}:${event.index}`;
    assert.ok(!pairs.has(pair), `${label}: repeated event-company pair`);
    pairs.add(pair);
  });
  assert.equal(pairs.size, 15, `${label}: fifteen unique situations`);
  assert.equal(new Set(words.map((word) => word.title)).size, 15, `${label}: titles never repeat`);

  // Neither unrelated calls nor cosmetic draws may influence reproduction.
  writeHeadlines(slotsFor(seed + 1), CAST, createStream(seed + 1, 'newsWording'));
  const cosmetics = createStream(seed, 'cosmetics');
  for (let draw = 0; draw < 30; draw += 1) cosmetics.nextU32();
  assert.deepEqual(writer(slots, CAST, createStream(seed, 'newsWording')), words, `${label}: repeatable words`);
  return words.length;
}

const repeated: WriteHeadlines = (slots, cast, random) => {
  const words = writeHeadlines(slots, cast, random);
  for (const [index, slot] of slots.entries()) {
    const earlier = slots.findIndex((candidate, at) => at < index && candidate.companyId === slot.companyId && candidate.direction === slot.direction);
    const previous = words[earlier];
    const current = words[index];
    if (previous !== undefined && current !== undefined) {
      words[index] = { ...previous, source: current.source };
      break;
    }
  }
  return words;
};
const wrongSource: WriteHeadlines = (...args) => {
  const words = writeHeadlines(...args);
  const first = words[0];
  if (first !== undefined) first.source = SOURCES[1][0] ?? '';
  return words;
};

it('rejects a writer that repeats earlier output', () => {
  expect(() => checkGame(0, repeated)).toThrow(/repeated event-company pair/);
});

it('rejects a writer that assigns a source from the wrong trust level', () => {
  expect(() => checkGame(0, wrongSource)).toThrow(/source trust/);
});

const writerUnderTest: WriteHeadlines = writeHeadlines;
let gamesChecked = 0;
let headlinesChecked = 0;
it.each([0, 1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000])('checks 1000 legal games beginning at seed %i', (first) => {
  let count = 0;
  for (let seed = first; seed < first + 1000; seed += 1) {
    count += checkGame(seed, writerUnderTest);
    gamesChecked += 1;
  }
  // 1,000 games × 15 headlines = 15,000 headlines in each diagnostic block.
  expect(count).toBe(15000);
  headlinesChecked += count;
});

it('completes all 10000 games and 150000 headlines', () => {
  // Ten blocks × 1,000 games × 15 headlines = 150,000 checked headlines.
  expect(gamesChecked).toBe(10000);
  expect(headlinesChecked).toBe(150000);
});
