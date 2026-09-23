import { describe, expect, it } from "vitest";
import {
    FIRST_PLAYER_ID,
    PROTOCOL_VERSION,
    isOffered,
    parseServerMessage,
    playerOf,
    seedToMarketCode,
} from "@strike-desk/shared/engine";
import type { BuyCommand, Frame, Pace } from "@strike-desk/shared/engine";
import { handle } from "../src/modules/command-path/index";
import {
    frameAt,
    msAtStep,
    quotedAt,
    sessionAt,
    tradableTicket,
} from "./contracts/sessionAt";
import { FIXED_SEEDS, startHarness } from "./harness";
import { handleInbound } from "../src/door";
import type { Connection } from "../src/door";
import { createRegistry } from "../src/sessions";
import { createTokenBucket, createWindowCounter, LIMITS } from "../src/limits";
import { PUBLIC_MAX_BOARD_SIZE } from "../src/boardSizes";

const hello = { t: "hello", v: PROTOCOL_VERSION };
const days = [1, 2, 3, 4, 5].map((day) => ({
    day,
    startCents: 100000000,
    endCents: 100000000,
    changeCents: 0,
}));

function preview(frame: Frame): void {
    // No trade: the initial million dollars remains one hundred million cents.
    expect(frame.account).toEqual({
        cashCents: 100000000,
        worthCents: 100000000,
        capCents: 50000000,
        canBuy: frame.clock.phase === "preBell" || frame.clock.phase === "open",
    });
    expect(frame.positions).toEqual([]);
    expect(frame.days).toEqual(days.slice(0, frame.days.length));
    for (const news of frame.news) {
        if (frame.clock.phase === 'debrief' || frame.clock.phase === 'final') expect(news.wasTrue).toBeTypeOf('boolean');
        else expect(news).not.toHaveProperty('wasTrue');
    }
    if (frame.clock.phase !== "final") {
        expect(frame).not.toHaveProperty("final");
        expect(JSON.stringify(frame)).not.toContain("marketCode");
        expect(JSON.stringify(frame)).not.toContain(String(FIXED_SEEDS[0]));
    }
}

describe("the five-day socket game", () => {
    it("returns the first refusal after a late retry and retains the caught-up session", async () => {
        const harness = await startHarness();
        try {
            const client = harness.connect();
            await client.opened();
            client.send(hello);
            await client.nextFrame();
            client.send({ t: "start", pace: 1, commandId: "repeat-start" });
            await client.nextReply();
            const command = {
                t: "nextDay",
                day: 1,
                commandId: "repeat-refusal",
            };
            client.send(command);
            const first = await client.nextReply();
            expect(first.receipt).toMatchObject({
                outcome: "rejected",
                reason: "wrongPhase",
                step: 0,
            });
            expect(first.frame.rev).toBe(2);
            harness.clock.advance(190000); // 950 logical steps, day two before its bell.
            client.send(command);
            const repeat = await client.nextReply();
            expect(repeat.receipt).toEqual(first.receipt);
            expect(repeat.frame).toMatchObject({
                step: 950,
                rev: 2,
                clock: { day: 2, phase: "preBell" },
            });
            expect(repeat.frame.days).toEqual(days.slice(0, 1));
            expect(repeat.frame.history?.[0]).toHaveLength(1);
            expect(repeat.frame.leadIn?.[0]).toHaveLength(40);
            harness.sample();
            const sampled = await client.nextFrame();
            expect(sampled).not.toHaveProperty("history");
            expect(sampled).not.toHaveProperty("leadIn");
            expect({
                ...sampled,
                history: undefined,
                leadIn: undefined,
            }).toEqual({
                ...repeat.frame,
                history: undefined,
                leadIn: undefined,
            });
            client.send({ ...command, commandId: "new-wrong-day" });
            const refused = await client.nextReply();
            expect(refused.receipt).toMatchObject({
                reason: "wrongDay",
                step: 950,
            });
            expect(refused.frame.rev).toBe(3);
        } finally {
            await harness.close();
        }
    });

    it("keeps malformed messages outside the game log", () => {
        const registry = createRegistry({
            drawSeed: () => FIXED_SEEDS[0]!,
            drawId: () => "preview-game",
            limits: LIMITS,
        });
        const sent: string[] = [];
        const connection: Connection = {
            sessionId: null,
            playerId: null,
            messages: createWindowCounter(100, 10000),
            socket: {
                OPEN: 1,
                readyState: 1,
                bufferedAmount: 0,
                send: (text) => {
                    sent.push(text);
                },
            },
        };
        const options = {
            registry,
            now: () => 0,
            maxBoardSize: PUBLIC_MAX_BOARD_SIZE,
            newSessions: createTokenBucket(30, 3),
        };
        const inbound = (message: unknown) => {
            handleInbound(options, connection, JSON.stringify(message));
        };
        for (const secret of ["seed", "marketCode", "market"]) {
            inbound({ ...hello, [secret]: 77 });
            expect(JSON.parse(sent.at(-1)!)).toEqual({
                t: "error",
                code: "badMessage",
            });
            expect(registry.size).toBe(0);
        }
        inbound(hello);
        inbound({ t: "start", pace: 1, commandId: "preview-start" });
        const entry = registry.get("preview-game")!;
        const before = entry.session;
        for (const command of [
            {
                t: "buy",
                commandId: "malformed-buy",
                day: 1,
                contractId: 0,
                spendCents: -1,
                seenPriceCents: 100,
            },
            { t: "cashOut", commandId: "malformed-cash-out", positionId: 7 },
        ]) {
            inbound(command);
            expect(JSON.parse(sent.at(-1)!)).toEqual({
                t: "error",
                code: "badMessage",
            });
            expect(JSON.parse(sent.at(-1)!)).toEqual({
                t: "error",
                code: "badMessage",
            });
            expect(entry.session).toBe(before);
        }
        handleInbound(options, connection, "{");
        expect(JSON.parse(sent.at(-1)!)).toEqual({
            t: "error",
            code: "badMessage",
        });
        expect(entry.session).toBe(before);
        expect(before.game.players[0]?.log).toHaveLength(1);
        expect(before.game.players[0]?.rev).toBe(1);
        expect(before.game.players[0]?.receipts).toHaveLength(1);
    });

    it("uses every early bell once and shows the market number only after the fifth day", async () => {
        const harness = await startHarness();
        try {
            const client = harness.connect();
            await client.opened();
            client.send(hello);
            const lobby = await client.nextFrame();
            preview(lobby);
            client.send({ t: "start", pace: 3, commandId: "game-start" });
            preview((await client.nextReply()).frame);
            // 900 steps per day: opening at +300, closing at +800, next day at +900.
            for (const [day, opening, bell, next] of [
                [1, 300, 800, 900],
                [2, 1200, 1700, 1800],
                [3, 2100, 2600, 2700],
                [4, 3000, 3500, 3600],
                [5, 3900, 4400, 4500],
            ]) {
                for (const [t, step] of [
                    ["openBell", opening],
                    ["skipToBell", bell],
                    ["nextDay", next],
                ] as const) {
                    client.send({
                        t,
                        day,
                        commandId: `${t}-day-${String(day)}`,
                    });
                    const reply = await client.nextReply();
                    expect(reply.receipt.outcome).toBe("accepted");
                    expect(reply.frame.step).toBe(step);
                    preview(reply.frame);
                    if (t !== "openBell")
                        expect(reply.frame.days).toEqual(days.slice(0, day));
                    if (step === 4500)
                        expect(reply.frame.final).toMatchObject({
                            finalCents: 100000000,
                            changeCents: 0,
                            marketCode: seedToMarketCode(FIXED_SEEDS[0]!),
                        });
                }
            }
            harness.sample();
            const final = await client.nextFrame();
            expect(final.days).toEqual(days);
            harness.clock.advance(1000000);
            harness.sample();
            expect(await client.nextFrame()).toEqual(final);
        } finally {
            await harness.close();
        }
    });

    it.each([1, 3, 7.5] as const)(
        "automatically crosses all bells at pace %s, including one late read",
        async (pace) => {
            async function play(late: boolean): Promise<Frame> {
                const harness = await startHarness();
                try {
                    const client = harness.connect();
                    await client.opened();
                    client.send(hello);
                    await client.nextFrame();
                    client.send({ t: "start", pace, commandId: "timer-start" });
                    await client.nextReply();
                    let elapsed = 0;
                    // At 200ms per step, five full 900-step days end at 900000 game ms.
                    for (const [gameMs, day, phase, count] of (late
                        ? [[1000000, 5, "final", 5]]
                        : [
                              [60000, 1, "open", 0],
                              [160000, 1, "debrief", 1],
                              [180000, 2, "preBell", 1],
                              [340000, 2, "debrief", 2],
                              [520000, 3, "debrief", 3],
                              [700000, 4, "debrief", 4],
                              [880000, 5, "debrief", 5],
                              [900000, 5, "final", 5],
                          ]) as [number, number, string, number][]) {
                        const now = Math.ceil(gameMs / pace);
                        harness.clock.advance(now - elapsed);
                        elapsed = now;
                        harness.sample();
                        const frame = await client.nextFrame();
                        expect(frame.clock).toMatchObject({ day, phase });
                        expect(frame.days).toEqual(days.slice(0, count));
                        preview(frame);
                    }
                    harness.sample();
                    return await client.nextFrame();
                } finally {
                    await harness.close();
                }
            }
            const continuous = await play(false);
            const late = await play(true);
            expect({ ...late, session: continuous.session }).toEqual(
                continuous,
            );
        },
    );

    it("shows identical prices and public news at matching logical steps across pace and sample schedules", async () => {
        async function sample(pace: Pace, extra: boolean) {
            const harness = await startHarness();
            try {
                const client = harness.connect();
                await client.opened();
                client.send(hello);
                await client.nextFrame();
                client.send({ t: "start", pace, commandId: "pace-start" });
                await client.nextReply();
                const result: Pick<
                    Frame,
                    "step" | "prices" | "news" | "days" | "account"
                >[] = [];
                let elapsed = 0;
                for (const step of [
                    300, 450, 600, 750, 900, 1200, 1500, 1800, 2700, 3600, 4500,
                ]) {
                    const target = (step * 200) / pace;
                    if (extra) {
                        harness.clock.advance((target - elapsed) / 2);
                        harness.sample();
                        await client.nextFrame();
                    }
                    harness.clock.advance(
                        extra ? (target - elapsed) / 2 : target - elapsed,
                    );
                    elapsed = target;
                    harness.sample();
                    const frame = await client.nextFrame();
                    expect(frame.step).toBe(step);
                    result.push({
                        step: frame.step,
                        prices: frame.prices,
                        news: frame.news,
                        days: frame.days,
                        account: frame.account,
                    });
                }
                return result;
            } finally {
                await harness.close();
            }
        }
        expect(await sample(3, true)).toEqual(await sample(1, false));
        expect(await sample(7.5, true)).toEqual(await sample(1, true));
    });
});

describe("authoritative buy boundaries", () => {
    it.each(["notOffered", "tooCheap"] as const)(
        "checks %s before invalid cash and tolerance",
        (reason) => {
            const fixture = sessionAt("open");
            const session =
                reason === "notOffered"
                    ? {
                          ...fixture.session,
                          market: {
                              ...fixture.session.market,
                              offeredPassedMoves: 0.4,
                          },
                      }
                    : fixture.session;
            const nowMs = msAtStep(799);
            const frame = frameAt(session, nowMs);
            const contractId = frame.quotes.findIndex((price, id) =>
                reason === "notOffered"
                    ? !isOffered(frame.board!, id)
                    : isOffered(frame.board!, id) &&
                      price < frame.minTicketCents,
            );
            expect(contractId).toBeGreaterThanOrEqual(0);
            const result = handle({
                session,
                playerId: FIRST_PLAYER_ID,
                nowMs,
                draft: null,
                command: {
                    t: "buy",
                    commandId: "invalid-ticket",
                    day: 1,
                    contractId,
                    spendCents: 100000001,
                    seenPriceCents: 1,
                },
            });
            expect(result.reply.receipt).toMatchObject({
                outcome: "rejected",
                reason,
            });
            expect(result.reply.frame.account.cashCents).toBe(100000000);
        },
    );

    it.each([true, false])(
        "settles a held ticket with a positive payout=%s only once across late reads and retries",
        (pays) => {
            const { session, nowMs } = sessionAt("beforeBell");
            const frame = frameAt(session, nowMs);
            const candidates = frame.quotes.flatMap((price, contractId) => {
                if (
                    price < frame.minTicketCents ||
                    !isOffered(frame.board!, contractId)
                )
                    return [];
                const command: BuyCommand = {
                    t: "buy",
                    commandId: "held-ticket",
                    day: 1,
                    contractId,
                    spendCents: 10000000,
                    seenPriceCents: price,
                };
                const bought = handle({
                    session,
                    playerId: FIRST_PLAYER_ID,
                    nowMs,
                    draft: null,
                    command,
                });
                const settled = frameAt(bought.session, msAtStep(800));
                const payout = settled.positions[0]?.exit?.proceedsCents;
                return bought.reply.receipt.outcome === "accepted" &&
                    payout !== undefined &&
                    payout > 0 === pays
                    ? [{ bought, command, settled, payout }]
                    : [];
            });
            expect(candidates.length).toBeGreaterThan(0);
            const { bought, command, settled, payout } = candidates[0]!;
            if (pays) expect(payout).toBeGreaterThan(0);
            else expect(payout).toBe(0);
            expect(settled.account.cashCents).toBe(
                bought.reply.frame.account.cashCents + payout,
            );
            let current = bought.session;
            for (const step of [800, 801, 950, 1800]) {
                const repeated = handle({
                    session: current,
                    playerId: FIRST_PLAYER_ID,
                    nowMs: msAtStep(step),
                    draft: null,
                    command,
                });
                expect(repeated.reply.receipt).toEqual(bought.reply.receipt);
                expect(repeated.reply.frame.account.cashCents).toBe(
                    settled.account.cashCents,
                );
                expect(repeated.reply.frame.positions[0]?.exit).toEqual(
                    settled.positions[0]?.exit,
                );
                expect(
                    playerOf(repeated.session.game, FIRST_PLAYER_ID).log,
                ).toHaveLength(2);
                current = repeated.session;
            }
        },
    );

    it("uses the server fill and logs a refused request only once before a fresh successful request", () => {
        const { session, nowMs } = sessionAt("beforeBell");
        const ticket = quotedAt(frameAt(session, nowMs), 1000);
        const command: BuyCommand = {
            t: "buy",
            commandId: "buy-too-small",
            day: 1,
            contractId: ticket.contractId,
            spendCents: 1,
            seenPriceCents: 10000,
        };
        const refused = handle({
            session,
            playerId: FIRST_PLAYER_ID,
            command,
            nowMs,
            draft: null,
        });
        expect(refused.reply.receipt).toMatchObject({
            outcome: "rejected",
            reason: "spendTooSmall",
        });
        expect(playerOf(refused.session.game, FIRST_PLAYER_ID)).toMatchObject({
            cashCents: 100000000,
            rev: 2,
            positions: [],
        });
        expect(
            playerOf(refused.session.game, FIRST_PLAYER_ID).log,
        ).toHaveLength(2);
        const repeat = handle({
            session: refused.session,
            playerId: FIRST_PLAYER_ID,
            command: { ...command, spendCents: 2500 },
            nowMs,
            draft: null,
        });
        expect(repeat.reply.receipt).toEqual(refused.reply.receipt);
        expect(repeat.session).toBe(refused.session);
        const bought = handle({
            session: repeat.session,
            playerId: FIRST_PLAYER_ID,
            command: { ...command, commandId: "buy-fresh", spendCents: 2500 },
            nowMs,
            draft: null,
        });
        expect(bought.reply.receipt.outcome).toBe("accepted");
        expect(bought.reply.frame.positions[0]).toMatchObject({
            entryPriceCents: 1000,
            quantity: 2,
            costCents: 2000,
        });
        expect(bought.reply.frame.account).toMatchObject({
            cashCents: 99998000,
            canBuy: true,
        });
        expect(playerOf(bought.session.game, FIRST_PLAYER_ID).log).toHaveLength(
            3,
        );
    });

    it.each([
        ["lobby", 2, true, 999999, 100000001, 1, "notStarted"],
        ["final", 1, true, 999999, 100000001, 1, "gameOver"],
        ["open", 2, true, 999999, 100000001, 1, "wrongDay"],
        ["debrief", 1, true, 999999, 100000001, 1, "stressMode"],
        ["debrief", 1, false, 999999, 100000001, 1, "marketClosed"],
        ["open", 1, false, 999999, 100000001, 1, "unknownContract"],
        ["open", 1, false, null, 100000001, 1, "notEnoughCash"],
        ["open", 1, false, null, 50000001, 1, "overCap"],
        ["open", 1, false, null, 1, 1, "priceMoved"],
        ["open", 1, false, null, 1, 10000, "spendTooSmall"],
    ] as const)(
        "preserves refusal priority at %s, day %s, stress %s, contract %s, spend %s, seen %s",
        (moment, day, stress, contract, spendCents, seenPriceCents, reason) => {
            const fixture = sessionAt(
                moment === "final" ? "open" : moment,
                stress ? { targetsPerCompany: 209 } : {},
            );
            const nowMs = moment === "final" ? msAtStep(4500) : fixture.nowMs;
            const contractId =
                contract ??
                quotedAt(frameAt(fixture.session, nowMs), 1000).contractId;
            const result = handle({
                session: fixture.session,
                playerId: FIRST_PLAYER_ID,
                nowMs,
                draft: null,
                command: {
                    t: "buy",
                    commandId: "priority-buy",
                    day,
                    contractId,
                    spendCents,
                    seenPriceCents,
                },
            });
            expect(result.reply.receipt).toMatchObject({
                outcome: "rejected",
                reason,
            });
            expect(result.reply.frame.positions).toEqual([]);
            expect(result.reply.frame.account.cashCents).toBe(100000000);
            expect(
                playerOf(result.session.game, FIRST_PLAYER_ID).log.at(-1)
                    ?.command.commandId,
            ).toBe("priority-buy");
        },
    );

    it("checks three used purchases before an unknown contract, including a cashed-out position", () => {
        const { session, nowMs } = sessionAt("open");
        const ticket = quotedAt(frameAt(session, nowMs), 1000);
        let bought = handle({
            session,
            playerId: FIRST_PLAYER_ID,
            nowMs,
            draft: null,
            command: {
                t: "buy",
                commandId: "first-ticket",
                day: 1,
                contractId: ticket.contractId,
                spendCents: 2500,
                seenPriceCents: 1000,
            },
        });
        for (const commandId of ['second-ticket', 'third-ticket']) {
            bought = handle({ session: bought.session, playerId: FIRST_PLAYER_ID, nowMs, draft: null,
                command: { t: 'buy', commandId, day: 1, contractId: ticket.contractId, spendCents: 2500, seenPriceCents: 1000 } });
            expect(bought.reply.receipt.outcome).toBe('accepted');
        }
        const closed = handle({
            session: bought.session,
            playerId: FIRST_PLAYER_ID,
            nowMs,
            draft: null,
            command: {
                t: "cashOut",
                commandId: "settled-ticket",
                positionId: "d1",
            },
        });
        for (const current of [bought.session, closed.session]) {
            const result = handle({
                session: current,
                playerId: FIRST_PLAYER_ID,
                nowMs,
                draft: null,
                command: {
                    t: "buy",
                    commandId: "another-ticket",
                    day: 1,
                    contractId: 999999,
                    spendCents: 100000001,
                    seenPriceCents: 1,
                },
            });
            expect(result.reply.receipt).toMatchObject({
                outcome: "rejected",
                reason: "alreadyBought",
            });
            expect(result.reply.frame.positions).toHaveLength(3);
        }
    });

    it.each([799, 800, 801])(
        "judges an actual socket buy at logical step %s",
        async (step) => {
            const h = await startHarness();
            try {
                const client = h.connect();
                await client.opened();
                client.send(hello);
                await client.nextFrame();
                client.send({ t: "start", pace: 1, commandId: "bell-start" });
                await client.nextReply();
                h.clock.advance(step * 200);
                h.sample();
                const before = await client.nextFrame();
                const ticket = tradableTicket(before);
                client.send({
                    t: "buy",
                    commandId: "bell-buy",
                    day: 1,
                    contractId: ticket.contractId,
                    spendCents: 10000000,
                    seenPriceCents: ticket.priceCents,
                });
                const result = await client.nextReply();
                expect(result.receipt).toMatchObject(
                    step === 799
                        ? { outcome: "accepted", step: 799 }
                        : { outcome: "rejected", reason: "marketClosed", step },
                );
                if (step === 799) {
                    expect(result.frame.positions).toHaveLength(1);
                    h.clock.advance(200);
                    h.sample();
                    const settled = await client.nextFrame();
                    expect(settled.positions[0]).toMatchObject({
                        status: "settled",
                        exit: { kind: "bell" },
                    });
                    h.sample();
                    expect((await client.nextFrame()).account).toEqual(
                        settled.account,
                    );
                } else {
                    expect(result.frame.positions).toEqual([]);
                    expect(result.frame.account.cashCents).toBe(100000000);
                }
            } finally {
                await h.close();
            }
        },
    );

    it("charges a command shared by two real sockets only once", async () => {
        const h = await startHarness();
        try {
            const first = h.connect();
            await first.opened();
            first.send(hello);
            const lobby = await first.nextFrame();
            first.send({ t: "start", pace: 1, commandId: "two-tabs-start" });
            const frame = (await first.nextReply()).frame;
            const second = h.connect();
            await second.opened();
            second.send({ ...hello, session: lobby.session });
            await second.nextFrame();
            const ticket = tradableTicket(frame);
            const command = {
                t: "buy",
                commandId: "shared-buy",
                day: 1,
                contractId: ticket.contractId,
                spendCents: 100000,
                seenPriceCents: ticket.priceCents,
            };
            first.send(command);
            second.send(command);
            const [one, two] = await Promise.all([
                first.nextReply(),
                second.nextReply(),
            ]);
            expect(one.receipt.outcome).toBe("accepted");
            expect(two.receipt).toEqual(one.receipt);
            expect(two.frame.account).toEqual(one.frame.account);
            expect(two.frame.positions).toEqual(one.frame.positions);
            expect(two.frame.positions).toHaveLength(1);
            expect(two.frame.rev).toBe(2);
        } finally {
            await h.close();
        }
    });

    it("keeps exhausted door requests anonymous and outside cash, positions, receipts and input log", () => {
        const registry = createRegistry({
            drawSeed: () => FIXED_SEEDS[0]!,
            drawId: () => "limited-game",
            limits: LIMITS,
        });
        const sent: string[] = [];
        const connection: Connection = {
            sessionId: null,
            playerId: null,
            messages: createWindowCounter(2, 10000),
            socket: {
                OPEN: 1,
                readyState: 1,
                bufferedAmount: 0,
                send: (text) => {
                    sent.push(text);
                },
            },
        };
        const options = {
            registry,
            now: () => 0,
            maxBoardSize: PUBLIC_MAX_BOARD_SIZE,
            newSessions: createTokenBucket(30, 3),
        };
        for (const message of [
            hello,
            { t: "start", pace: 1, commandId: "limit-start" },
        ])
            handleInbound(options, connection, JSON.stringify(message));
        const before = registry.get("limited-game")!.session;
        const startReply = parseServerMessage(JSON.parse(sent.at(-1)!));
        if (startReply?.t !== "reply") throw new Error("missing start reply");
        const contractId = startReply.frame.quotes.findIndex(
            (price, id) =>
                price >= startReply.frame.minTicketCents &&
                isOffered(startReply.frame.board!, id),
        );
        handleInbound(
            options,
            connection,
            JSON.stringify({
                t: "buy",
                commandId: "limited-buy",
                day: 1,
                contractId,
                spendCents: 100000,
                seenPriceCents: 1000000,
            }),
        );
        expect(JSON.parse(sent.at(-1)!)).toEqual({
            t: "error",
            code: "tooManyCommands",
        });
        expect(registry.get("limited-game")!.session).toBe(before);
        expect(playerOf(before.game, FIRST_PLAYER_ID)).toMatchObject({
            cashCents: 100000000,
            positions: [],
            rev: 1,
        });
        expect(playerOf(before.game, FIRST_PLAYER_ID).log).toHaveLength(1);
        expect(playerOf(before.game, FIRST_PLAYER_ID).receipts).toHaveLength(1);
    });
});
