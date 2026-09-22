import { useState } from "react";
import { restoredIntent, store } from "../../boot";
import type { Frame, Side } from "@strike-desk/shared/protocol";
import { lineStateOf } from "../../modules/connection/index";
import {
    useConnectionState,
    usePendingCommands,
    usePrice,
    useSeries,
    useScreenFrame,
    useView,
    views,
} from "../../store/hooks";
import { clock, percentChange, price, secondsFor } from "../format";
import { TicketPanel } from "../ticket/TicketPanel";
import { Bulb, CompanyTile, cx, GhostButton, Label } from "../ui";
import { LazyComparison } from "./LazyComparison";
import { NewsCard } from "./NewsCard";
import { CompanyList } from "./CompanyList";
import {
    companyOf,
    contractFor,
    contractIdFor,
    NO_PICK,
    pickFromTable,
} from "./pick";
import type { Pick } from "./pick";
import { PriceChart } from "./PriceChart";
import type { TargetLines } from "./PriceChart";
import { headlineFor, ticketToday, tipFor, twistShowing } from "./tips";

/**
 * The desk: today's news down the left, the selected company's chart in the
 * middle, the ticket on the right. One screen, no page scroll on a laptop.
 *
 * The selected company is the one whose chart shows and whose tickets the
 * builder offers. It starts on the day's first headline and follows the
 * player's taps; a new day starts it over.
 */

const PHASE_LABEL = {
    preBell: "Market opens in",
    open: "Closing bell in",
    debrief: "Next day in",
    lobby: "",
    final: "",
} as const;

/** What the tip box says while the numbers cannot be trusted. */
const LINE_TIPS = {
    stale: "No new prices for a moment. These numbers may be old, so buying and cashing out wait until fresh ones arrive.",
    offline:
        "The connection dropped. Reconnecting… your ticket and your cash are safe on the desk.",
} as const;

/**
 * The lines the chart draws: the ticket the player holds today when it is on
 * this company, otherwise the ticket being built. The break-even of a draft
 * is the server's own number for that contract, sent with every frame.
 */
function targetFor(
    frame: Frame,
    companyId: number,
    draftContractId: number | null,
): TargetLines | null {
    const ticket = ticketToday(frame);
    if (ticket !== null) {
        if (ticket.companyId !== companyId) return null;
        return {
            side: ticket.side,
            targetCents: ticket.targetCents,
            breakEvenCents: ticket.breakEvenCents,
        };
    }
    if (
        draftContractId === null ||
        companyOf(frame, draftContractId) !== companyId
    )
        return null;
    const draft = contractFor(frame, draftContractId);
    const breakEvenCents = frame.quoteBreakEvens[draftContractId];
    if (draft === null || breakEvenCents === undefined) return null;
    return { side: draft.side, targetCents: draft.targetCents, breakEvenCents };
}

function CompanyHeader({
    frame,
    companyId,
}: {
    frame: Frame;
    companyId: number;
}) {
    const company = frame.companies[companyId];
    const now = usePrice(companyId);
    const opening = useSeries(companyId).today[0] ?? null;
    const picking = frame.clock.phase === "preBell";
    const change =
        now !== null && opening !== null ? percentChange(opening, now) : null;
    const down = change !== null && change.startsWith("−");
    return (
        <div className="company-heading flex min-w-0 flex-1 items-center gap-3">
            <CompanyTile companyId={companyId} size="lg" />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="truncate text-[14px] text-muted">
                    {company?.name} ({company?.ticker}) makes{" "}
                    {company?.product ?? "things"}
                </div>
                <div className="flex min-w-0 flex-wrap items-baseline gap-x-2.5 whitespace-nowrap">
                    <span className="company-price w-[8ch] max-w-full shrink-0 font-display text-2xl leading-tight font-extrabold tabular-nums sm:text-[28px]">
                        {now === null ? "—" : price(now)}
                    </span>
                    <span
                        className={cx(
                            "company-change w-[14ch] shrink-0 text-[15px] font-bold tabular-nums",
                            picking
                                ? "text-muted"
                                : down
                                  ? "text-coral"
                                  : "text-mint",
                        )}
                    >
                        {picking
                            ? "opens here"
                            : change === null
                              ? ""
                              : `${change} today`}
                    </span>
                </div>
            </div>
        </div>
    );
}

export function Desk() {
    const frame = useScreenFrame("desk");
    const day = frame.clock.day;
    const headlines = frame.news.filter((item) => item.day === day);
    const picking = frame.clock.phase === "preBell";
    const ticket = ticketToday(frame);
    // The selection starts over on a new day, and again at the closing bell,
    // where the ticket's company is the one to look at.
    const selectionKey = `${String(day)}:${frame.clock.phase === "debrief" ? "bell" : "day"}`;
    const [choice, setChoice] = useState<{
        key: string;
        companyId: number;
    } | null>(null);
    const byDefault =
        (frame.clock.phase === "debrief" ? ticket?.companyId : undefined) ??
        (restoredIntent?.session === frame.session &&
        restoredIntent.day === day &&
        restoredIntent.command.t === "buy"
            ? companyOf(frame, restoredIntent.command.contractId)
            : null) ??
        headlines[0]?.companyId ??
        0;
    const selected =
        choice !== null && choice.key === selectionKey
            ? choice.companyId
            : byDefault;

    // The ticket being built: a side and a simple choice that follow the
    // player from company to company, or an exact row from the table. While
    // a buy or a cash-out is unanswered the pick is frozen, so what is on
    // screen is always the order that was pressed.
    const restoredBuy =
        restoredIntent?.session === frame.session &&
        restoredIntent.day === day &&
        restoredIntent.command.t === "buy"
            ? restoredIntent.command
            : null;
    const [pickState, setPickState] = useState<{ day: number; pick: Pick }>(
        () => ({
            day,
            pick:
                restoredBuy === null
                    ? NO_PICK
                    : pickFromTable(frame, restoredBuy.contractId),
        }),
    );
    const pick = pickState.day === day ? pickState.pick : NO_PICK;
    const orderInFlight = usePendingCommands().some(
        (pending) =>
            pending.command.t === "buy" || pending.command.t === "cashOut",
    );
    const setPick = (next: Pick): void => {
        if (orderInFlight) return;
        setPickState({ day, pick: next });
    };
    const select = (companyId: number): void => {
        if (orderInFlight) return;
        setChoice({ key: selectionKey, companyId });
        // An exact row from the table belongs to one company; on another, only the side and the choice carry over.
        if (
            pick.contractId !== null &&
            companyOf(frame, pick.contractId) !== companyId
        )
            setPick({ ...pick, contractId: null });
    };
    const chooseSide = (side: Side): void => {
        setPick({ side, choice: pick.choice ?? "close", contractId: null });
    };
    const chooseChoice = (simple: Pick["choice"]): void => {
        setPick({ side: pick.side ?? "up", choice: simple, contractId: null });
    };
    const pickContract = (contractId: number): void => {
        if (orderInFlight) return;
        const company = companyOf(frame, contractId);
        if (company !== null)
            setChoice({ key: selectionKey, companyId: company });
        setPick(pickFromTable(frame, contractId));
    };
    const draftContractId = contractIdFor(frame, selected, pick);
    const contract = contractFor(frame, draftContractId);

    // Comparison expands into the news rail and keeps a compact chart; the
    // ticket on the right stays put and a picked row lands on it.
    const [comparing, setComparing] = useState(frame.stress);
    const [opened, setOpened] = useState(frame.stress);
    const line = lineStateOf(useConnectionState().phase);
    const canCompare = frame.board !== null && frame.clock.phase !== "debrief";
    const showBoard = comparing && canCompare;
    const quiet = frame.companies
        .map((_, companyId) => companyId)
        .filter((companyId) => headlineFor(frame, companyId) === null);

    return (
        <main
            className={cx(
                "desk-layout mx-auto flex w-full max-w-[1920px] flex-col gap-4 p-4 lg:min-h-0 lg:grow lg:flex-row",
                showBoard && "desk-comparing",
            )}
        >
            <nav className="mobile-sections" aria-label="Desk sections">
                <a
                    href="#desk-news"
                    onClick={() => {
                        setComparing(false);
                    }}
                >
                    News
                </a>
                <a href="#desk-market">Market</a>
                <a href="#desk-ticket">Your ticket</a>
            </nav>
            <section
                id="desk-news"
                className={cx(
                    "news-rail flex flex-col gap-3 transition-opacity lg:min-h-0 lg:w-[290px] lg:shrink-0",
                    line !== "live" && "opacity-60",
                )}
                aria-label="Today's news"
            >
                <div className="flex h-[26px] shrink-0 items-center justify-between">
                    <h2 className="m-0 font-display text-base font-bold">
                        Today's news
                    </h2>
                    <span className="text-[13px] text-muted">Tap to view</span>
                </div>
                <CompanyList>
                    {headlines.map((news) => {
                        const company = frame.companies[news.companyId];
                        return (
                            <NewsCard
                                key={news.id}
                                news={news}
                                companyId={news.companyId}
                                name={company?.name ?? ""}
                                product={company?.product ?? ""}
                                selected={selected === news.companyId}
                                mine={ticket?.companyId === news.companyId}
                                picking={picking}
                                onSelect={() => {
                                    select(news.companyId);
                                }}
                            />
                        );
                    })}
                    {quiet.map((companyId) => (
                        <NewsCard
                            key={companyId}
                            news={null}
                            companyId={companyId}
                            name={frame.companies[companyId]?.name ?? ""}
                            product={frame.companies[companyId]?.product ?? ""}
                            picking={picking}
                            selected={selected === companyId}
                            mine={ticket?.companyId === companyId}
                            onSelect={() => {
                                select(companyId);
                            }}
                        />
                    ))}
                </CompanyList>
            </section>

            <section
                id="desk-market"
                className={cx(
                    "market-region flex min-w-0 flex-col gap-4 rounded-3xl border border-line bg-panel p-4 transition-opacity sm:p-5 lg:grow",
                    line !== "live" && "opacity-60",
                )}
            >
                <div className="flex items-center justify-between gap-x-3">
                    <CompanyHeader frame={frame} companyId={selected} />
                    <DeskClock />
                </div>

                {showBoard && (
                    <div className="flex items-center gap-3 text-sm text-muted">
                        <p className="m-0 min-w-0 flex-1 text-xs">
                            {headlineFor(frame, selected)?.title ??
                                "No news for this company today."}
                        </p>
                        <GhostButton
                            tone="line"
                            className="h-9 shrink-0 px-3 text-xs"
                            onClick={() => {
                                setComparing(false);
                            }}
                        >
                            Back to news
                        </GhostButton>
                        <a
                            className="ml-auto underline lg:hidden"
                            href="#desk-ticket"
                        >
                            Your ticket
                        </a>
                    </div>
                )}
                <ChartRegion
                    companyId={selected}
                    contractId={draftContractId}
                    compact={showBoard}
                />
                {opened && (
                    <div
                        className={cx(
                            "comparison-region min-h-0 flex-1",
                            !showBoard && "hidden",
                        )}
                    >
                        <LazyComparison
                            companyId={selected}
                            selectedContractId={draftContractId}
                            onPick={pickContract}
                            onChooseCompany={select}
                            companyLocked={orderInFlight}
                            stale={line !== "live"}
                        />
                    </div>
                )}

                {!showBoard && (
                    <div className="flex min-h-16 items-center gap-3.5 rounded-2xl bg-raised px-[18px] py-3">
                        <Bulb className="size-[26px] shrink-0 text-sun" />
                        <p className="m-0 grow text-[15px] leading-[1.45]">
                            {showBoard
                                ? "Every ticket on the board, repricing live. Click a column header to sort; pick a row to put it on your ticket."
                                : line === "live"
                                  ? tipFor(
                                        store.frame.get() ?? frame,
                                        selected,
                                        null,
                                    )
                                  : LINE_TIPS[line]}
                        </p>
                        {canCompare && (
                            <GhostButton
                                tone={showBoard ? "line" : "sun"}
                                className="h-10 shrink-0 px-3.5 text-[13px]"
                                aria-pressed={showBoard}
                                onClick={() => {
                                    setOpened(true);
                                    setComparing(!showBoard);
                                }}
                            >
                                {showBoard
                                    ? "Back to news"
                                    : "Compare contracts"}
                            </GhostButton>
                        )}
                    </div>
                )}
            </section>

            <section
                id="desk-ticket"
                className="ticket-region flex min-w-0 flex-col rounded-3xl border border-line bg-panel p-5 lg:w-[340px] lg:shrink-0 lg:overflow-y-auto"
                aria-label="Your ticket"
            >
                <TicketPanel
                    companyId={selected}
                    contract={contract}
                    pick={pick}
                    onPick={pickContract}
                    onChooseSide={chooseSide}
                    onChooseChoice={chooseChoice}
                />
            </section>
        </main>
    );
}

function DeskClock() {
    const value = useView(views.clock);
    if (value === null) return null;
    const seconds = secondsFor(value.stepsLeft, value.pace);
    return (
        <div
            className="flex shrink-0 flex-col items-end gap-0.5 rounded-2xl bg-raised px-3 py-2"
            role="timer"
        >
            <Label>{PHASE_LABEL[value.phase]}</Label>
            <span
                className={cx(
                    "w-[5ch] text-right font-display text-lg font-bold tabular-nums",
                    seconds < 15 && "text-coral",
                )}
            >
                {clock(seconds)}
            </span>
        </div>
    );
}
function ChartRegion({
    companyId,
    contractId,
    compact,
}: {
    companyId: number;
    contractId: number | null;
    compact: boolean;
}) {
    const frame = useScreenFrame("chart");
    return (
        <PriceChart
            key={companyId}
            frame={frame}
            companyId={companyId}
            compact={compact}
            target={targetFor(frame, companyId, contractId)}
            ticket={ticketToday(frame)}
            twist={twistShowing(frame, companyId)}
        />
    );
}
