import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CONTENT_VERSION } from '../src/market';
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

const PINNED = { content: 'c2', digest: 'b63f117cb6d6126e2edd41c0b5932bc812d9e612635188decb34d0c558facf72' };
const RE_PIN = 'News content changed: bump CONTENT_VERSION and re-pin its digest together with the recording and sheet in one content revision.';

describe('news content identity', () => {
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
