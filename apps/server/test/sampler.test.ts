import { afterEach, describe, expect, it, vi } from "vitest";
import {
    CAST,
    CONTENT_VERSION,
    ENGINE_VERSION,
    FIRST_PLAYER_ID,
    PROTOCOL_VERSION,
    boardFor,
    buildMarket,
    frameSchema,
    handleCommand,
    marketDay,
    parseServerMessage,
    quoteAt,
    sharePriceCents,
} from "@strike-desk/shared/engine";
import type { Frame } from "@strike-desk/shared/engine";
import { LIMITS } from "../src/limits";
import type { FrameSocket } from "../src/sampler";
import { offerFrame, sampleSessions } from "../src/sampler";
import { drawSessionId } from "../src/seed";
import { createRegistry } from "../src/sessions";
import type { Harness, TestClient } from "./harness";
import { FIXED_SEEDS, startHarness } from "./harness";

const HELLO = { t: "hello", v: PROTOCOL_VERSION };
const start = (commandId: string, pace = 1) => ({
    t: "start",
    commandId,
    pace,
});

/** Real milliseconds at pace 1 from `start` to the opening bell of day 1. */
const PRE_BELL_MS = 60_000;
const SAMPLE_MS = 200;

let harness: Harness | null = null;

async function boot(
    overrides: Parameters<typeof startHarness>[0] = {},
): Promise<Harness> {
    harness = await startHarness(overrides);
    return harness;
}

afterEach(async () => {
    vi.restoreAllMocks();
    await harness?.close();
    harness = null;
});

/** Connect, say hello, and take the lobby frame. */
async function join(
    to: Harness,
): Promise<{ client: TestClient; lobby: Frame }> {
    const client = to.connect();
    await client.opened();
    client.send(HELLO);
    return { client, lobby: await client.nextFrame() };
}

/** One hand-driven sample, and the frame it produced. */
async function sampleFrame(from: Harness, client: TestClient): Promise<Frame> {
    from.sample();
    return client.nextFrame();
}

/**
 * Thin: the lobby has no board and no ticket price; a started game has the
 * whole board and 252 ticket prices, each with its real value, its hope value
 * and its break-even, plus three public headlines. Trade sections stay empty.
 */
function expectThin(frame: Frame): void {
    expect(frame).toMatchObject({ positions: [], stress: false });
    expect(frame.receipts).toHaveLength(frame.clock.phase === "lobby" ? 0 : 1);
    for (const day of frame.days)
        expect(day).toMatchObject({
            startCents: 100000000,
            endCents: 100000000,
            changeCents: 0,
        });
    if (frame.clock.phase === "lobby") {
        expect(frame).toMatchObject({
            news: [],
            board: null,
            quotes: [],
            quoteReals: [],
            quoteHopes: [],
            quoteBreakEvens: [],
        });
    } else {
        expect(frame.news).toHaveLength(3);
        expect(frame.news.map((news) => news.trust).sort()).toEqual([1, 2, 3]);
        for (const news of frame.news) {
            expect(news.day).toBe(frame.clock.day);
            expect(news).not.toHaveProperty("wasTrue");
            if (news.revealed)
                expect(news.revealIndex).toBeLessThanOrEqual(
                    frame.clock.priceIndex,
                );
            else expect(news).not.toHaveProperty("revealIndex");
        }
        expect(frame.board?.targetsPerCompany).toBe(21);
        expect(
            frame.board?.companies.map((company) => company.targets.length),
        ).toEqual([21, 21, 21, 21, 21, 21]);
        expect([
            frame.quotes.length,
            frame.quoteReals.length,
            frame.quoteHopes.length,
            frame.quoteBreakEvens.length,
        ]).toEqual([252, 252, 252, 252]);
        frame.quotes.forEach((price, id) => {
            expect(Number.isInteger(price) && price >= 0).toBe(true);
            expect({
                id,
                sum:
                    (frame.quoteReals[id] ?? NaN) +
                    (frame.quoteHopes[id] ?? NaN),
            }).toEqual({ id, sum: price });
        });
    }
    expect(
        frame.companies.map((company) => Object.keys(company).sort()),
    ).toEqual(Array.from({ length: 6 }, () => ["name", "product", "ticker"]));
    expect(frame.account).toEqual({
        cashCents: 100_000_000,
        worthCents: 100_000_000,
        capCents: 50_000_000,
        canBuy: frame.clock.phase === "preBell" || frame.clock.phase === "open",
    });
    if (frame.history !== undefined) {
        expect(frame.history).toHaveLength(6);
        frame.history.forEach((path, companyId) => {
            expect(path).toHaveLength(frame.clock.priceIndex + 1);
            expect(path.at(-1)).toBe(frame.prices[companyId]);
            expect(path.every(Number.isInteger)).toBe(true);
        });
    }
    expect("final" in frame).toBe(frame.clock.phase === "final");
    expect(frame.prices).toHaveLength(6);
    for (const price of frame.prices)
        expect(Number.isInteger(price)).toBe(true);
    expect(frameSchema.parse(frame)).toEqual(frame);
}

function pricesAt(seed: number, day: number, priceIndex: number): number[] {
    const market = buildMarket({
        seed,
        engine: ENGINE_VERSION,
        content: CONTENT_VERSION,
    });
    return marketDay(market, day).paths.map((path) =>
        sharePriceCents(path[priceIndex] ?? NaN),
    );
}

/** The market's own ticket prices at one point of a day, by contract id. */
function ticketPricesAt(
    seed: number,
    day: number,
    priceIndex: number,
): number[] {
    const market = buildMarket({
        seed,
        engine: ENGINE_VERSION,
        content: CONTENT_VERSION,
    });
    const board = boardFor(market, day);
    return Array.from(
        { length: 252 },
        (_unused, id) =>
            quoteAt(market, day, priceIndex, board, id)?.priceCents ?? NaN,
    );
}

describe("hello and start", () => {
    it("hello gives a lobby frame: six whole-cent prices, everything else empty, the clock stopped", async () => {
        const { lobby } = await join(await boot());
        expectThin(lobby);
        expect(lobby).toMatchObject({
            rev: 0,
            step: 0,
            clock: {
                phase: "lobby",
                day: 0,
                stepsLeft: 0,
                priceIndex: 0,
                pace: null,
            },
        });
        expect(lobby.prices).toEqual(
            CAST.map((company) => sharePriceCents(company.startPrice)),
        );
        expect(lobby.session).toHaveLength(22);
    });

    it("the clock stays stopped until start, however much time passes", async () => {
        const running = await boot();
        const { client, lobby } = await join(running);
        running.clock.advance(10 * 60_000);
        const later = await sampleFrame(running, client);
        expect(later).toEqual(lobby);
    });

    it("start at pace 1 is accepted and answered with its receipt and a thin frame", async () => {
        const running = await boot();
        const { client, lobby } = await join(running);
        client.send(start("start-0001"));
        const reply = await client.nextReply();
        expect(reply.receipt).toEqual({
            commandId: "start-0001",
            kind: "start",
            step: 0,
            outcome: "accepted",
        });
        expectThin(reply.frame);
        expect(reply.frame).toMatchObject({
            session: lobby.session,
            rev: 1,
            step: 0,
            clock: { phase: "preBell", day: 1, pace: 1 },
        });
    });

    it("a resent start gets the original receipt again and changes nothing; another start is refused", async () => {
        const running = await boot();
        const { client } = await join(running);
        client.send(start("start-0001", 3));
        const first = await client.nextReply();
        running.clock.advance(SAMPLE_MS * 5);
        client.send(start("start-0001", 3));
        const again = await client.nextReply();
        expect(again.receipt).toEqual(first.receipt);
        expect(again.frame.rev).toBe(1);
        expect(again.frame.clock.pace).toBe(3);

        client.send(start("start-0002", 1));
        const refused = await client.nextReply();
        expect(refused.receipt).toMatchObject({
            commandId: "start-0002",
            outcome: "rejected",
            reason: "alreadyStarted",
        });
        expect(refused.frame.rev).toBe(2);
        expect(refused.frame.clock.pace).toBe(3);
    });

    it("a start before any hello is answered noSession with its id", async () => {
        const running = await boot();
        const client = running.connect();
        await client.opened();
        client.send(start("start-0001"));
        expect(await client.nextError()).toEqual({
            t: "error",
            code: "noSession",
            commandId: "start-0001",
        });
    });
});

describe("the sampler", () => {
    it("ten samples 200 ms apart give ten frames with a rising step and the same rev", async () => {
        const running = await boot();
        const { client } = await join(running);
        client.send(start("start-0001"));
        await client.nextReply();

        const frames: Frame[] = [];
        for (let i = 0; i < 10; i += 1) {
            running.clock.advance(SAMPLE_MS);
            frames.push(await sampleFrame(running, client));
        }
        expect(frames.map((frame) => frame.step)).toEqual([
            1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
        ]);
        expect(frames.map((frame) => frame.rev)).toEqual(
            Array.from({ length: 10 }, () => 1),
        );
        frames.forEach(expectThin);
        expect(client.waiting()).toBe(0);
    });

    it("a faster pace covers more steps per sample", async () => {
        const running = await boot();
        const { client } = await join(running);
        client.send(start("start-0001", 7.5));
        await client.nextReply();
        running.clock.advance(SAMPLE_MS * 2);
        expect((await sampleFrame(running, client)).step).toBe(15);
    });

    it("once the bell has opened the market, the six prices and the 252 ticket prices are the market's own, in whole cents", async () => {
        const running = await boot();
        const { client } = await join(running);
        client.send(start("start-0001"));
        await client.nextReply();
        const seed = FIXED_SEEDS[0] ?? NaN;

        running.clock.advance(PRE_BELL_MS - SAMPLE_MS);
        const stillShut = await sampleFrame(running, client);
        expect(stillShut.clock).toMatchObject({
            phase: "preBell",
            priceIndex: 0,
        });
        expect(stillShut.prices).toEqual(pricesAt(seed, 1, 0));
        expect(stillShut.quotes).toEqual(ticketPricesAt(seed, 1, 0));

        running.clock.advance(SAMPLE_MS * 2);
        const justOpen = await sampleFrame(running, client);
        expect(justOpen.clock).toMatchObject({
            phase: "open",
            day: 1,
            priceIndex: 1,
        });
        expect(justOpen.prices).toEqual(pricesAt(seed, 1, 1));

        running.clock.advance(SAMPLE_MS * 99);
        const later = await sampleFrame(running, client);
        expect(later.clock).toMatchObject({
            phase: "open",
            day: 1,
            priceIndex: 100,
        });
        expect(later.step).toBe(400);
        expect(later.prices).toEqual(pricesAt(seed, 1, 100));
        expect(later.prices).not.toEqual(justOpen.prices);
        expect(later.quotes).toEqual(ticketPricesAt(seed, 1, 100));
        expect(later.quotes).not.toEqual(stillShut.quotes);
        expect(later.rev).toBe(1);
        expectThin(later);
    });

    it("stays thin through the debrief, across a day boundary and on the final screen, and the step never resets", async () => {
        const running = await boot();
        const { client } = await join(running);
        client.send(start("start-0001", 7.5));
        await client.nextReply();
        const seed = FIXED_SEEDS[0] ?? NaN;
        // At this pace a step is 200 / 7.5 ms: 22 s, 34 s and 130 s after the start
        // land on step 825, step 1275 and past the end of the game.
        const seen: Frame[] = [];
        for (const advanceMs of [22_000, 12_000, 96_000]) {
            running.clock.advance(advanceMs);
            seen.push(await sampleFrame(running, client));
        }
        seen.forEach(expectThin);
        expect(seen.map((frame) => frame.step)).toEqual([825, 1275, 4500]);
        expect(seen.map((frame) => frame.clock.phase)).toEqual([
            "debrief",
            "open",
            "final",
        ]);
        expect(seen[1]?.clock).toMatchObject({ day: 2, priceIndex: 75 });
        expect(seen[1]?.prices).toEqual(pricesAt(seed, 2, 75));
        expect(seen[2]?.prices).toEqual(pricesAt(seed, 5, 500));
        expect(seen.map((frame) => frame.rev)).toEqual([1, 1, 1]);
    });

    it("two hellos are two sessions with two markets", async () => {
        const running = await boot();
        const one = await join(running);
        const two = await join(running);
        expect(one.lobby.session).not.toBe(two.lobby.session);

        one.client.send(start("start-0001"));
        two.client.send(start("start-0002"));
        await one.client.nextReply();
        await two.client.nextReply();
        running.clock.advance(PRE_BELL_MS + SAMPLE_MS * 100);
        running.sample();
        const first = await one.client.nextFrame();
        const second = await two.client.nextFrame();
        expect(first.prices).toEqual(pricesAt(FIXED_SEEDS[0] ?? NaN, 1, 100));
        expect(second.prices).toEqual(pricesAt(FIXED_SEEDS[1] ?? NaN, 1, 100));
        expect(first.prices).not.toEqual(second.prices);
    });

    it("runs on one timer however many games are going", async () => {
        const spy = vi.spyOn(globalThis, "setInterval");
        const running = await boot();
        const before = spy.mock.calls.length;
        for (let i = 0; i < 3; i += 1) {
            const { client } = await join(running);
            client.send(start(`start-000${i}`));
            await client.nextReply();
        }
        running.clock.advance(SAMPLE_MS);
        running.sample();
        expect(spy.mock.calls.length).toBe(before);
    });

    it("the sampling timer is one more interval, and none when it is switched off", async () => {
        const spy = vi.spyOn(globalThis, "setInterval");
        const off = await startHarness();
        const withoutSampler = spy.mock.calls.length;
        await off.close();
        spy.mockClear();

        const on = await boot({ sampleMs: 250 });
        expect(spy.mock.calls.length).toBe(withoutSampler + 1);
        expect(
            spy.mock.calls.filter(([, delay]) => delay === 250),
        ).toHaveLength(1);
        expect(() => on.app.sampleOnce(0)).not.toThrow();
    });

    it("the timer drives the same sampling pass", async () => {
        // A clock that moves one sample forward every time it is read, so the
        // frames do not depend on how fast this machine is. The test awaits
        // messages, never a duration.
        let nowMs = 0;
        const running = await boot({
            sampleMs: 5,
            now: () => (nowMs += SAMPLE_MS),
        });
        const { client } = await join(running);
        client.send(start("start-0001"));
        // The timer may have sent lobby frames already; the reply comes after them.
        let message = await client.next();
        while (message.t !== "reply") message = await client.next();
        const steps = [message.frame.step];
        for (let i = 0; i < 3; i += 1)
            steps.push((await client.nextFrame()).step);
        for (let i = 1; i < steps.length; i += 1)
            expect(steps[i]).toBeGreaterThan(steps[i - 1] ?? NaN);
    });
});

describe("offerFrame and sampleSessions", () => {
    function fakeSocket(
        fields: { open?: boolean; bufferedAmount?: number } = {},
    ): FrameSocket & { sent: string[] } {
        const sent: string[] = [];
        return {
            OPEN: 1,
            readyState: fields.open === false ? 3 : 1,
            bufferedAmount: fields.bufferedAmount ?? 0,
            sent,
            send(text: string) {
                sent.push(text);
            },
        };
    }

    it.each([1, 3, 7.5] as const)(
        "repairs actual indexes for one skipped socket at pace %s without sharing its draft",
        (pace) => {
            const registry = createRegistry({
                drawSeed: () => 77,
                drawId: () => "history-session",
                limits: LIMITS,
            });
            const entry = registry.create(0)!;
            registry.replace(
                entry.session.id,
                handleCommand(
                    entry.session,
                    FIRST_PLAYER_ID,
                    { t: "start", commandId: "history-start", pace },
                    0,
                ).session,
            );
            const ready = fakeSocket();
            const slow = fakeSocket();
            registry.attach(entry.session.id, FIRST_PLAYER_ID, ready);
            registry.attach(entry.session.id, FIRST_PLAYER_ID, slow);
            entry.drafts.set(slow, { contractId: 0, spendCents: 100000 });
            const stats = { sent: 0, skipped: 0 };
            const openMs = 60000 / pace;
            sampleSessions(registry, openMs, stats, 1500);
            const first = frameSchema.parse(JSON.parse(ready.sent.at(-1)!));
            expect(first.history?.[0]).toHaveLength(1);
            slow.bufferedAmount = 1;
            sampleSessions(registry, openMs + 200, stats, 1500);
            slow.bufferedAmount = 0;
            sampleSessions(registry, openMs + 400, stats, 1500);
            const healthy = frameSchema.parse(JSON.parse(ready.sent.at(-1)!));
            const repaired = frameSchema.parse(JSON.parse(slow.sent.at(-1)!));
            expect(repaired.history?.[0]).toHaveLength(
                repaired.clock.priceIndex + 1,
            );
            expect(repaired.history?.[0]?.at(-1)).toBe(repaired.prices[0]);
            expect(healthy.history === undefined).toBe(pace === 1);
            expect(repaired.draft?.spendCents).toBe(100000);
            expect(healthy).not.toHaveProperty("draft");
            expect(stats).toEqual({ sent: 5, skipped: 1 });
            registry.detach(entry.session.id, slow, openMs + 400);
            expect(entry.deliveries.has(slow)).toBe(false);
            expect(entry.drafts.has(slow)).toBe(false);
        },
    );

    it("repairs a skipped sale with its receipt, fixed payout and current held comparison", () => {
        const registry = createRegistry({
            drawSeed: () => 77,
            drawId: () => "sale-repair",
            limits: LIMITS,
        });
        const entry = registry.create(0)!;
        const ready = fakeSocket();
        const slow = fakeSocket();
        registry.attach(entry.session.id, FIRST_PLAYER_ID, ready);
        registry.attach(entry.session.id, FIRST_PLAYER_ID, slow);
        registry.replace(
            entry.session.id,
            handleCommand(
                entry.session,
                FIRST_PLAYER_ID,
                { t: "start", commandId: "repair-start", pace: 1 },
                0,
            ).session,
        );
        const stats = { sent: 0, skipped: 0 };
        sampleSessions(registry, 60000, stats, 1500);
        const before = frameSchema.parse(JSON.parse(ready.sent.at(-1)!));
        const contractId = before.quotes.findIndex(
            (price) => price >= before.minTicketCents && price <= 100000,
        );
        const bought = handleCommand(
            entry.session,
            FIRST_PLAYER_ID,
            {
                t: "buy",
                commandId: "repair-buy",
                day: 1,
                contractId,
                spendCents: 100000,
                seenPriceCents: 1000000,
            },
            60000,
        );
        expect(bought.receipt.outcome).toBe("accepted");
        registry.replace(entry.session.id, bought.session);
        sampleSessions(registry, 60000, stats, 1500);
        const open = frameSchema.parse(JSON.parse(ready.sent.at(-1)!))
            .positions[0]!;
        const sold = handleCommand(
            entry.session,
            FIRST_PLAYER_ID,
            { t: "cashOut", commandId: "repair-sale", positionId: open.id },
            60000,
        );
        expect(sold.receipt.outcome).toBe("accepted");
        registry.replace(entry.session.id, sold.session);
        slow.bufferedAmount = 1;
        const deliveredBeforeSale = slow.sent.length;
        sampleSessions(registry, 60200, stats, 1500);
        const paid = frameSchema.parse(JSON.parse(ready.sent.at(-1)!));
        expect(slow.sent).toHaveLength(deliveredBeforeSale);
        expect(paid.positions[0]).toMatchObject({
            status: "cashedOut",
            valueCents: open.valueCents,
            exit: { kind: "cashOut", proceedsCents: open.valueCents },
        });
        expect(paid.positions[0]?.ifHeldCents).toBeTypeOf("number");
        slow.bufferedAmount = 0;
        sampleSessions(registry, 64000, stats, 1500);
        const healthy = frameSchema.parse(JSON.parse(ready.sent.at(-1)!));
        const repaired = frameSchema.parse(JSON.parse(slow.sent.at(-1)!));
        expect(repaired.history?.[0]).toHaveLength(
            repaired.clock.priceIndex + 1,
        );
        expect(repaired.positions).toEqual(healthy.positions);
        expect(repaired.positions[0]?.ifHeldCents).toBeTypeOf("number");
        expect(repaired.positions[0]?.exit).toEqual(paid.positions[0]?.exit);
        expect(repaired.positions[0]?.valueCents).toBe(
            paid.positions[0]?.valueCents,
        );
        expect(repaired.positions[0]?.profitCents).toBe(
            paid.positions[0]?.profitCents,
        );
        expect(repaired.account).toEqual(paid.account);
        expect(repaired.receipts).toContainEqual(sold.receipt);
        expect(stats.skipped).toBe(1);
        expect(entry.deliveries.get(slow)?.repair).toBe(false);
    });

    it("keeps stress repair pending through deltas until the existing whole-frame deadline", () => {
        const registry = createRegistry({
            drawSeed: () => 77,
            drawId: () => "stress-history",
            limits: LIMITS,
        });
        const entry = registry.create(0, 209)!;
        registry.replace(
            entry.session.id,
            handleCommand(
                entry.session,
                FIRST_PLAYER_ID,
                { t: "start", commandId: "stress-start", pace: 1 },
                0,
            ).session,
        );
        const healthy = fakeSocket();
        const slow = fakeSocket();
        registry.attach(entry.session.id, FIRST_PLAYER_ID, healthy);
        registry.attach(entry.session.id, FIRST_PLAYER_ID, slow);
        const stats = { sent: 0, skipped: 0 };
        sampleSessions(registry, 60000, stats, 1500);
        slow.bufferedAmount = 1;
        sampleSessions(registry, 60200, stats, 1500);
        slow.bufferedAmount = 0;
        for (const now of [60400, 60600, 60800, 61000, 61200, 61400]) {
            sampleSessions(registry, now, stats, 1500);
            expect(JSON.parse(slow.sent.at(-1)!)).toHaveProperty("t", "quotes");
            expect(entry.deliveries.get(slow)?.repair).toBe(true);
        }
        sampleSessions(registry, 61600, stats, 1500);
        expect(
            healthy.sent.map((text) => parseServerMessage(JSON.parse(text))?.t),
        ).toEqual([
            "frame",
            "quotes",
            "quotes",
            "quotes",
            "quotes",
            "quotes",
            "quotes",
            "quotes",
            "frame",
        ]);
        const repaired = frameSchema.parse(JSON.parse(slow.sent.at(-1)!));
        expect(repaired.history?.[0]).toHaveLength(9);
        expect(entry.deliveries.get(slow)?.repair).toBe(false);
        // A missed whole frame is repaired at the next due whole frame, not by a delta.
        slow.bufferedAmount = 1;
        sampleSessions(registry, 63200, stats, 1500);
        slow.bufferedAmount = 0;
        sampleSessions(registry, 63400, stats, 1500);
        expect(JSON.parse(slow.sent.at(-1)!)).toHaveProperty("t", "quotes");
        expect(entry.deliveries.get(slow)?.repair).toBe(true);
        sampleSessions(registry, 64800, stats, 1500);
        expect(
            frameSchema.parse(JSON.parse(slow.sent.at(-1)!)).history?.[0],
        ).toHaveLength(25);
    });

    it.each([undefined, 209])(
        "carries history at phase boundaries and keeps quiet phases observable (targets %s)",
        (targets) => {
            const registry = createRegistry({
                drawSeed: () => 77,
                drawId: () => "phase-history",
                limits: LIMITS,
            });
            const entry = registry.create(0, targets)!;
            const socket = fakeSocket();
            registry.attach(entry.session.id, FIRST_PLAYER_ID, socket);
            const sample = (now: number) =>
                sampleSessions(registry, now, { sent: 0, skipped: 0 }, 1500);
            sample(0);
            sample(200);
            expect(socket.sent).toHaveLength(2);
            registry.replace(
                entry.session.id,
                handleCommand(
                    entry.session,
                    FIRST_PLAYER_ID,
                    { t: "start", commandId: "phase-start", pace: 1 },
                    0,
                ).session,
            );
            for (const [now, length] of [
                [400, 1],
                [60000, 1],
                [160000, 501],
                [180000, 1],
                [900000, 501],
            ]) {
                sample(now!);
                expect(
                    frameSchema.parse(JSON.parse(socket.sent.at(-1)!))
                        .history?.[0],
                ).toHaveLength(length!);
            }
            const before = socket.sent.length;
            sample(901600);
            expect(socket.sent).toHaveLength(before + 1);
            expect(
                frameSchema.parse(JSON.parse(socket.sent.at(-1)!)).clock.phase,
            ).toBe("final");
        },
    );

    it("sends to an open socket with nothing waiting", () => {
        const socket = fakeSocket();
        expect(offerFrame(socket, "frame-text")).toBe("sent");
        expect(socket.sent).toEqual(["frame-text"]);
    });

    it("skips a socket that still has bytes waiting, and queues nothing", () => {
        const socket = fakeSocket({ bufferedAmount: 1 });
        expect(offerFrame(socket, "frame-text")).toBe("skipped");
        expect(socket.sent).toEqual([]);
    });

    it("leaves a socket that is not open alone", () => {
        const socket = fakeSocket({ open: false });
        expect(offerFrame(socket, "frame-text")).toBe("closed");
        expect(socket.sent).toEqual([]);
    });

    it("one pass: one frame text per session, offered to each of its sockets, counted", () => {
        // Four sockets on one session, which is one more than the service allows,
        // because what is being exercised here is the offer to each of them.
        const registry = createRegistry({
            drawSeed: () => 77,
            drawId: drawSessionId,
            limits: { ...LIMITS, maxSocketsPerSession: 4 },
        });
        const entry = registry.create(0);
        const idle = registry.create(0);
        if (entry === null || idle === null)
            throw new Error("the registry refused a session it has room for");
        const ready = fakeSocket();
        const alsoReady = fakeSocket();
        const backedUp = fakeSocket({ bufferedAmount: 4096 });
        const gone = fakeSocket({ open: false });
        for (const socket of [ready, alsoReady, backedUp, gone])
            registry.attach(entry.session.id, FIRST_PLAYER_ID, socket);

        const stats = { sent: 0, skipped: 0 };
        sampleSessions(registry, 5_000, stats, LIMITS.stressFullFrameMs);
        expect(stats).toEqual({ sent: 2, skipped: 1 });
        expect(ready.sent).toHaveLength(1);
        expect(alsoReady.sent).toEqual(ready.sent);
        expect(backedUp.sent).toEqual([]);
        expect(gone.sent).toEqual([]);
        const frame = frameSchema.parse(JSON.parse(ready.sent[0] ?? ""));
        expect(frame.session).toBe(entry.session.id);
        expect(frame.session).not.toBe(idle.session.id);
        expectThin(frame);

        sampleSessions(registry, 5_200, stats, LIMITS.stressFullFrameMs);
        expect(stats).toEqual({ sent: 4, skipped: 2 });
    });
});

describe("cash-out goes through the command path", () => {
    it("a cash-out with no ticket to sell is answered with a rejected receipt and changes no money", async () => {
        const running = await boot();
        const { client } = await join(running);
        client.send(start("start-0001"));
        await client.nextReply();
        // Inside the open market, where a cash-out would otherwise be taken.
        running.clock.advance(PRE_BELL_MS + SAMPLE_MS * 10);
        const before = await sampleFrame(running, client);

        client.send({
            t: "cashOut",
            commandId: "nothing-to-sell",
            positionId: "d1",
        });
        const reply = await client.nextReply();
        expect(reply.receipt).toMatchObject({
            commandId: "nothing-to-sell",
            kind: "cashOut",
            outcome: "rejected",
            reason: "unknownPosition",
        });

        const after = await sampleFrame(running, client);
        // The receipt is kept (a repeat gets the same answer), so the revision moves; the money does not.
        expect(after.account).toEqual(before.account);
        expect(after.positions).toEqual([]);
        expect(after.receipts).toContainEqual(reply.receipt);
    });

    it("openBell opens the current day and later reads keep that jump", async () => {
        const running = await boot();
        const { client } = await join(running);
        client.send(start("start-0001"));
        await client.nextReply();
        client.send({ t: "openBell", commandId: "refused-openBell", day: 1 });
        expect((await client.nextReply()).receipt).toMatchObject({
            kind: "openBell",
            outcome: "accepted",
        });
        running.clock.advance(SAMPLE_MS);
        expect(await sampleFrame(running, client)).toMatchObject({
            rev: 2,
            step: 301,
            clock: { phase: "open" },
        });
    });

    it.each(["skipToBell", "nextDay"])(
        "%s before the opening bell gets a stored refusal",
        async (t) => {
            const running = await boot();
            const { client } = await join(running);
            client.send(start("start-0001"));
            await client.nextReply();
            client.send({ t, commandId: `early-${t}`, day: 1 });
            const reply = await client.nextReply();
            expect(reply.receipt).toMatchObject({
                kind: t,
                outcome: "rejected",
                reason: "wrongPhase",
                step: 0,
            });
            expect(reply.frame).toMatchObject({
                rev: 2,
                clock: { phase: "preBell" },
            });
            expect(reply.frame.receipts).toContainEqual(reply.receipt);
        },
    );
});

describe("bad input at the door", () => {
    const BAD_TEXTS: [string, string][] = [
        ["text that is not JSON", "{"],
        ["an empty string", ""],
        ["null", "null"],
        ["an array", "[]"],
        ["an unknown kind", '{"t":"nope"}'],
        [
            "a hello that tries to pick the seed",
            JSON.stringify({ ...HELLO, seed: 77 }),
        ],
        [
            "a start with a pace that does not exist",
            JSON.stringify(start("start-0001", 2)),
        ],
    ];

    it.each(BAD_TEXTS)(
        "%s is answered badMessage and the socket stays usable",
        async (_name, text) => {
            const running = await boot();
            const client = running.connect();
            await client.opened();
            client.sendText(text);
            expect(await client.nextError()).toEqual({
                t: "error",
                code: "badMessage",
            });
            client.send(HELLO);
            expect((await client.nextFrame()).clock.phase).toBe("lobby");
        },
    );

    it("a message over the size limit closes that socket only", async () => {
        const running = await boot();
        const { client: bystander } = await join(running);
        const client = running.connect();
        await client.opened();
        client.sendText("x".repeat(5000));
        expect(await client.closed()).toBe(1009);
        expect((await sampleFrame(running, bystander)).clock.phase).toBe(
            "lobby",
        );
    });
});

describe("the session registry", () => {
    it("makes a session only when asked, and remembers when its last socket left", () => {
        const registry = createRegistry({
            drawSeed: () => 4242424242,
            drawId: drawSessionId,
            limits: LIMITS,
        });
        expect(registry.size).toBe(0);
        const entry = registry.create(1_000);
        if (entry === null)
            throw new Error("the registry refused a session it has room for");
        expect(registry.size).toBe(1);
        expect(entry.session.market.identity).toEqual({
            seed: 4242424242,
            engine: ENGINE_VERSION,
            content: CONTENT_VERSION,
        });
        expect(entry.session.clock).toBeNull();
        expect(registry.get(entry.session.id)).toBe(entry);
        expect(registry.get("someone-else")).toBeUndefined();
        // Idle from the moment it was made: nobody has ever been connected to it.
        expect(entry.idleSinceMs).toBe(1_000);

        const socket = {
            OPEN: 1,
            readyState: 1,
            bufferedAmount: 0,
            send: () => undefined,
        };
        expect(registry.attach("someone-else", FIRST_PLAYER_ID, socket)).toBe(
            "noSession",
        );
        expect(registry.attach(entry.session.id, FIRST_PLAYER_ID, socket)).toBe(
            "attached",
        );
        expect(entry.sockets.size).toBe(1);
        expect(entry.idleSinceMs).toBeNull();
        registry.detach(entry.session.id, socket, 9_000);
        expect(entry.sockets.size).toBe(0);
        expect(entry.idleSinceMs).toBe(9_000);
        expect([...registry.entries()]).toEqual([entry]);
    });

    it("a session with no socket is not sampled", () => {
        const registry = createRegistry({
            drawSeed: () => 77,
            drawId: drawSessionId,
            limits: LIMITS,
        });
        const entry = registry.create(0);
        if (entry === null)
            throw new Error("the registry refused a session it has room for");
        const before = entry.session;
        const stats = { sent: 0, skipped: 0 };
        sampleSessions(registry, 1_000, stats, LIMITS.stressFullFrameMs);
        expect(stats).toEqual({ sent: 0, skipped: 0 });
        expect(entry.session).toBe(before);
    });
});
