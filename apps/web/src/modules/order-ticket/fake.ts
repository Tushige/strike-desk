import type { BuyCommand, CashOutCommand } from '@strike-desk/shared/protocol';
import type { LineState, OpenTicket, OrderTicketProps, ReadSlice, SimpleChoice, SubmitOutcome, TicketAccount, TicketContract, TicketDraft, TicketQuote, WhatIfStop } from './ports';

/**
 * A scripted desk: everything the order ticket is handed, driven by hand. It
 * is what the block is built and shown against until the game is assembled.
 *
 * Every money number in this file was typed in. Nothing here adds, multiplies
 * or rounds a money value, because nothing in the page may: the quotes were
 * worked out once, by hand, the way the server works them out, and are
 * answered from a table.
 *
 * A real quote has a what-if stop for every target of its board and one past
 * the break-even: twenty or more. The tables here are cut down to five stops
 * so that they can be read. The block must not count on how many there are.
 */

type Submittable = BuyCommand | CashOutCommand;

/**
 * The contract ids follow the wire's id scheme for a board of 21 targets one
 * dollar apart from $73.00 (company 0: target 12 is $85.00, UP ids even, DOWN
 * ids odd; contract 61 is company 1, target 9, DOWN), so taking one apart
 * gives a sensible answer. The block itself never takes an id apart.
 */
export const FAKE_CONTRACT_A: TicketContract = { contractId: 24, companyName: 'RoboPup', ticker: 'RPUP', side: 'up', targetCents: 8500, offered: true };
export const FAKE_CONTRACT_B: TicketContract = { contractId: 61, companyName: 'Fizzly', ticker: 'FIZZ', side: 'down', targetCents: 4100, offered: true };

export const FAKE_SPEND_CHOICES: readonly number[] = [5_000_000, 10_000_000];

export const FAKE_ACCOUNT: TicketAccount = { cashCents: 100_000_000, capCents: 50_000_000, canBuy: true, minTicketCents: 500 };
export const FAKE_ACCOUNT_AFTER_BUY: TicketAccount = { cashCents: 95_008_600, capCents: 47_500_000, canBuy: false, minTicketCents: 500 };

export const FAKE_OPEN_TICKET: OpenTicket = {
  positionId: 'd1',
  companyName: 'RoboPup',
  ticker: 'RPUP',
  side: 'up',
  targetCents: 8500,
  quantity: 423,
  costCents: 4_991_400,
  valueCents: 4_991_400,
  profitCents: 0,
  realCents: 0,
  hopeCents: 11_800,
  breakEvenCents: 8618,
};

/** RoboPup's six simple choices. */
export const FAKE_CHOICES: readonly SimpleChoice[] = [
  { side: 'up', choice: 'close', contractId: 24, targetCents: 8500 },
  { side: 'up', choice: 'far', contractId: 28, targetCents: 8700 },
  { side: 'up', choice: 'moonshot', contractId: 34, targetCents: 9000 },
  { side: 'down', choice: 'close', contractId: 21, targetCents: 8300 },
  { side: 'down', choice: 'far', contractId: 17, targetCents: 8100 },
  { side: 'down', choice: 'moonshot', contractId: 11, targetCents: 7800 },
];

function stop(atCents: number, profitCents: number): WhatIfStop {
  return { atCents, profitCents };
}

/** One contract at one price level: what it is quoted at with no spend, and with each spend the desk knows. */
interface QuoteSheet {
  unspent: TicketQuote;
  spent: readonly TicketQuote[];
}

const CONTRACT_A_LEVEL_1: QuoteSheet = {
  unspent: { contractId: 24, spendCents: null, priceCents: 11_800, quantity: 0, costCents: 0, limitPriceCents: 12_036, breakEvenCents: 8618, whatIf: [] },
  spent: [
    {
      contractId: 24,
      spendCents: 5_000_000,
      priceCents: 11_800,
      quantity: 423,
      costCents: 4_991_400,
      limitPriceCents: 12_036,
      breakEvenCents: 8618,
      whatIf: [stop(8300, -4_991_400), stop(8500, -4_991_400), stop(8618, 0), stop(8700, 3_468_600), stop(8900, 11_928_600)],
    },
    {
      contractId: 24,
      spendCents: 10_000_000,
      priceCents: 11_800,
      quantity: 847,
      costCents: 9_994_600,
      limitPriceCents: 12_036,
      breakEvenCents: 8618,
      whatIf: [stop(8300, -9_994_600), stop(8500, -9_994_600), stop(8618, 0), stop(8700, 6_945_400), stop(8900, 23_885_400)],
    },
  ],
};

const CONTRACT_A_LEVEL_2: QuoteSheet = {
  unspent: { contractId: 24, spendCents: null, priceCents: 12_000, quantity: 0, costCents: 0, limitPriceCents: 12_240, breakEvenCents: 8620, whatIf: [] },
  spent: [
    {
      contractId: 24,
      spendCents: 5_000_000,
      priceCents: 12_000,
      quantity: 416,
      costCents: 4_992_000,
      limitPriceCents: 12_240,
      breakEvenCents: 8620,
      whatIf: [stop(8300, -4_992_000), stop(8500, -4_992_000), stop(8620, 0), stop(8700, 3_328_000), stop(8900, 11_648_000)],
    },
    {
      contractId: 24,
      spendCents: 10_000_000,
      priceCents: 12_000,
      quantity: 833,
      costCents: 9_996_000,
      limitPriceCents: 12_240,
      breakEvenCents: 8620,
      whatIf: [stop(8300, -9_996_000), stop(8500, -9_996_000), stop(8620, 0), stop(8700, 6_664_000), stop(8900, 23_324_000)],
    },
  ],
};

const CONTRACT_B: QuoteSheet = {
  unspent: { contractId: 61, spendCents: null, priceCents: 4_500, quantity: 0, costCents: 0, limitPriceCents: 4_600, breakEvenCents: 4055, whatIf: [] },
  spent: [
    {
      contractId: 61,
      spendCents: 5_000_000,
      priceCents: 4_500,
      quantity: 1111,
      costCents: 4_999_500,
      limitPriceCents: 4_600,
      breakEvenCents: 4055,
      whatIf: [stop(3900, 17_220_500), stop(4000, 6_110_500), stop(4055, 0), stop(4100, -4_999_500), stop(4300, -4_999_500)],
    },
    {
      contractId: 61,
      spendCents: 10_000_000,
      priceCents: 4_500,
      quantity: 2222,
      costCents: 9_999_000,
      limitPriceCents: 4_600,
      breakEvenCents: 4055,
      whatIf: [stop(3900, 34_441_000), stop(4000, 12_221_000), stop(4055, 0), stop(4100, -9_999_000), stop(4300, -9_999_000)],
    },
  ],
};

/** The typed-in quote for a draft at a price level, or null for a pair the desk does not know. Looks up; works nothing out. */
function quoteFor(level: 1 | 2, draft: TicketDraft): TicketQuote | null {
  let sheet: QuoteSheet | null = null;
  if (draft.contractId === FAKE_CONTRACT_A.contractId) sheet = level === 1 ? CONTRACT_A_LEVEL_1 : CONTRACT_A_LEVEL_2;
  if (draft.contractId === FAKE_CONTRACT_B.contractId) sheet = CONTRACT_B;
  if (sheet === null) return null;
  if (draft.spendCents === null) return sheet.unspent;
  return sheet.spent.find((quoted) => quoted.spendCents === draft.spendCents) ?? null;
}

interface WritableSlice<T> extends ReadSlice<T> {
  set: (next: T) => void;
}

function createSlice<T>(initial: T): WritableSlice<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (next) => {
      if (Object.is(next, value)) return;
      value = next;
      for (const listener of [...listeners]) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export interface FakeTicketDeskControls {
  /** The desk selects a contract, or nothing. */
  select: (contract: TicketContract | null) => void;
  /** Contract 24 only: its price moves to the other level. The quote changes; the draft does not. */
  setPriceLevel: (level: 1 | 2) => void;
  setLine: (line: LineState) => void;
  offerRetry: (offered: boolean) => void;
  /** The server answers the oldest unanswered command; then the account and the ticket become what is given, if anything is. */
  answer: (outcome: SubmitOutcome, after?: { account?: TicketAccount; position?: OpenTicket | null }) => void;
  /** Every different command submitted, oldest first. */
  submitted: () => readonly Submittable[];
  /** Every draft reported, oldest first. */
  drafts: () => readonly TicketDraft[];
  /** Every contract id picked from the simple choices, oldest first. */
  picks: () => readonly number[];
  /** How many times a retry was asked for. */
  retries: () => number;
}

export interface FakeTicketDesk {
  /** The current props. The same object until the desk changes something. */
  props: () => OrderTicketProps;
  /** Told when `props()` would return something new. Returns the unsubscribe. */
  subscribe: (listener: () => void) => () => void;
  controls: FakeTicketDeskControls;
}

export function createFakeTicketDesk(): FakeTicketDesk {
  const quote = createSlice<TicketQuote | null>(null);
  const account = createSlice<TicketAccount>(FAKE_ACCOUNT);
  const position = createSlice<OpenTicket | null>(null);
  const listeners = new Set<() => void>();

  const submitted: Submittable[] = [];
  /** By command id: a command submitted again gets the promise it got the first time. */
  const promises = new Map<string, Promise<SubmitOutcome>>();
  /** Oldest first: the commands the server has not answered yet. */
  const unanswered: ((outcome: SubmitOutcome) => void)[] = [];
  const drafts: TicketDraft[] = [];
  const picks: number[] = [];
  let retries = 0;
  let issued = 0;
  let level: 1 | 2 = 1;
  let draft: TicketDraft = { contractId: null, spendCents: null };

  const callbacks = {
    onPick: (contractId: number) => {
      picks.push(contractId);
    },
    onRetry: () => {
      retries += 1;
    },
    onDraftChange: (next: TicketDraft) => {
      draft = { contractId: next.contractId, spendCents: next.spendCents };
      drafts.push(draft);
      quote.set(quoteFor(level, draft));
    },
    submit: (command: Submittable): Promise<SubmitOutcome> => {
      const known = promises.get(command.commandId);
      if (known !== undefined) return known;
      const promise = new Promise<SubmitOutcome>((resolve) => {
        unanswered.push(resolve);
      });
      promises.set(command.commandId, promise);
      submitted.push(command);
      return promise;
    },
    newCommandId: () => {
      issued += 1;
      return `fake-cmd-${String(issued).padStart(4, '0')}`;
    },
  };

  let shown: { contract: TicketContract | null; line: LineState; retryOffered: boolean } = { contract: null, line: 'live', retryOffered: false };
  let current: OrderTicketProps | null = null;

  function change(next: Partial<typeof shown>): void {
    shown = { ...shown, ...next };
    current = null;
    for (const listener of [...listeners]) listener();
  }

  return {
    props: () => {
      current ??= { day: 1, choices: FAKE_CHOICES, spendChoices: FAKE_SPEND_CHOICES, quote, account, position, ...shown, ...callbacks };
      return current;
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    controls: {
      select: (contract) => {
        change({ contract });
      },
      setPriceLevel: (next) => {
        level = next;
        quote.set(quoteFor(level, draft));
      },
      setLine: (line) => {
        change({ line });
      },
      offerRetry: (retryOffered) => {
        change({ retryOffered });
      },
      answer: (outcome, after) => {
        const resolve = unanswered.shift();
        if (resolve === undefined) throw new Error('no command is waiting for an answer');
        resolve(outcome);
        if (after?.account !== undefined) account.set(after.account);
        if (after?.position !== undefined) position.set(after.position);
      },
      submitted: () => [...submitted],
      drafts: () => [...drafts],
      picks: () => [...picks],
      retries: () => retries,
    },
  };
}
