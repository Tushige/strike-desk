import type { ComponentType } from 'react';

/**
 * What one building block tells the lab about itself.
 *
 * A block joins the lab by adding one file of its own,
 * `apps/web/src/lab/modules/<id>.lab.ts`, whose default export is a
 * `LabEntry`. Nothing else is edited to add, build or show a block, so blocks
 * can be built side by side without ever meeting in the same file.
 */
export interface LabEntry {
  /**
   * Kebab-case and unique. It is also the address fragment the lab selects
   * this block by, as in `/lab#live-grid`.
   */
  id: string;
  /** Where this block sits in the list, 1 first. Unique across the blocks. */
  order: number;
  /** The block's name, as the list and the panel head show it. */
  title: string;
  /** One or two sentences: what the block does. */
  summary: string;
  /** One line: the port this block is built against. */
  builtAgainst: string;
  /**
   * Set once the block is built: loads the component that shows the block
   * against its stand-in source. There is no status field — a block with no
   * `demo` is a block that is not built yet.
   */
  demo?: () => Promise<{ default: ComponentType }>;
}
