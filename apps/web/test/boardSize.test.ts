import { describe, expect, it } from 'vitest';
import { boardFromSearch } from '../src/boardSize';

/**
 * The page reads a wanted contract count from its own address and passes it
 * on. It holds no list of sizes and no maximum: the service owns both, so
 * there is only one allow-list in the system and no way for the two to
 * disagree.
 */

describe('the board size on the address', () => {
  it('passes on any whole number above zero, allow-listed or not', () => {
    expect(boardFromSearch('?board=2500')).toBe(2500);
    expect(boardFromSearch('?board=25000')).toBe(25_000);
    expect(boardFromSearch('?board=999999')).toBe(999_999);
    expect(boardFromSearch('?board=1')).toBe(1);
  });

  it('reads the value wherever it sits among the others', () => {
    expect(boardFromSearch('?x=1&board=2500')).toBe(2500);
    expect(boardFromSearch('board=2500')).toBe(2500);
  });

  it('is null for anything that does not read as a whole number above zero', () => {
    for (const search of ['', '?', '?x=1', '?board=', '?board=abc', '?board=0', '?board=-5', '?board=2500.5', '?board= ', '?board=1e3', '?board=Infinity']) {
      expect(boardFromSearch(search)).toBeNull();
    }
  });

  it('takes the first of a repeated value', () => {
    expect(boardFromSearch('?board=2500&board=25000')).toBe(2500);
    expect(boardFromSearch('?board=abc&board=2500')).toBeNull();
  });
});
