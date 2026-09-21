import { describe, expect, it } from 'vitest';
import {
  MAX_DRAFT_SPEND_CENTS,
  boardSchema,
  clientMessageSchema,
  commandSchema,
  contractId,
  decodeContractId,
  draftViewSchema,
  frameSchema,
  isNewerFrame,
  parseClientMessage,
  parseServerMessage,
  quotesMessageSchema,
  receiptSchema,
  serverMessageSchema,
} from '../src/protocol';

const ID = 'cmd-0001';
const buy = { t: 'buy', commandId: ID, day: 1, contractId: 20, spendCents: 5_000_000, seenPriceCents: 12_300 };

describe('client messages', () => {
  it.each([
    [{ t: 'hello', v: 1 }],
    [{ t: 'hello', v: 1, session: 'abc', board: 2508 }],
    // Another version still parses: the handler compares it and can answer by name.
    [{ t: 'hello', v: 2 }],
    [{ t: 'hello', v: 0 }],
    [{ t: 'hello', v: 1000 }],
    [{ t: 'start', commandId: ID, pace: 1 }],
    [{ t: 'start', commandId: ID, pace: 3 }],
    [{ t: 'start', commandId: ID, pace: 7.5 }],
    [buy],
    [{ t: 'cashOut', commandId: ID, positionId: 'd1' }],
    [{ t: 'openBell', commandId: ID, day: 1 }],
    [{ t: 'skipToBell', commandId: ID, day: 3 }],
    [{ t: 'nextDay', commandId: ID, day: 5 }],
    [{ t: 'draft', contractId: 5, spendCents: 5_000_000 }],
    [{ t: 'draft', contractId: 5, spendCents: null }],
    [{ t: 'draft', contractId: null, spendCents: 5_000_000 }],
    [{ t: 'draft', contractId: null, spendCents: null }],
    // The largest spend a draft may name: $1 billion.
    [{ t: 'draft', contractId: 5, spendCents: 100_000_000_000 }],
  ])('accepts %j', (message) => {
    expect(clientMessageSchema.parse(message)).toEqual(message);
    expect(parseClientMessage(message)).toEqual(message);
  });

  it.each([
    ['an unknown key on a command', { ...buy, seed: 1 }],
    ['an unknown key on hello', { t: 'hello', v: 1, admin: true }],
    ['an unknown message', { t: 'restart', commandId: ID }],
    ['a version that is not whole', { t: 'hello', v: 1.5 }],
    ['a negative version', { t: 'hello', v: -1 }],
    ['a version past the bound', { t: 'hello', v: 1001 }],
    ['a version sent as text', { t: 'hello', v: '1' }],
    ['a hello with no version', { t: 'hello' }],
    ['a bad pace', { t: 'start', commandId: ID, pace: 2 }],
    ['a pace sent as text', { t: 'start', commandId: ID, pace: '3' }],
    ['a short commandId', { ...buy, commandId: 'short' }],
    ['a very long commandId', { ...buy, commandId: 'x'.repeat(65) }],
    ['a missing commandId', { t: 'start', pace: 1 }],
    ['cents that are not whole', { ...buy, spendCents: 5000.5 }],
    ['a seen price that is not whole', { ...buy, seenPriceCents: 123.4 }],
    ['a spend of nothing', { ...buy, spendCents: 0 }],
    ['a negative spend', { ...buy, spendCents: -100 }],
    ['a negative contract', { ...buy, contractId: -1 }],
    ['day 0', { ...buy, day: 0 }],
    ['day 6', { t: 'nextDay', commandId: ID, day: 6 }],
    ['not-a-number cents', { ...buy, spendCents: NaN }],
    ['infinite cents', { ...buy, spendCents: Infinity }],
    ['a draft with a command id', { t: 'draft', commandId: ID, contractId: 5, spendCents: 5_000_000 }],
    ['a draft with a negative spend', { t: 'draft', contractId: 5, spendCents: -100 }],
    ['a draft with a spend of nothing', { t: 'draft', contractId: 5, spendCents: 0 }],
    ['a draft that spends one cent more than $1 billion', { t: 'draft', contractId: 5, spendCents: 100_000_000_001 }],
    ['a draft with a negative contract', { t: 'draft', contractId: -1, spendCents: 5_000_000 }],
    ['a draft with an unknown key', { t: 'draft', contractId: 5, spendCents: 5_000_000, day: 1 }],
    ['a draft with a key missing', { t: 'draft', contractId: 5 }],
    ['text', 'buy'],
    ['nothing', null],
  ])('refuses %s', (_name, message) => {
    expect(parseClientMessage(message)).toBeNull();
  });

  it('refuses a message that tries to choose the market', () => {
    // The seed is the server's alone: a browser that asks for one must be
    // refused by the contract itself, before any handler sees the message.
    expect(parseClientMessage({ t: 'hello', v: 1, seed: 77 })).toBeNull();
    expect(parseClientMessage({ t: 'hello', v: 2, seed: 77 })).toBeNull();
    expect(parseClientMessage({ ...buy, seed: 77 })).toBeNull();
    expect(parseClientMessage({ t: 'start', commandId: ID, pace: 1, seed: 77 })).toBeNull();
  });

  it('does not take a draft as a command: it can never reach the rules, get a receipt or be logged', () => {
    expect(commandSchema.safeParse({ t: 'draft', contractId: 5, spendCents: 5_000_000 }).success).toBe(false);
    expect(commandSchema.safeParse({ t: 'draft', contractId: null, spendCents: null }).success).toBe(false);
  });

  it('does not take hello as a command', () => {
    expect(commandSchema.safeParse({ t: 'hello', v: 1 }).success).toBe(false);
    expect(commandSchema.safeParse(buy).success).toBe(true);
  });
});

describe('server messages', () => {
  const receipt = { commandId: ID, kind: 'buy', step: 310, outcome: 'accepted', positionId: 'd1' };
  const frame = {
    t: 'frame',
    session: 's1',
    rev: 0,
    step: 0,
    clock: { phase: 'lobby', day: 0, stepsLeft: 0, priceIndex: 0, pace: null },
    prices: [8400, 4200, 12000, 2800, 6500, 15000],
    companies: [
      { ticker: 'RPUP', name: 'RoboPup' },
      { ticker: 'FIZZ', name: 'Fizzly' },
    ],
    minTicketCents: 500,
    board: null,
    quotes: [],
    quoteReals: [],
    quoteHopes: [],
    quoteBreakEvens: [],
    news: [],
    account: { cashCents: 100_000_000, worthCents: 100_000_000, capCents: 50_000_000, canBuy: false },
    positions: [],
    receipts: [],
    days: [],
    stress: false,
  };

  it('a frame needs the names, the cheapest tradable price, both parts of every ticket price and its break-even', () => {
    expect(frameSchema.parse(frame)).toEqual(frame);
    for (const field of ['companies', 'minTicketCents', 'quoteReals', 'quoteHopes', 'quoteBreakEvens']) {
      const without: Record<string, unknown> = { ...frame };
      delete without[field];
      expect({ field, parses: frameSchema.safeParse(without).success }).toEqual({ field, parses: false });
      expect({ field, parses: parseServerMessage(without) !== null }).toEqual({ field, parses: false });
    }
    const filled = { ...frame, quotes: [1200, 0], quoteReals: [700, 0], quoteHopes: [500, 0], quoteBreakEvens: [8512, 8500] };
    expect(frameSchema.parse(filled)).toEqual(filled);
  });

  it('refuses a company without a name or a ticker, and ticket money that is not whole cents', () => {
    expect(frameSchema.safeParse({ ...frame, companies: [{ ticker: 'RPUP' }] }).success).toBe(false);
    expect(frameSchema.safeParse({ ...frame, companies: [{ name: 'RoboPup' }] }).success).toBe(false);
    expect(frameSchema.safeParse({ ...frame, companies: [{ ticker: 7, name: 'RoboPup' }] }).success).toBe(false);
    expect(frameSchema.safeParse({ ...frame, minTicketCents: 499.5 }).success).toBe(false);
    expect(frameSchema.safeParse({ ...frame, quoteReals: [0.5] }).success).toBe(false);
    expect(frameSchema.safeParse({ ...frame, quoteHopes: ['500'] }).success).toBe(false);
    expect(frameSchema.safeParse({ ...frame, quoteBreakEvens: [8512.5] }).success).toBe(false);
  });

  it('accepts a frame, a reply, a quotes batch and an error', () => {
    expect(parseServerMessage(frame)).toEqual(frame);
    expect(parseServerMessage({ t: 'reply', receipt, frame })).toEqual({ t: 'reply', receipt, frame });
    const quotes = { t: 'quotes', session: 's1', rev: 3, step: 400, day: 1, priceIndex: 100, prices: [1, 2, 3, 4, 5, 6], changes: [[5, 1200, 300, 900, 8512], [7, 0, 0, 0, 8500]] };
    expect(parseServerMessage(quotes)).toEqual(quotes);
    expect(parseServerMessage({ t: 'error', code: 'badMessage' })).toEqual({ t: 'error', code: 'badMessage' });
  });

  it('a quotes batch names its day and carries every column of a changed ticket: id, price, real, hope, break-even', () => {
    const batch = { t: 'quotes', session: 's1', rev: 3, step: 400, day: 1, priceIndex: 100, prices: [1, 2, 3, 4, 5, 6], changes: [[5, 1200, 300, 900, 8512]] };
    expect(quotesMessageSchema.parse(batch)).toEqual(batch);
    const withoutDay: Record<string, unknown> = { ...batch };
    delete withoutDay.day;
    expect(quotesMessageSchema.safeParse(withoutDay).success).toBe(false);
    expect(quotesMessageSchema.safeParse({ ...batch, day: 6 }).success).toBe(false);
    expect(quotesMessageSchema.safeParse({ ...batch, changes: [[5, 1200]] }).success).toBe(false);
    expect(quotesMessageSchema.safeParse({ ...batch, changes: [[5, 1200, 300, 900, 8512.5]] }).success).toBe(false);
  });

  it('the echoed draft spend is no looser than the message it echoes: above zero, at most $1 billion', () => {
    expect(MAX_DRAFT_SPEND_CENTS).toBe(100_000_000_000);
    expect(draftViewSchema.safeParse({ contractId: 5, spendCents: 100_000_000_000 }).success).toBe(true);
    expect(draftViewSchema.safeParse({ contractId: 5, spendCents: null }).success).toBe(true);
    expect(draftViewSchema.safeParse({ contractId: 5, spendCents: 100_000_000_001 }).success).toBe(false);
    expect(draftViewSchema.safeParse({ contractId: 5, spendCents: 0 }).success).toBe(false);
    expect(draftViewSchema.safeParse({ contractId: 5, spendCents: -100 }).success).toBe(false);
  });

  it('lets an older client read a message with a field it does not know', () => {
    expect(serverMessageSchema.safeParse({ ...frame, somethingNew: 1 }).success).toBe(true);
  });

  it('refuses money that is not whole cents and a reject reason it does not know', () => {
    expect(parseServerMessage({ ...frame, prices: [84.5] })).toBeNull();
    expect(parseServerMessage({ ...frame, account: { ...frame.account, cashCents: 0.5 } })).toBeNull();
    expect(receiptSchema.safeParse({ ...receipt, outcome: 'rejected', reason: 'becauseISaidSo' }).success).toBe(false);
    expect(receiptSchema.safeParse({ ...receipt, outcome: 'rejected', reason: 'priceMoved' }).success).toBe(true);
  });

  it('knows the reason for a contract the board does not offer', () => {
    const refused = { ...receipt, outcome: 'rejected', reason: 'notOffered', positionId: undefined };
    expect(receiptSchema.safeParse(refused).success).toBe(true);
    expect(parseServerMessage({ t: 'reply', receipt: { commandId: ID, kind: 'buy', step: 310, outcome: 'rejected', reason: 'notOffered' }, frame })).not.toBeNull();
  });

  it('a board says what it offers on each side: both fields are required whole numbers from zero', () => {
    const company = { targets: [9000, 10_000, 11_000], simpleUp: [2, 2, 2], simpleDown: [0, 0, 0] };
    const offered = { ...company, lowestUpIndex: 1, highestDownIndex: 1 };
    const board = (companyBoard: object) => ({ targetsPerCompany: 3, companies: [companyBoard] });
    expect(boardSchema.parse(board(offered))).toEqual(board(offered));
    expect(boardSchema.safeParse(board(company)).success).toBe(false);
    expect(boardSchema.safeParse(board({ ...company, lowestUpIndex: 1 })).success).toBe(false);
    expect(boardSchema.safeParse(board({ ...company, highestDownIndex: 1 })).success).toBe(false);
    for (const bad of [-1, 0.5, '1', null]) {
      expect(boardSchema.safeParse(board({ ...offered, lowestUpIndex: bad })).success).toBe(false);
      expect(boardSchema.safeParse(board({ ...offered, highestDownIndex: bad })).success).toBe(false);
    }
    expect(parseServerMessage({ ...frame, board: board(offered) })).not.toBeNull();
    expect(parseServerMessage({ ...frame, board: board(company) })).toBeNull();
  });
});

describe('the contract id, which is how a frame\'s quotes are indexed', () => {
  const COMPANIES = 6;
  const SIDES = ['up', 'down'] as const;

  it.each([21, 209])('%i targets per company: every company, target and side makes one id, the ids are dense from 0, and each decodes back', (targetsPerCompany) => {
    const ids: number[] = [];
    for (let companyId = 0; companyId < COMPANIES; companyId += 1) {
      for (let targetIndex = 0; targetIndex < targetsPerCompany; targetIndex += 1) {
        for (const side of SIDES) {
          const ref = { companyId, targetIndex, side };
          const id = contractId(targetsPerCompany, ref);
          expect(decodeContractId(targetsPerCompany, id)).toEqual(ref);
          ids.push(id);
        }
      }
    }
    const contracts = COMPANIES * targetsPerCompany * 2;
    expect(ids).toHaveLength(contracts);
    expect([...ids].sort((a, b) => a - b)).toEqual(Array.from({ length: contracts }, (_unused, id) => id));
  });

  it('UP on the first target of the first company is 0, and DOWN on the same target is 1', () => {
    expect(contractId(21, { companyId: 0, targetIndex: 0, side: 'up' })).toBe(0);
    expect(contractId(21, { companyId: 0, targetIndex: 0, side: 'down' })).toBe(1);
  });

  it('a company\'s contracts sit together: 42 to a company on the 21-target board, 251 the last', () => {
    expect(contractId(21, { companyId: 1, targetIndex: 0, side: 'up' })).toBe(42);
    expect(contractId(21, { companyId: 5, targetIndex: 20, side: 'down' })).toBe(251);
    expect(decodeContractId(21, 251)).toEqual({ companyId: 5, targetIndex: 20, side: 'down' });
    expect(decodeContractId(21, 85)).toEqual({ companyId: 2, targetIndex: 0, side: 'down' });
    expect(decodeContractId(209, 2507)).toEqual({ companyId: 5, targetIndex: 208, side: 'down' });
  });
});

describe('isNewerFrame', () => {
  const held = { session: 's1', rev: 5, step: 400 };

  it('takes the first frame', () => {
    expect(isNewerFrame(null, held)).toBe(true);
  });

  it('takes a later step at the same rev, and the same step again', () => {
    expect(isNewerFrame(held, { session: 's1', rev: 5, step: 401 })).toBe(true);
    expect(isNewerFrame(held, { session: 's1', rev: 5, step: 400 })).toBe(true);
  });

  it('an equal frame is accepted', () => {
    // Same session, same rev, same step: accepted, not dropped. A store that
    // wants to redraw nothing for an unchanged frame must decide that for
    // itself; this rule is only about ordering.
    expect(isNewerFrame(held, { ...held })).toBe(true);
  });

  it('refuses an older frame', () => {
    expect(isNewerFrame(held, { session: 's1', rev: 5, step: 399 })).toBe(false);
    expect(isNewerFrame(held, { session: 's1', rev: 4, step: 450 })).toBe(false);
  });

  it('lets rev beat step', () => {
    expect(isNewerFrame(held, { session: 's1', rev: 6, step: 398 })).toBe(true);
  });

  it('lets a new session win whatever its numbers', () => {
    expect(isNewerFrame(held, { session: 's2', rev: 0, step: 0 })).toBe(true);
  });
});
