import type { GridReadout } from './ports';

/**
 * The arithmetic behind the grid's readout: how many rows and batches were
 * handed to the table since the last sample, and how long the table took to
 * apply them.
 *
 * Pure: every time is handed in, in milliseconds on whatever clock the caller
 * uses, so the same calls always give the same sample. The table samples it
 * about once a second; a sample that comes late or early is scaled to a whole
 * second by the time since the one before it.
 */

export interface ReadoutMeter {
  /**
   * A batch of this many rows was handed to the table at this time. The
   * function returned is called once, with the time the table reported the
   * batch applied.
   */
  readonly handedOver: (rows: number, at: number) => (appliedAt: number) => void;
  /** What happened since the last sample. `rowCount` is whatever the caller says the set holds now. */
  readonly sample: (at: number, rowCount: number) => GridReadout;
  /** The row set was replaced: the worst apply time belongs to the set before it. */
  readonly reset: () => void;
}

export function createReadoutMeter(): ReadoutMeter {
  let rows = 0;
  let batches = 0;
  let lastApplyMs = 0;
  let worstApplyMs = 0;
  let sampledAt: number | null = null;

  return {
    handedOver(count, at) {
      rows += count;
      batches += 1;
      return (appliedAt) => {
        lastApplyMs = appliedAt - at;
        if (lastApplyMs > worstApplyMs) worstApplyMs = lastApplyMs;
      };
    },
    sample(at, rowCount) {
      // The first sample has nothing to measure its length against, and is taken as one second.
      const elapsedMs = sampledAt === null ? 1000 : at - sampledAt;
      const perSecond = (count: number): number => (elapsedMs > 0 ? Math.round((count * 1000) / elapsedMs) : count);
      const taken: GridReadout = {
        rowCount,
        rowsPerSecond: perSecond(rows),
        batchesPerSecond: perSecond(batches),
        lastApplyMs,
        worstApplyMs,
      };
      rows = 0;
      batches = 0;
      sampledAt = at;
      return taken;
    },
    reset() {
      worstApplyMs = 0;
    },
  };
}
