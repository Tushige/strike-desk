import type { LabEntry } from './types';

/**
 * The list of blocks is not written down anywhere: it is whatever files sit
 * under `./modules`. Adding a block is adding a file, so two branches
 * building two blocks never touch the same line of the same file.
 */

/**
 * The blocks in the order they each claim, refusing a list that cannot be
 * shown honestly: two files claiming one id would hide one of them behind the
 * other's address fragment, and two files claiming one place in the list
 * would order themselves differently on different days.
 */
export function orderEntries(entries: readonly LabEntry[]): readonly LabEntry[] {
  const byId = new Map<string, LabEntry>();
  for (const entry of entries) {
    if (byId.has(entry.id)) throw new Error(`two lab files claim the id ${entry.id}`);
    byId.set(entry.id, entry);
  }

  const byOrder = new Map<number, LabEntry>();
  for (const entry of entries) {
    const taken = byOrder.get(entry.order);
    if (taken !== undefined) {
      throw new Error(`lab files ${taken.id} and ${entry.id} claim the same place in the list`);
    }
    byOrder.set(entry.order, entry);
  }

  return [...entries].sort((left, right) => left.order - right.order);
}

const files = import.meta.glob<{ default: LabEntry }>('./modules/*.lab.ts', { eager: true });

export const LAB_ENTRIES: readonly LabEntry[] = orderEntries(Object.values(files).map((file) => file.default));
