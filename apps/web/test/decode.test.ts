import { describe, expect, it } from 'vitest';
import { decode } from '../src/feed/decode';
import { testFrame } from './fakeSocket';

/**
 * Nothing arriving on a socket may be trusted, and nothing arriving on a
 * socket may take the page down. `decode` answers "this is a message the
 * contract names" or nothing at all, and never throws.
 */

describe('decode', () => {
  const refused: Array<[string, unknown]> = [
    ['an empty string', ''],
    ['half an object', '{'],
    ['the text null', 'null'],
    ['an array', '[]'],
    ['a number, not a string', 42],
    ['an object, not a string', { t: 'frame' }],
    ['a Blob-like value', new Uint8Array([1, 2, 3])],
    ['undefined', undefined],
    ['an unknown kind', JSON.stringify({ t: 'somethingElse', session: 's-1' })],
    ['a frame missing fields', JSON.stringify({ t: 'frame', session: 's-1', rev: 0, step: 0 })],
    ['a frame with a negative rev', JSON.stringify(testFrame({ rev: -1 }))],
    ['a frame whose prices are not numbers', JSON.stringify({ ...testFrame(), prices: ['8400'] })],
    ['the placeholder tick', JSON.stringify({ type: 'tick', tick: 1 })],
  ];

  for (const [name, data] of refused) {
    it(`returns null for ${name}`, () => {
      expect(decode(data)).toBeNull();
    });

    it(`does not throw for ${name}`, () => {
      expect(() => decode(data)).not.toThrow();
    });
  }

  it('returns the parsed message for a valid frame text', () => {
    const frame = testFrame();
    expect(decode(JSON.stringify(frame))).toEqual(frame);
  });

  it('returns the parsed message for a valid error text', () => {
    expect(decode(JSON.stringify({ t: 'error', code: 'noSession' }))).toEqual({ t: 'error', code: 'noSession' });
  });
});
