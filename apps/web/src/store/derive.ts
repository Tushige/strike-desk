import type { Slice } from './gameStore';

/**
 * A slice read off another slice through a function, notifying only when the
 * value it produces changes. The whole-frame slice changes five times a
 * second; a derived slice of, say, the account tells its listeners nothing
 * while the account holds still, and hands `useSyncExternalStore` the same
 * object until it moves.
 *
 * `same` says when two produced values mean the same thing. It is given the
 * last value handed out and the freshly produced one.
 */
export function deriveSlice<S, T>(source: Slice<S>, pick: (value: S) => T, same: (held: T, next: T) => boolean): Slice<T> {
  let held: { value: T } | null = null;

  function current(): T {
    const next = pick(source.get());
    if (held !== null && same(held.value, next)) return held.value;
    held = { value: next };
    return next;
  }

  return {
    get: current,
    subscribe(listener) {
      // Each listener remembers the last value it was told, so a second
      // listener is told about a change the first one already absorbed.
      let told = current();
      return source.subscribe(() => {
        const next = current();
        if (next === told) return;
        told = next;
        listener();
      });
    },
  };
}

/** Two objects whose own enumerable fields are all `Object.is` equal, or both null. */
export function sameFields<T extends object | null>(a: T, b: T): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  const recordA = a as Record<string, unknown>;
  const recordB = b as Record<string, unknown>;
  return keysA.every((key) => Object.is(recordA[key], recordB[key]));
}
