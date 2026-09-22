import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, STEP_MS } from '@strike-desk/shared/engine';
import { startHarness } from './harness';

describe('cashing out over the game socket', () => {
  it('leaves stress quote deltas free of position and comparison fields', async () => {
    const h = await startHarness();
    try {
      const client = h.connect(); await client.opened();
      client.send({ t: 'hello', v: PROTOCOL_VERSION, board: 2500 }); await client.nextFrame();
      client.send({ t: 'start', commandId: 'stress-start', pace: 1 }); await client.nextReply();
      h.clock.advance(70000); h.sample(); const full = await client.nextFrame();
      expect(full.positions).toEqual([]);
      h.clock.advance(200); h.sample(); const delta = await client.next();
      expect(delta.t).toBe('quotes');
      expect(Object.keys(delta).sort()).toEqual(['changes', 'day', 'priceIndex', 'prices', 'rev', 'session', 'step', 't']);
      expect(JSON.stringify(delta)).not.toContain('ifHeldCents');
    } finally { await h.close(); }
  });
  it.each([799, 800, 801])('handles two sockets and distinct repeated sales at receipt step %i through final', async (step) => {
    const h = await startHarness();
    try {
      const first = h.connect(); await first.opened();
      first.send({ t: 'hello', v: PROTOCOL_VERSION }); const lobby = await first.nextFrame();
      first.send({ t: 'start', commandId: 'boundary-start', pace: 1 }); await first.nextReply();
      h.clock.advance(798 * STEP_MS); h.sample(); const current = await first.nextFrame();
      const contractId = current.quotes.findIndex((price) => price >= current.minTicketCents && price <= 10000000);
      first.send({ t: 'buy', commandId: 'boundary-buy', day: 1, contractId, spendCents: 10000000, seenPriceCents: 10000000 });
      const bought = await first.nextReply(); expect(bought.receipt.outcome).toBe('accepted');
      const second = h.connect(); await second.opened();
      second.send({ t: 'hello', v: PROTOCOL_VERSION, session: lobby.session }); await second.nextFrame();
      h.clock.advance((step - 798) * STEP_MS);
      const command = { t: 'cashOut', commandId: 'shared-sale', positionId: bought.frame.positions[0]!.id };
      first.send(command); second.send(command);
      const [a, b] = await Promise.all([first.nextReply(), second.nextReply()]);
      expect(a.receipt).toEqual(b.receipt);
      expect(a.receipt).toMatchObject({ outcome: 'accepted', step });
      expect(a.frame.account).toEqual(b.frame.account);
      expect(a.frame.rev).toBe(b.frame.rev);
      expect(a.frame.positions[0]?.exit?.kind).toBe(step === 799 ? 'cashOut' : 'bell');
      expect(a.frame.positions[0]!.exit!.proceedsCents).toBeGreaterThan(0);
      expect(a.frame.receipts.filter((receipt) => receipt.kind === 'cashOut')).toHaveLength(1);
      second.send({ ...command, positionId: 'other-ticket' });
      const altered = await second.nextReply();
      expect(altered.receipt).toEqual(a.receipt); expect(altered.frame.rev).toBe(a.frame.rev);
      let revision = a.frame.rev;
      for (const commandId of ['distinct-one', 'distinct-two']) {
        first.send({ ...command, commandId }); const repeat = await first.nextReply();
        expect(repeat.receipt).toMatchObject(step === 799 ? { outcome: 'rejected', reason: 'alreadyClosed' } : { outcome: 'accepted' });
        expect(repeat.frame.rev).toBe(++revision);
        expect(repeat.frame.account).toEqual(a.frame.account);
      }
      h.clock.advance((4500 - step) * STEP_MS);
      first.send({ ...command, commandId: 'final-sale' }); const final = await first.nextReply();
      expect(final.frame.clock.phase).toBe('final');
      expect(final.receipt).toMatchObject(step === 799 ? { outcome: 'rejected', reason: 'alreadyClosed' } : { outcome: 'accepted' });
      expect(final.frame.account.cashCents).toBe(a.frame.account.cashCents);
      expect(final.frame.positions[0]?.exit).toEqual(a.frame.positions[0]?.exit);
      first.send({ ...command, commandId: 'final-unknown', positionId: 'unknown' });
      expect((await first.nextReply()).receipt).toMatchObject({ outcome: 'rejected', reason: 'unknownPosition' });
      h.sample(); const sampled = await first.nextFrame();
      expect(sampled.account.cashCents).toBe(a.frame.account.cashCents);
    } finally { await h.close(); }
  });
  it.each([false, true])('pays once and keeps the day running with open market=%s', async (open) => {
    const h = await startHarness();
    try {
      const client = h.connect(); await client.opened();
      client.send({ t: 'hello', v: PROTOCOL_VERSION }); const lobby = await client.nextFrame();
      client.send({ t: 'start', pace: 1, commandId: 'start-game' }); let current = (await client.nextReply()).frame;
      if (open) {
        client.send({ t: 'openBell', day: 1, commandId: 'open-market' }); current = (await client.nextReply()).frame;
      }
      const contractId = current.quotes.findIndex((price) => price >= current.minTicketCents);
      client.send({ t: 'buy', commandId: 'buy-once', day: 1, contractId, spendCents: 100000, seenPriceCents: 1000000 });
      const bought = await client.nextReply();
      expect(bought.receipt.outcome).toBe('accepted');
      const position = bought.frame.positions[0]!;
      const command = { t: 'cashOut', commandId: 'sell-once', positionId: position.id };
      client.send(command); const result = await client.next();
      expect(result.t).toBe('reply');
      if (result.t !== 'reply') throw new Error('cash out did not receive a receipt');
      expect(result.receipt).toMatchObject({ kind: 'cashOut', commandId: command.commandId, outcome: 'accepted', positionId: position.id });
      const sold = result.frame.positions[0]!;
      expect(sold).toMatchObject({ id: position.id, status: 'cashedOut', exit: { kind: 'cashOut', proceedsCents: position.valueCents }, ifHeldCents: position.valueCents });
      expect(result.frame.account.cashCents).toBeGreaterThan(bought.frame.account.cashCents);
      expect(result.frame.account.canBuy).toBe(false);
      expect(result.frame.clock).toEqual(bought.frame.clock);
      for (const repeat of [command, { ...command, positionId: 'another-position' }]) {
        client.send(repeat); const duplicate = await client.nextReply();
        expect(duplicate.receipt).toEqual(result.receipt);
        expect(duplicate.frame.account).toEqual(result.frame.account);
        expect(duplicate.frame.rev).toBe(result.frame.rev);
      }
      h.sample(); const sampled = await client.nextFrame();
      expect(sampled.positions).toEqual(result.frame.positions);
      expect(sampled.receipts).toContainEqual(result.receipt);
      const resumed = h.connect(); await resumed.opened();
      resumed.send({ t: 'hello', v: PROTOCOL_VERSION, session: lobby.session });
      const recovered = await resumed.nextFrame();
      expect(recovered.positions).toEqual(result.frame.positions);
      expect(recovered.receipts).toContainEqual(result.receipt);
      expect(recovered.account).toEqual(result.frame.account);
      h.clock.advance((800 - recovered.step) * STEP_MS);
      h.sample(); const bell = await client.nextFrame(); await resumed.nextFrame();
      expect(bell.positions[0]?.ifHeldCents).toBeTypeOf('number');
      expect(bell.positions[0]?.exit).toEqual(sold.exit);
      expect(bell.account.cashCents).toBe(result.frame.account.cashCents);
      h.clock.advance(150 * STEP_MS); h.sample();
      const laterDay = await client.nextFrame(); const resumedLater = await resumed.nextFrame();
      expect(laterDay.clock.day).toBe(2);
      expect(laterDay.positions[0]?.ifHeldCents).toBe(bell.positions[0]?.ifHeldCents);
      expect(resumedLater.positions).toEqual(laterDay.positions);
      expect(laterDay.positions[0]?.exit).toEqual(sold.exit);
      expect(laterDay.account.cashCents).toBe(result.frame.account.cashCents);
    } finally { await h.close(); }
  });
});
