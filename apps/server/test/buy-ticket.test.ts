import { describe, expect, it } from "vitest";
import { PROTOCOL_VERSION } from "@strike-desk/shared/engine";
import { startHarness } from "./harness";

describe("buying over the game socket", () => {
    it.each([false, true])(
        "fills at the server price with open market=%s and preserves the first answer",
        async (open) => {
            const h = await startHarness();
            try {
                const client = h.connect();
                await client.opened();
                client.send({ t: "hello", v: PROTOCOL_VERSION });
                const lobby = await client.nextFrame();
                client.send({ t: "start", pace: 1, commandId: "start-game" });
                let current = (await client.nextReply()).frame;
                if (open) {
                    client.send({
                        t: "openBell",
                        day: 1,
                        commandId: "open-market",
                    });
                    current = (await client.nextReply()).frame;
                }
                expect(current.account.canBuy).toBe(true);
                const contractId = current.quotes.findIndex(
                    (price) => price >= current.minTicketCents,
                );
                client.send({ t: "draft", contractId, spendCents: 100000 });
                // A pong confirms the server has read the preceding draft before sampling.
                const pong = new Promise<void>((resolve) => {
                    client.socket.once("pong", () => {
                        resolve();
                    });
                });
                client.socket.ping();
                await pong;
                h.sample();
                const quoted = await client.nextFrame();
                expect(quoted.draft).toMatchObject({
                    contractId,
                    spendCents: 100000,
                });
                const command = {
                    t: "buy",
                    commandId: "buy-once",
                    day: 1,
                    contractId,
                    spendCents: 100000,
                    seenPriceCents: 1000000,
                };
                client.send(command);
                const result = await client.next();
                expect(result.t).toBe("reply");
                if (result.t !== "reply")
                    throw new Error("buy did not receive an outcome");
                expect(result.receipt).toMatchObject({
                    kind: "buy",
                    commandId: command.commandId,
                    outcome: "accepted",
                });
                expect(result.frame.positions).toHaveLength(1);
                expect(result.frame.positions[0]).toMatchObject({
                    entryPriceCents: quoted.draft!.ticket!.priceCents,
                    quantity: quoted.draft!.ticket!.quantity,
                    costCents: quoted.draft!.ticket!.costCents,
                });
                expect(result.frame.account.cashCents).toBeLessThan(
                    lobby.account.cashCents,
                );
                expect(result.frame.account.canBuy).toBe(false);
                client.send({ ...command, contractId: 99999, spendCents: 1 });
                const duplicate = await client.nextReply();
                expect(duplicate.receipt).toEqual(result.receipt);
                expect(duplicate.frame.rev).toBe(result.frame.rev);
                expect(duplicate.frame.account).toEqual(result.frame.account);
                h.sample();
                const sampled = await client.nextFrame();
                expect(sampled.positions).toEqual(result.frame.positions);
                expect(sampled.receipts).toContainEqual(result.receipt);
                const resumed = h.connect();
                await resumed.opened();
                resumed.send({
                    t: "hello",
                    v: PROTOCOL_VERSION,
                    session: lobby.session,
                });
                const recovered = await resumed.nextFrame();
                expect(recovered.positions).toEqual(result.frame.positions);
                expect(recovered.receipts).toContainEqual(result.receipt);
                client.send({
                    t: "cashOut",
                    commandId: "cash-out",
                    positionId: result.frame.positions[0]!.id,
                });
                const cashed = await client.nextReply();
                expect(cashed.receipt).toMatchObject({
                    commandId: "cash-out",
                    kind: "cashOut",
                    outcome: "accepted",
                });
                expect(cashed.frame.positions[0]).toMatchObject({
                    status: "cashedOut",
                    exit: { kind: "cashOut" },
                });
                expect(cashed.frame.account.cashCents).toBe(
                    result.frame.account.cashCents +
                        cashed.frame.positions[0]!.exit!.proceedsCents,
                );
                // The same cash-out again is the same cash-out: the first receipt, and no second payment.
                client.send({
                    t: "cashOut",
                    commandId: "cash-out",
                    positionId: result.frame.positions[0]!.id,
                });
                const again = await client.nextReply();
                expect(again.receipt).toEqual(cashed.receipt);
                expect(again.frame.account.cashCents).toBe(
                    cashed.frame.account.cashCents,
                );
                h.clock.advance(190000);
                client.send(command);
                const late = await client.nextReply();
                expect(late.receipt).toEqual(result.receipt);
                expect(late.frame.clock.day).toBe(2);
                expect(late.frame.positions[0]?.status).toBe("cashedOut");
                h.sample();
                expect((await client.nextFrame()).account).toEqual(
                    late.frame.account,
                );
            } finally {
                await h.close();
            }
        },
    );

    it("leaves cash and the daily slot intact after rejection", async () => {
        const h = await startHarness();
        try {
            const client = h.connect();
            await client.opened();
            client.send({ t: "hello", v: PROTOCOL_VERSION });
            await client.nextFrame();
            client.send({ t: "start", pace: 1, commandId: "start-game" });
            const before = (await client.nextReply()).frame;
            client.send({
                t: "buy",
                commandId: "bad-contract",
                day: 1,
                contractId: 999999,
                spendCents: 100000,
                seenPriceCents: 1000,
            });
            const answer = await client.next();
            expect(answer.t).toBe("reply");
            if (answer.t !== "reply") throw new Error("missing rejection");
            expect(answer.receipt).toMatchObject({
                outcome: "rejected",
                reason: "unknownContract",
            });
            expect(answer.frame.account.cashCents).toBe(
                before.account.cashCents,
            );
            expect(answer.frame.account.canBuy).toBe(true);
            expect(answer.frame.positions).toEqual([]);
        } finally {
            await h.close();
        }
    });
});
