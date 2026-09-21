import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ENGINE_VERSION, PROTOCOL_VERSION, receiptSchema, seedToMarketCode } from '@strike-desk/shared/engine';
import type { Receipt } from '@strike-desk/shared/engine';

/**
 * The command path's transcript is a frozen file: one scripted game, played
 * once through the path and committed, so that the lab can show the path's
 * answers without a server. Nothing in it moves when the rules move. Without
 * these cases a change of the rules would leave the lab showing answers this
 * code no longer gives, and every check would stay green.
 *
 * What is compared is the version labels and the shape of the story: which
 * answers are in it, and that its own numbers agree with each other. Never a
 * price, a quantity or an amount of the fixed game, so ordinary price work
 * does not turn this red; a change of the engine's version does, on purpose.
 *
 * The comparison is made here rather than in `apps/web` because the version
 * labels and the market number live behind the shared package's engine entry,
 * which the web package may not import.
 */

/** What to do about a failure here, said where a red run will show it. */
const RETAKE = 'The command path transcript is older than the rules. Retake it: pnpm --filter @strike-desk/server exec tsx scripts/command-path-transcript.ts';

const TRANSCRIPT = new URL('../../web/src/lab/modules/command-path.transcript.json', import.meta.url);

/** The market the script plays. No live game uses it. */
const SEED = 4242424242;

interface Ticket {
  id: string;
  quantity: number;
  priceCents: number;
  costCents: number;
  exit?: { kind: string; proceedsCents: number };
}

interface Entry {
  label: string;
  step: number;
  command: { t: string; commandId: string; seenPriceCents?: number };
  receipt: Receipt;
  repeat: boolean;
  cashCents: number;
  rev: number;
  tickets: Ticket[];
}

const text = readFileSync(TRANSCRIPT, 'utf8');
const transcript = JSON.parse(text) as { recordedWith: Record<string, unknown>; entries: Entry[] };
const { entries } = transcript;

/** The entries that got this answer to this kind of command, first sendings only. */
function answered(kind: Receipt['kind'], answer: string): Entry[] {
  return entries.filter((entry) => !entry.repeat && entry.receipt.kind === kind && (entry.receipt.reason ?? entry.receipt.outcome) === answer);
}

describe("the command path's transcript", () => {
  it('was made from the rules as they stand today, and says nothing else about where it came from', () => {
    expect(transcript.recordedWith, RETAKE).toEqual({ protocol: PROTOCOL_VERSION, engine: ENGINE_VERSION });
  });

  it('holds a receipt of the shared shape on every line, answering the command on that line', () => {
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(receiptSchema.safeParse(entry.receipt).success, `${entry.label}: ${RETAKE}`).toBe(true);
      expect(entry.receipt.commandId, entry.label).toBe(entry.command.commandId);
      expect(entry.receipt.kind, entry.label).toBe(entry.command.t);
    }
  });

  it('never goes back in time', () => {
    const steps = entries.map((entry) => entry.step);
    expect(steps).toEqual([...steps].sort((left, right) => left - right));
  });

  it.each([
    ['buy', 'accepted'],
    ['buy', 'alreadyBought'],
    ['buy', 'overCap'],
    ['buy', 'priceMoved'],
    ['buy', 'marketClosed'],
    ['cashOut', 'accepted'],
    ['cashOut', 'alreadyClosed'],
  ] as const)('tells of a %s answered %s', (kind, answer) => {
    expect(answered(kind, answer).length, RETAKE).toBeGreaterThanOrEqual(1);
  });

  it('tells of a repeat: the same command id as an earlier line, the same receipt, and not a cent or a revision moved', () => {
    const repeats = entries.filter((entry) => entry.repeat);
    expect(repeats.length, RETAKE).toBeGreaterThanOrEqual(1);
    for (const repeat of repeats) {
      const first = entries.find((entry) => entry.command.commandId === repeat.command.commandId);
      expect(first?.repeat, repeat.label).toBe(false);
      expect(repeat.receipt, repeat.label).toEqual(first?.receipt);
      expect([repeat.cashCents, repeat.rev, repeat.tickets], repeat.label).toEqual([first?.cashCents, first?.rev, first?.tickets]);
    }
  });

  it('tells of a buy that claimed a higher price than the real one and was filled at the real one', () => {
    const generous = answered('buy', 'accepted').filter((entry) => {
      const bought = entry.tickets.find((ticket) => ticket.id === entry.receipt.positionId);
      return bought !== undefined && (entry.command.seenPriceCents ?? 0) > bought.priceCents;
    });
    expect(generous.length, RETAKE).toBeGreaterThanOrEqual(1);
    for (const entry of generous) {
      const bought = entry.tickets.find((ticket) => ticket.id === entry.receipt.positionId);
      expect(bought?.costCents, entry.label).toBe((bought?.priceCents ?? NaN) * (bought?.quantity ?? NaN));
    }
  });

  it('tells of a cash-out after the bell, pressed twice: accepted both times, and the cash stays where the bell put it', () => {
    const late = answered('cashOut', 'accepted').filter((entry) => entry.tickets.find((ticket) => ticket.id === entry.receipt.positionId)?.exit?.kind === 'bell');
    expect(late.length, RETAKE).toBeGreaterThanOrEqual(2);
    const [firstPress] = late;
    if (firstPress === undefined) throw new Error(RETAKE);
    const ticket = firstPress.tickets.find((one) => one.id === firstPress.receipt.positionId);
    // A payment worth counting: were it made twice, the cash would show it.
    expect(ticket?.exit?.proceedsCents, RETAKE).toBeGreaterThan(0);

    // Where the bell put the cash: what it was when that ticket was bought, plus what the bell paid for it, once.
    const bought = entries.find((entry) => !entry.repeat && entry.receipt.kind === 'buy' && entry.receipt.positionId === ticket?.id);
    const whereTheBellPutIt = (bought?.cashCents ?? NaN) + (ticket?.exit?.proceedsCents ?? NaN);
    for (const press of late) {
      expect(press.cashCents, press.label).toBe(whereTheBellPutIt);
    }
  });

  it('holds no news, no headline, no content label, and neither the seed nor the market number of its market', () => {
    const code = seedToMarketCode(SEED);
    // A search for the wrong string would pass for the wrong reason.
    expect(code).toMatch(/^[2-9A-HJ-NP-Z]{3}-[2-9A-HJ-NP-Z]{3}-[2-9A-HJ-NP-Z]{4}$/);

    expect({
      news: text.includes('"news"'),
      title: text.includes('"title"'),
      content: text.includes('"content"'),
      seedInDecimal: text.includes(String(SEED)),
      marketNumber: text.includes(code),
      marketNumberWithoutDashes: text.includes(code.replace(/-/g, '')),
      theFieldName: text.includes('marketCode'),
    }).toEqual({ news: false, title: false, content: false, seedInDecimal: false, marketNumber: false, marketNumberWithoutDashes: false, theFieldName: false });
  });
});
