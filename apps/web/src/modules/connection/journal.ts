import { commandSchema } from '@strike-desk/shared/protocol';
import type { BuyCommand, CashOutCommand, Frame } from '@strike-desk/shared/protocol';
import type { SessionStore } from './ports';

export interface SavedIntent {
  version: 1;
  session: string;
  day: number;
  command: BuyCommand | CashOutCommand;
  submittedAt: number;
}

/** Optional tab persistence. Storage access and parsing never become a trading path. */
export function createJournal(storage: SessionStore | null, key: string, wallNow = Date.now) {
  function clear(): void { try { storage?.removeItem(key); } catch { /* same-tab recovery still works */ } }
  return {
    clear,
    read(): SavedIntent | null {
      try {
        const raw: unknown = JSON.parse(storage?.getItem(key) ?? 'null');
        if (typeof raw !== 'object' || raw === null) return null;
        const r = raw as Record<string, unknown>;
        const parsed = commandSchema.safeParse(r.command);
        if (r.version !== 1 || typeof r.session !== 'string' || r.session.length === 0 ||
          !Number.isInteger(r.day) || (r.day as number) < 1 || (r.day as number) > 5 ||
          typeof r.submittedAt !== 'number' || !Number.isFinite(r.submittedAt) ||
          r.submittedAt > wallNow() || wallNow() - r.submittedAt > 30 * 60_000 ||
          !parsed.success || (parsed.data.t !== 'buy' && parsed.data.t !== 'cashOut') ||
          (parsed.data.t === 'buy' && parsed.data.day !== r.day)) { clear(); return null; }
        return { version: 1, session: r.session, day: r.day as number, submittedAt: r.submittedAt, command: parsed.data };
      } catch { clear(); return null; }
    },
    write(intent: SavedIntent): boolean {
      try { if (storage === null) return false; storage.setItem(key, JSON.stringify(intent)); return true; }
      catch { return false; }
    },
  };
}

/** Receipts are checked before this. Eligibility never means an outcome was accepted. */
export function intentEligible(intent: SavedIntent, frame: Frame): boolean {
  if (intent.session !== frame.session || intent.day !== frame.clock.day || frame.stress) return false;
  if (frame.clock.phase !== 'preBell' && frame.clock.phase !== 'open') return false;
  const command = intent.command;
  return command.t === 'buy' ? frame.account.canBuy :
    frame.positions.some((p) => p.id === command.positionId && p.day === intent.day && p.status === 'open');
}
