import { z } from 'zod';
import { PACES } from './clock';

/**
 * The wire contract. Every message in either direction is one of these
 * shapes, and both sides parse what they receive through these schemas.
 *
 * Rules that the shapes alone do not show:
 * - Every `frame` is the whole public picture, so any frame may be dropped.
 *   A client keeps a frame only if `isNewerFrame` says so (rev, then step).
 * - Every command carries a `commandId` made at the moment of the press and
 *   reused for every resend. A repeated id gets the original receipt back
 *   and changes nothing.
 * - Nothing here may carry a future price, an unrevealed news outcome or
 *   the seed. The market code appears only in `final`.
 * - Client messages are strict (unknown keys are refused). Server messages
 *   are open, so fields can be added without breaking an older client.
 */

export const PROTOCOL_VERSION = 1;

const cents = z.number().int();
const count = z.number().int().nonnegative();
const commandId = z.string().min(8).max(64);
const day = z.number().int().min(1).max(5);
const side = z.enum(['up', 'down']);
const pace = z.union([z.literal(PACES[0]), z.literal(PACES[1]), z.literal(PACES[2])]);

// ---------------------------------------------------------------- client -> server

export const helloSchema = z.strictObject({
  t: z.literal('hello'),
  v: z.literal(PROTOCOL_VERSION),
  /** Resume this session if the server still has it; otherwise a new one is made. */
  session: z.string().max(64).optional(),
  /** Stress setting: wanted number of contracts. Only read when a session is created. */
  board: z.number().int().min(1).max(100000).optional(),
});

export const startCommandSchema = z.strictObject({
  t: z.literal('start'),
  commandId,
  pace,
});

export const buyCommandSchema = z.strictObject({
  t: z.literal('buy'),
  commandId,
  day,
  contractId: count,
  spendCents: cents.positive(),
  /** The ticket price the player was looking at when they pressed. */
  seenPriceCents: cents.positive(),
});

export const cashOutCommandSchema = z.strictObject({
  t: z.literal('cashOut'),
  commandId,
  positionId: z.string().max(16),
});

export const clockCommandSchema = z.strictObject({
  t: z.enum(['openBell', 'skipToBell', 'nextDay']),
  commandId,
  /** The day the player was looking at, so a late resend cannot skip the wrong day. */
  day,
});

export const commandSchema = z.discriminatedUnion('t', [
  startCommandSchema,
  buyCommandSchema,
  cashOutCommandSchema,
  clockCommandSchema,
]);

export const clientMessageSchema = z.discriminatedUnion('t', [
  helloSchema,
  startCommandSchema,
  buyCommandSchema,
  cashOutCommandSchema,
  clockCommandSchema,
]);

export type Hello = z.infer<typeof helloSchema>;
export type StartCommand = z.infer<typeof startCommandSchema>;
export type BuyCommand = z.infer<typeof buyCommandSchema>;
export type CashOutCommand = z.infer<typeof cashOutCommandSchema>;
export type ClockCommand = z.infer<typeof clockCommandSchema>;
export type Command = z.infer<typeof commandSchema>;
export type CommandKind = Command['t'];
export type ClientMessage = z.infer<typeof clientMessageSchema>;

// ---------------------------------------------------------------- server -> client

export const rejectReasonSchema = z.enum([
  'notEnoughCash',
  'overCap',
  'marketClosed',
  'priceMoved',
  'alreadyBought',
  'tooCheap',
  'spendTooSmall',
  'unknownContract',
  'unknownPosition',
  'alreadyClosed',
  'wrongDay',
  'wrongPhase',
  'notStarted',
  'alreadyStarted',
  'gameOver',
  'stressMode',
]);
export type RejectReason = z.infer<typeof rejectReasonSchema>;

/** The stored, explicit outcome of one command. */
export const receiptSchema = z.object({
  commandId,
  kind: z.enum(['start', 'buy', 'cashOut', 'openBell', 'skipToBell', 'nextDay']),
  /** The server's logical step when the command arrived. It alone decides the bell rule. */
  step: count,
  outcome: z.enum(['accepted', 'rejected']),
  reason: rejectReasonSchema.optional(),
  positionId: z.string().optional(),
});
export type Receipt = z.infer<typeof receiptSchema>;

export const phaseSchema = z.enum(['lobby', 'preBell', 'open', 'debrief', 'final']);

export const clockViewSchema = z.object({
  phase: phaseSchema,
  /** 1 to 5; 0 in the lobby. */
  day: z.number().int().min(0).max(5),
  /** Logical steps until the phase ends by itself (one step is 200 ms of game time). */
  stepsLeft: count,
  /** Which point of today's price path is showing: 0 to 500. */
  priceIndex: count,
  pace: pace.nullable(),
});
export type ClockView = z.infer<typeof clockViewSchema>;

export const newsViewSchema = z.object({
  id: count,
  day,
  companyId: count,
  trust: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  source: z.string(),
  title: z.string(),
  body: z.string(),
  /** True once the hidden reveal moment has passed. The banner is derived from this. */
  revealed: z.boolean(),
  /** Present only once revealed: where on today's path the move landed. */
  revealIndex: count.optional(),
  /** Present only from that day's closing bell on. */
  wasTrue: z.boolean().optional(),
});
export type NewsView = z.infer<typeof newsViewSchema>;

export const companyBoardSchema = z.object({
  targets: z.array(cents),
  simpleUp: z.tuple([count, count, count]),
  simpleDown: z.tuple([count, count, count]),
});

export const boardSchema = z.object({
  targetsPerCompany: count,
  companies: z.array(companyBoardSchema),
});

export const positionExitSchema = z.object({
  kind: z.enum(['cashOut', 'bell']),
  step: count,
  priceIndex: count,
  priceCents: cents,
  proceedsCents: cents,
});

export const positionViewSchema = z.object({
  id: z.string(),
  day,
  contractId: count,
  companyId: count,
  side,
  targetCents: cents,
  quantity: count,
  entryPriceCents: cents,
  costCents: cents,
  entryStep: count,
  entryPriceIndex: count,
  breakEvenCents: cents,
  status: z.enum(['open', 'cashedOut', 'settled']),
  /** Open: what it would sell for right now. Closed: what it paid. */
  valueCents: cents,
  /** Per-ticket split of the current (or exit) price. */
  realCents: cents,
  hopeCents: cents,
  exit: positionExitSchema.optional(),
  /** After a cash-out only: what the same tickets are worth now, and at the bell once it has rung. */
  ifHeldCents: cents.optional(),
});
export type PositionView = z.infer<typeof positionViewSchema>;

export const accountViewSchema = z.object({
  cashCents: cents,
  /** Cash plus what the open ticket would sell for right now. */
  worthCents: cents,
  /** The most that may be spent on today's ticket. */
  capCents: cents,
  /** False when today's ticket is already bought, the market is closed, or the stress setting is on. */
  canBuy: z.boolean(),
});
export type AccountView = z.infer<typeof accountViewSchema>;

export const dayResultSchema = z.object({
  day,
  startCents: cents,
  endCents: cents,
});
export type DayResult = z.infer<typeof dayResultSchema>;

export const finalViewSchema = z.object({
  /** The market number, shown only now. */
  marketCode: z.string(),
  engine: z.string(),
  content: z.string(),
  finalCents: cents,
});
export type FinalView = z.infer<typeof finalViewSchema>;

export const frameSchema = z.object({
  t: z.literal('frame'),
  session: z.string(),
  /** Goes up with every stored receipt and every settlement. */
  rev: count,
  step: count,
  clock: clockViewSchema,
  /** Share prices in cents, by company id. */
  prices: z.array(cents),
  /** Today's board; null in the lobby. */
  board: boardSchema.nullable(),
  /** Ticket prices in cents, by contract id. Empty in the lobby. */
  quotes: z.array(cents),
  /** Today's headlines. */
  news: z.array(newsViewSchema),
  account: accountViewSchema,
  /** Every ticket of the game, oldest first. */
  positions: z.array(positionViewSchema),
  /** The most recent command outcomes, oldest first. */
  receipts: z.array(receiptSchema),
  /** One entry per day whose closing bell has rung. */
  days: z.array(dayResultSchema),
  /** True when the stress setting is on: buying is disabled. */
  stress: z.boolean(),
  /**
   * Today's share prices so far, by company id, from index 0 to the current
   * priceIndex. Sent on connect, after a command and whenever the server
   * skipped frames; otherwise the client appends `prices` itself.
   */
  history: z.array(z.array(cents)).optional(),
  final: finalViewSchema.optional(),
});
export type Frame = z.infer<typeof frameSchema>;

/** Stress setting only: changed quotes between full frames. Ordered like frames. */
export const quotesMessageSchema = z.object({
  t: z.literal('quotes'),
  session: z.string(),
  rev: count,
  step: count,
  priceIndex: count,
  prices: z.array(cents),
  changes: z.array(z.tuple([count, cents])),
});
export type QuotesMessage = z.infer<typeof quotesMessageSchema>;

/** The answer to one command: its receipt and a fresh frame. */
export const replySchema = z.object({
  t: z.literal('reply'),
  receipt: receiptSchema,
  frame: frameSchema,
});
export type Reply = z.infer<typeof replySchema>;

export const serverErrorSchema = z.object({
  t: z.literal('error'),
  code: z.enum(['badMessage', 'noSession', 'serverFull', 'versionMismatch', 'tooManyCommands']),
  commandId: z.string().optional(),
});
export type ServerError = z.infer<typeof serverErrorSchema>;

export const serverMessageSchema = z.discriminatedUnion('t', [
  frameSchema,
  quotesMessageSchema,
  replySchema,
  serverErrorSchema,
]);
export type ServerMessage = z.infer<typeof serverMessageSchema>;

/** How many receipts a frame carries. */
export const FRAME_RECEIPTS = 20;

export interface FrameOrder {
  session: string;
  rev: number;
  step: number;
}

/**
 * The ordering rule for frames and quote batches: a different session always
 * wins; otherwise higher rev, then same rev and same-or-later step.
 */
export function isNewerFrame(held: FrameOrder | null, incoming: FrameOrder): boolean {
  if (held === null || held.session !== incoming.session) return true;
  if (incoming.rev !== held.rev) return incoming.rev > held.rev;
  return incoming.step >= held.step;
}

export function parseClientMessage(raw: unknown): ClientMessage | null {
  const result = clientMessageSchema.safeParse(raw);
  return result.success ? result.data : null;
}

export function parseServerMessage(raw: unknown): ServerMessage | null {
  const result = serverMessageSchema.safeParse(raw);
  return result.success ? result.data : null;
}
