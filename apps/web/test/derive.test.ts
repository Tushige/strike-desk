import { describe, expect, it } from 'vitest';
import { deriveSlice, sameFields } from '../src/store/derive';
import type { Slice } from '../src/store/gameStore';

/** A derived slice hands out the same object until what it picks changes, and tells its listeners only then. */

function source<T>(initial: T): Slice<T> & { set(next: T): void } {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next) {
      value = next;
      for (const listener of [...listeners]) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

describe('a derived slice', () => {
  it('gives the same object while the picked fields hold still, and a new one when they move', () => {
    const frames = source({ cash: 100, price: 5 });
    const account = deriveSlice(frames, (frame) => ({ cash: frame.cash }), sameFields);
    const first = account.get();

    frames.set({ cash: 100, price: 6 });
    expect(account.get()).toBe(first);

    frames.set({ cash: 90, price: 6 });
    expect(account.get()).not.toBe(first);
    expect(account.get()).toEqual({ cash: 90 });
  });

  it('tells a listener only when the picked value changed', () => {
    const frames = source({ cash: 100, price: 5 });
    const account = deriveSlice(frames, (frame) => ({ cash: frame.cash }), sameFields);
    let told = 0;
    account.subscribe(() => {
      told += 1;
    });

    frames.set({ cash: 100, price: 6 });
    frames.set({ cash: 100, price: 7 });
    expect(told).toBe(0);

    frames.set({ cash: 50, price: 7 });
    expect(told).toBe(1);
  });

  it('treats null and an object as different, and two nulls as the same', () => {
    expect(sameFields(null, null)).toBe(true);
    expect(sameFields(null, { a: 1 })).toBe(false);
    expect(sameFields({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(sameFields({ a: 1, b: 'x' }, { a: 1, b: 'x' })).toBe(true);
  });
});
