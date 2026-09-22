import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION } from '@strike-desk/shared/engine';
import { startHarness } from './harness';

describe('cashing out over the game socket', () => {
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
    } finally { await h.close(); }
  });
});
