import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CONTENT_VERSION } from '../src/market';
import { CAST } from '../src/cast';
import { EVENTS, SOURCES, SITUATIONS } from '../src/news';
import type { NewsPool } from '../src/news';

function digest(pool: NewsPool): string {
  return createHash('sha256').update(JSON.stringify({
    sources: { 3: [...pool.sources[3]], 2: [...pool.sources[2]], 1: [...pool.sources[1]] },
    events: pool.events.map((event) => ({
      id: event.id, direction: event.direction, kinds: [...event.kinds],
      wordings: event.kinds.map((kind) => ({ kind, variants: event.wordings[kind]?.map(({ title, body }) => ({ title, body })) })),
    })),
  })).digest('hex');
}

const PINNED = { content: 'c3', digest: '3221bb475bdab91b95db5b9a8e631f00902defee7cb873c5b631c0313e50b753' };
const RE_PIN = 'News content changed: bump CONTENT_VERSION and re-pin its digest together with the recording and sheet in one content revision.';

describe('news content identity', () => {
  it('supplies full-game variety and five-event capacity for every company kind and direction', () => {
    expect(EVENTS.length).toBeGreaterThanOrEqual(25);
    expect(EVENTS.length).toBeLessThanOrEqual(30);
    const situations = EVENTS.reduce((count, event) => count + CAST.filter((company) => event.kinds.includes(company.kind)).length, 0);
    expect(situations).toBeGreaterThanOrEqual(60);
    expect(situations).toBeLessThanOrEqual(100);
    for (const trust of [3, 2, 1] as const) {
      expect(SOURCES[trust].length).toBeGreaterThanOrEqual(4);
      expect(SOURCES[trust].length).toBeLessThanOrEqual(5);
    }
    for (const event of EVENTS) for (const kind of event.kinds) {
      const variants = event.wordings[kind];
      expect(variants?.length, `${event.id}/${kind}`).toBeGreaterThanOrEqual(2);
      expect(variants?.length, `${event.id}/${kind}`).toBeLessThanOrEqual(3);
    }
    for (const kind of new Set(CAST.map((company) => company.kind))) for (const direction of ['up', 'down']) {
      expect(EVENTS.filter((event) => event.direction === direction && event.kinds.includes(kind)).length,
        `${kind}/${direction}`).toBeGreaterThanOrEqual(5);
    }
  });

  it('pins every source and event variant to its content version', () => {
    expect(CONTENT_VERSION, RE_PIN).toBe(PINNED.content);
    expect(digest({ sources: SOURCES, events: EVENTS }), RE_PIN).toBe(PINNED.digest);
  });

  it('keeps the display projection equal to all unique authoritative wordings', () => {
    const unique = new Map(EVENTS.flatMap((event) => event.kinds.flatMap((kind) =>
      (event.wordings[kind] ?? []).map(({ title, body }) => {
        const row = { direction: event.direction, title, body };
        return [JSON.stringify(row), row] as const;
      }))));
    expect(SITUATIONS).toEqual([...unique.values()]);
  });

  const neutral = {
    sources: { 3: ['Official A', 'Official B'], 2: ['Worker'], 1: ['Online'] },
    events: [{ id: 'order', direction: 'up' as const, kinds: ['toys' as const, 'drinks' as const], wordings: {
      toys: [{ title: '{name} order', body: 'First batch.' }, { title: '{name} order', body: 'Next batch.' }],
      drinks: [{ title: '{name} sale', body: 'Drink batch.' }],
    } }, { id: 'delay', direction: 'down' as const, kinds: ['toys' as const], wordings: { toys: [{ title: '{name} delay', body: 'Late batch.' }] } }],
  };
  it.each(['title', 'body', 'source', 'compatibility', 'event order', 'source order', 'variant order', 'variant', 'id', 'direction', 'kind order'])(
    'changes the digest after a %s edit', (change) => {
      const revised = structuredClone(neutral);
      const event = revised.events[0];
      if (event === undefined) throw new Error('missing fixture');
      const variant = event.wordings.toys[0];
      if (variant === undefined) throw new Error('missing fixture');
      if (change === 'title') variant.title += ' more';
      if (change === 'body') variant.body += ' More.';
      if (change === 'source') revised.sources[3][0] = 'Company voice';
      if (change === 'compatibility') event.kinds.pop();
      if (change === 'event order') revised.events.reverse();
      if (change === 'source order') revised.sources[3].reverse();
      if (change === 'variant order') event.wordings.toys.reverse();
      if (change === 'variant') event.wordings.toys.push({ title: '{name} order', body: 'Another batch.' });
      if (change === 'id') event.id = 'other-order';
      if (change === 'direction') event.direction = 'down';
      if (change === 'kind order') event.kinds.reverse();
      expect(digest(revised)).not.toBe(digest(neutral));
    },
  );
});
