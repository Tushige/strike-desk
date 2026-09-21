import { isNewerFrame } from '@strike-desk/shared/protocol';
import type { FrameOrder, ServerMessage } from '@strike-desk/shared/protocol';
import type { Series, SeriesSource } from '../modules/price-chart/index';

export interface ChartView {
  readonly session: string | null;
  readonly day: number;
  readonly companies: readonly { name: string; yMinCents: number; yMaxCents: number }[];
}

export interface ChartStore {
  ingest(message: ServerMessage): void;
  source(companyId: number): SeriesSource;
  readonly get: () => ChartView;
  readonly subscribe: (listener: () => void) => () => void;
}

const EMPTY: Series = { startIndex: 0, values: [] };

/** Observations keep their actual indexes; a missing point waits for history. */
export function createChartStore(): ChartStore {
  let held: FrameOrder | null = null;
  let view: ChartView = { session: null, day: 0, companies: [] };
  const listeners = new Set<() => void>();
  const sources = new Map<number, { value: Series; listeners: Set<() => void>; source: SeriesSource }>();

  function entry(companyId: number) {
    let current = sources.get(companyId);
    if (current === undefined) {
      const next: { value: Series; listeners: Set<() => void>; source: SeriesSource } = {
        value: EMPTY, listeners: new Set<() => void>(), source: {
          series: () => next.value,
          subscribe(listener) { next.listeners.add(listener); return () => { next.listeners.delete(listener); }; },
        },
      };
      sources.set(companyId, next);
      current = next;
    }
    return current;
  }

  function publish(companyId: number, values: readonly number[]): void {
    const current = entry(companyId);
    if (values.length === current.value.values.length && values.every((price, index) => price === current.value.values[index])) return;
    current.value = { startIndex: 0, values: [...values] };
    for (const listener of [...current.listeners]) listener();
  }

  function observe(prices: readonly number[], index: number, history?: readonly (readonly number[])[]): void {
    prices.forEach((price, companyId) => {
      const complete = history?.[companyId];
      if (complete !== undefined && complete.length === index + 1) {
        publish(companyId, complete);
        return;
      }
      const values = entry(companyId).value.values;
      if (index > values.length) return;
      const next = [...values];
      next[index] = price;
      publish(companyId, next);
    });
  }

  return {
    source: (companyId) => entry(companyId).source,
    get: () => view,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    ingest(message) {
      if (message.t === 'quotes') {
        if (held === null || message.session !== held.session || message.rev !== held.rev || message.day !== view.day || !isNewerFrame(held, message)) return;
        held = { session: message.session, rev: message.rev, step: message.step };
        observe(message.prices, message.priceIndex);
        return;
      }
      const frame = message.t === 'frame' ? message : message.t === 'reply' ? message.frame : null;
      if (frame === null || !isNewerFrame(held, frame)) return;
      if (view.session !== frame.session || view.day !== frame.clock.day) {
        for (const companyId of sources.keys()) publish(companyId, []);
      }
      held = { session: frame.session, rev: frame.rev, step: frame.step };
      const companies = frame.board?.companies.map((company, companyId) => ({
        name: frame.companies[companyId]?.name ?? '',
        yMinCents: Math.min(...company.targets),
        yMaxCents: Math.max(...company.targets),
      })) ?? [];
      const next = { session: frame.session, day: frame.clock.day, companies };
      if (JSON.stringify(view) !== JSON.stringify(next)) {
        view = next;
        for (const listener of [...listeners]) listener();
      }
      if (frame.clock.day > 0) observe(frame.prices, frame.clock.priceIndex, frame.history);
    },
  };
}
