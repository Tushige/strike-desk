import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, seedToMarketCode } from '@strike-desk/shared/engine';
import type { Frame, Pace } from '@strike-desk/shared/engine';
import { FIXED_SEEDS, startHarness } from './harness';
import { handleInbound } from '../src/door';
import type { Connection } from '../src/door';
import { createRegistry } from '../src/sessions';
import { createTokenBucket, createWindowCounter, LIMITS } from '../src/limits';
import { PUBLIC_MAX_BOARD_SIZE } from '../src/boardSizes';

const hello = { t: 'hello', v: PROTOCOL_VERSION };
const days = [1, 2, 3, 4, 5].map((day) => ({ day, startCents: 100000000, endCents: 100000000, changeCents: 0 }));

function preview(frame: Frame): void {
  // No trade: the initial million dollars remains one hundred million cents.
  expect(frame.account).toEqual({ cashCents: 100000000, worthCents: 100000000, capCents: 50000000, canBuy: false });
  expect(frame.positions).toEqual([]);
  expect(frame.days).toEqual(days.slice(0, frame.days.length));
  for (const news of frame.news) expect(news).not.toHaveProperty('wasTrue');
  if (frame.clock.phase !== 'final') {
    expect(frame).not.toHaveProperty('final');
    expect(JSON.stringify(frame)).not.toContain('marketCode');
    expect(JSON.stringify(frame)).not.toContain(String(FIXED_SEEDS[0]));
  }
}

describe('the five-day socket game', () => {
  it('returns the first refusal after a late retry and retains the caught-up session', async () => {
    const harness = await startHarness();
    try {
      const client = harness.connect(); await client.opened(); client.send(hello); await client.nextFrame();
      client.send({ t: 'start', pace: 1, commandId: 'repeat-start' }); await client.nextReply();
      const command = { t: 'nextDay', day: 1, commandId: 'repeat-refusal' };
      client.send(command); const first = await client.nextReply();
      expect(first.receipt).toMatchObject({ outcome: 'rejected', reason: 'wrongPhase', step: 0 });
      expect(first.frame.rev).toBe(2);
      harness.clock.advance(190000); // 950 logical steps, day two before its bell.
      client.send(command); const repeat = await client.nextReply();
      expect(repeat.receipt).toEqual(first.receipt);
      expect(repeat.frame).toMatchObject({ step: 950, rev: 2, clock: { day: 2, phase: 'preBell' } });
      expect(repeat.frame.days).toEqual(days.slice(0, 1));
      expect(repeat.frame.history?.[0]).toHaveLength(1);
      expect(repeat.frame.leadIn?.[0]).toHaveLength(40);
      harness.sample();
      const sampled = await client.nextFrame();
      expect(sampled).not.toHaveProperty('history');
      expect(sampled).not.toHaveProperty('leadIn');
      expect({ ...sampled, history: undefined, leadIn: undefined }).toEqual({ ...repeat.frame, history: undefined, leadIn: undefined });
      client.send({ ...command, commandId: 'new-wrong-day' });
      const refused = await client.nextReply();
      expect(refused.receipt).toMatchObject({ reason: 'wrongDay', step: 950 });
      expect(refused.frame.rev).toBe(3);
    } finally { await harness.close(); }
  });

  it('keeps malformed messages and preview trade attempts outside the game log', () => {
    const registry = createRegistry({ drawSeed: () => FIXED_SEEDS[0]!, drawId: () => 'preview-game', limits: LIMITS });
    const sent: string[] = [];
    const connection: Connection = {
      sessionId: null, playerId: null, messages: createWindowCounter(100, 10000),
      socket: { OPEN: 1, readyState: 1, bufferedAmount: 0, send: (text) => { sent.push(text); } },
    };
    const options = { registry, now: () => 0, maxBoardSize: PUBLIC_MAX_BOARD_SIZE, newSessions: createTokenBucket(30, 3) };
    const inbound = (message: unknown) => { handleInbound(options, connection, JSON.stringify(message)); };
    for (const secret of ['seed', 'marketCode', 'market']) {
      inbound({ ...hello, [secret]: 77 });
      expect(JSON.parse(sent.at(-1)!)).toEqual({ t: 'error', code: 'badMessage' });
      expect(registry.size).toBe(0);
    }
    inbound(hello);
    inbound({ t: 'start', pace: 1, commandId: 'preview-start' });
    const entry = registry.get('preview-game')!;
    const before = entry.session;
    for (const command of [
      { t: 'buy', commandId: 'preview-buy', day: 1, contractId: 0, spendCents: 100000, seenPriceCents: 100 },
      { t: 'cashOut', commandId: 'preview-cash-out', positionId: 'd1' },
    ]) {
      inbound(command);
      expect(JSON.parse(sent.at(-1)!)).toEqual({ t: 'error', code: 'badMessage', commandId: command.commandId });
      expect(entry.session).toBe(before);
    }
    handleInbound(options, connection, '{');
    expect(JSON.parse(sent.at(-1)!)).toEqual({ t: 'error', code: 'badMessage' });
    expect(entry.session).toBe(before);
    expect(before.game.players[0]?.log).toHaveLength(1);
    expect(before.game.players[0]?.rev).toBe(1);
    expect(before.game.players[0]?.receipts).toHaveLength(1);
  });

  it('uses every early bell once and shows the market number only after the fifth day', async () => {
    const harness = await startHarness();
    try {
      const client = harness.connect(); await client.opened(); client.send(hello);
      const lobby = await client.nextFrame(); preview(lobby);
      client.send({ t: 'start', pace: 3, commandId: 'game-start' });
      preview((await client.nextReply()).frame);
      // 900 steps per day: opening at +300, closing at +800, next day at +900.
      for (const [day, opening, bell, next] of [[1, 300, 800, 900], [2, 1200, 1700, 1800], [3, 2100, 2600, 2700], [4, 3000, 3500, 3600], [5, 3900, 4400, 4500]]) {
        for (const [t, step] of [['openBell', opening], ['skipToBell', bell], ['nextDay', next]] as const) {
          client.send({ t, day, commandId: `${t}-day-${String(day)}` });
          const reply = await client.nextReply();
          expect(reply.receipt.outcome).toBe('accepted');
          expect(reply.frame.step).toBe(step); preview(reply.frame);
          if (t !== 'openBell') expect(reply.frame.days).toEqual(days.slice(0, day));
          if (step === 4500) expect(reply.frame.final).toMatchObject({ finalCents: 100000000, changeCents: 0, marketCode: seedToMarketCode(FIXED_SEEDS[0]!) });
        }
      }
      harness.sample(); const final = await client.nextFrame();
      expect(final.days).toEqual(days);
      harness.clock.advance(1000000); harness.sample();
      expect(await client.nextFrame()).toEqual(final);
    } finally { await harness.close(); }
  });

  it.each([1, 3, 7.5] as const)('automatically crosses all bells at pace %s, including one late read', async (pace) => {
    async function play(late: boolean): Promise<Frame> {
      const harness = await startHarness();
      try {
        const client = harness.connect(); await client.opened(); client.send(hello); await client.nextFrame();
        client.send({ t: 'start', pace, commandId: 'timer-start' }); await client.nextReply();
        let elapsed = 0;
        // At 200ms per step, five full 900-step days end at 900000 game ms.
        for (const [gameMs, day, phase, count] of (late ? [[1000000, 5, 'final', 5]] : [
          [60000, 1, 'open', 0], [160000, 1, 'debrief', 1], [180000, 2, 'preBell', 1],
          [340000, 2, 'debrief', 2], [520000, 3, 'debrief', 3], [700000, 4, 'debrief', 4],
          [880000, 5, 'debrief', 5], [900000, 5, 'final', 5],
        ]) as [number, number, string, number][]) {
          const now = Math.ceil(gameMs / pace);
          harness.clock.advance(now - elapsed); elapsed = now; harness.sample();
          const frame = await client.nextFrame();
          expect(frame.clock).toMatchObject({ day, phase }); expect(frame.days).toEqual(days.slice(0, count)); preview(frame);
        }
        harness.sample(); return await client.nextFrame();
      } finally { await harness.close(); }
    }
    const continuous = await play(false); const late = await play(true);
    expect({ ...late, session: continuous.session }).toEqual(continuous);
  });

  it('shows identical prices and public news at matching logical steps across pace and sample schedules', async () => {
    async function sample(pace: Pace, extra: boolean) {
      const harness = await startHarness();
      try {
        const client = harness.connect(); await client.opened(); client.send(hello); await client.nextFrame();
        client.send({ t: 'start', pace, commandId: 'pace-start' }); await client.nextReply();
        const result: Pick<Frame, 'step' | 'prices' | 'news' | 'days' | 'account'>[] = [];
        let elapsed = 0;
        for (const step of [300, 450, 600, 750, 900, 1200, 1500, 1800, 2700, 3600, 4500]) {
          const target = step * 200 / pace;
          if (extra) { harness.clock.advance((target - elapsed) / 2); harness.sample(); await client.nextFrame(); }
          harness.clock.advance(extra ? (target - elapsed) / 2 : target - elapsed); elapsed = target;
          harness.sample(); const frame = await client.nextFrame();
          expect(frame.step).toBe(step);
          result.push({ step: frame.step, prices: frame.prices, news: frame.news, days: frame.days, account: frame.account });
        }
        return result;
      } finally { await harness.close(); }
    }
    expect(await sample(3, true)).toEqual(await sample(1, false));
    expect(await sample(7.5, true)).toEqual(await sample(1, true));
  });
});
