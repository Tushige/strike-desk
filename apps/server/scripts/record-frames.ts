import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  contractId,
  createSession,
  frameFor,
  frameSchema,
  handleCommand,
  BELL_STEP_IN_DAY,
  CONTENT_VERSION,
  DAY_STEPS,
  ENGINE_VERSION,
  FIRST_PLAYER_ID,
  PRE_BELL_STEPS,
  PROTOCOL_VERSION,
  STEP_MS,
} from '@strike-desk/shared/engine';
import type { Command, DraftRequest, Frame, Receipt, Session } from '@strike-desk/shared/engine';

/**
 * Records one whole game as thirteen labelled frames, for the web app's
 * display pieces to be built and tried against.
 *
 * It plays a fixed game on a fixed market through the same functions the
 * server calls, and writes down what they hand back: each frame is exactly
 * what that player's browser would have received at that moment, and nothing
 * else. It starts no server and opens no socket.
 *
 * Run it from anywhere in the repository:
 *
 *   pnpm --filter @strike-desk/server exec tsx scripts/record-frames.ts
 *
 * It writes apps/web/src/fixtures/recorded-game.json, one frame per line so
 * that a later recording can be reviewed line by line. Nothing but the game
 * goes into the file (no time, no path, no machine detail), so two runs give
 * the same bytes. Retake it after the rules or the prices change.
 *
 * The market is a fixed one that no live game uses: live games draw theirs
 * from the operating system's random source. Its market number appears in the
 * last frame, where every finished game shows it.
 */

const SEED = 4242424242;
const SESSION_ID = 'recorded-game';
const T0 = 1_000_000;
const OUTPUT = fileURLToPath(new URL('../../web/src/fixtures/recorded-game.json', import.meta.url));

type Phase = Frame['clock']['phase'];

interface Entry {
  label: string;
  frame: Frame;
}

/** A recording that does not fit the script: which label, and what was found. */
class Misfit extends Error {}

function at(step: number): number {
  return T0 + step * STEP_MS;
}

function main(): number {
  let session: Session = createSession(SESSION_ID, { seed: SEED, engine: ENGINE_VERSION, content: CONTENT_VERSION });
  let lastStep = 0;
  const entries: Entry[] = [];

  /** The player's full frame at a step. Time only moves forward, and the settled session is carried on. */
  function project(label: string, step: number, draft: DraftRequest | null = null): Frame {
    if (step < lastStep) throw new Misfit(`${label}: step ${step} is behind step ${lastStep}`);
    lastStep = step;
    const result = frameFor(session, FIRST_PLAYER_ID, at(step), { history: true, sections: 'full', draft });
    session = result.session;
    const parsed = frameSchema.safeParse(result.frame);
    if (!parsed.success) throw new Misfit(`${label}: the frame at step ${step} does not fit the frame schema`);
    return result.frame;
  }

  function record(label: string, step: number, phase: Phase, day: number, draft: DraftRequest | null = null): Frame {
    const frame = project(label, step, draft);
    if (frame.clock.phase !== phase || (phase !== 'final' && frame.clock.day !== day)) {
      throw new Misfit(`${label}: expected ${phase} day ${day}, found ${frame.clock.phase} day ${frame.clock.day}`);
    }
    entries.push({ label, frame });
    process.stdout.write(`${label} step ${step} ${frame.clock.phase} day ${frame.clock.day}\n`);
    return frame;
  }

  function send(label: string, step: number, command: Command): Receipt {
    if (step < lastStep) throw new Misfit(`${label}: step ${step} is behind step ${lastStep}`);
    lastStep = step;
    const handled = handleCommand(session, FIRST_PLAYER_ID, command, at(step));
    session = handled.session;
    return handled.receipt;
  }

  function mustAccept(label: string, receipt: Receipt): void {
    if (receipt.outcome !== 'accepted') throw new Misfit(`${label}: ${receipt.kind} was refused with ${receipt.reason ?? 'no reason'}`);
  }

  /** The id and this frame's price of one of a company's three named tickets. */
  function named(label: string, frame: Frame, companyId: number, side: 'up' | 'down'): { id: number; priceCents: number } {
    const board = frame.board;
    const company = board?.companies[companyId];
    if (board === null || company === undefined) throw new Misfit(`${label}: no board for company ${companyId}`);
    const targetIndex = side === 'up' ? company.simpleUp[0] : company.simpleDown[0];
    const id = contractId(board.targetsPerCompany, { companyId, targetIndex, side });
    const priceCents = frame.quotes[id];
    if (priceCents === undefined || priceCents <= 0) throw new Misfit(`${label}: ticket ${id} has no price`);
    return { id, priceCents };
  }

  try {
    record('lobby', 0, 'lobby', 0);
    mustAccept('start', send('start', 0, { t: 'start', commandId: 'rec-start-0001', pace: 1 }));

    // Day 1: look, build a ticket, buy Close UP on the first company.
    const first = named('day1-before-bell', record('day1-before-bell', 10, 'preBell', 1), 0, 'up');
    record('day1-draft', 20, 'preBell', 1, { contractId: first.id, spendCents: 10_000_000 });
    const seenDay1 = named('day1-bought', project('day1-bought', 30), 0, 'up');
    mustAccept(
      'day1-bought',
      send('day1-bought', 30, { t: 'buy', commandId: 'rec-buy-day1-01', day: 1, contractId: first.id, spendCents: 10_000_000, seenPriceCents: seenDay1.priceCents }),
    );
    record('day1-bought', 30, 'preBell', 1);
    record('day1-open', PRE_BELL_STEPS + 100, 'open', 1);

    // The first moment a day-1 headline is out, then a cash-out ten steps later.
    let revealStep = PRE_BELL_STEPS + 101;
    while (!project('day1-after-reveal', revealStep).news.some((item) => item.day === 1 && item.revealed)) {
      revealStep += 1;
      if (revealStep >= BELL_STEP_IN_DAY) throw new Misfit('day1-after-reveal: no day-1 headline was revealed before the bell');
    }
    record('day1-after-reveal', revealStep, 'open', 1);
    const cashOutStep = revealStep + 10;
    mustAccept('day1-cashed-out', send('day1-cashed-out', cashOutStep, { t: 'cashOut', commandId: 'rec-cash-day1-01', positionId: 'd1' }));
    record('day1-cashed-out', cashOutStep, 'open', 1);
    record('day1-debrief', BELL_STEP_IN_DAY + 10, 'debrief', 1);

    // Day 2: a buy over the cap is refused, then Close DOWN on the second company is held to the bell.
    const second = named('day2-before-bell', record('day2-before-bell', DAY_STEPS + 10, 'preBell', 2), 1, 'down');
    const beforeRefusal = project('day2-rejected', DAY_STEPS + 20);
    const refusal = send('day2-rejected', DAY_STEPS + 20, {
      t: 'buy',
      commandId: 'rec-buy-day2-01',
      day: 2,
      contractId: second.id,
      spendCents: beforeRefusal.account.capCents + 100_000,
      seenPriceCents: named('day2-rejected', beforeRefusal, 1, 'down').priceCents,
    });
    if (refusal.outcome !== 'rejected' || refusal.reason !== 'overCap') {
      throw new Misfit(`day2-rejected: expected a refusal with overCap, found ${refusal.outcome} ${refusal.reason ?? ''}`);
    }
    record('day2-rejected', DAY_STEPS + 20, 'preBell', 2);
    const seenDay2 = named('day2-bought', project('day2-bought', DAY_STEPS + 30), 1, 'down');
    mustAccept(
      'day2-bought',
      send('day2-bought', DAY_STEPS + 30, { t: 'buy', commandId: 'rec-buy-day2-02', day: 2, contractId: second.id, spendCents: 5_000_000, seenPriceCents: seenDay2.priceCents }),
    );
    record('day2-bought', DAY_STEPS + 30, 'preBell', 2);
    record('day2-held-to-bell', DAY_STEPS + BELL_STEP_IN_DAY + 10, 'debrief', 2);
    record('final', 5 * DAY_STEPS + 10, 'final', 5);
  } catch (error) {
    if (!(error instanceof Misfit)) throw error;
    process.stderr.write(`${error.message}\n`);
    return 1;
  }

  const head = JSON.stringify({ recordedWith: { protocol: PROTOCOL_VERSION, engine: ENGINE_VERSION, content: CONTENT_VERSION }, frames: [] });
  const lines = entries.map((entry) => JSON.stringify(entry));
  writeFileSync(OUTPUT, `${head.slice(0, -2)}\n${lines.join(',\n')}\n]}\n`);
  process.stdout.write(`recorded ${entries.length} frames\n`);
  return 0;
}

process.exitCode = main();
