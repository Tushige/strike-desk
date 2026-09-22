import { memo, useEffect, useId, useReducer, useRef, useState, useSyncExternalStore } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { formatCents } from '@strike-desk/shared/money';
import type { Side } from '@strike-desk/shared/protocol';
import { createDraftPacer } from './draftPacer';
import { createLatestState, createTicketHandlers } from './handlers';
import { breakEvenStopIndex, buyBlocker, cashOutBlocker, commandKindOf, initialTicketState, quoteEchoes, retryAllowed, stopAt, ticketReducer } from './machine';
import type { CommandKind, TicketNotice, TicketSnapshot, TicketState } from './machine';
import type { OpenTicket, OrderTicketProps, SimpleChoice, TicketAccount, TicketContract, TicketDraft, TicketPreviewProps, TicketQuote } from './ports';
import {
  ACCEPTED_WORDS,
  BLOCKER_WORDS,
  BREAK_EVEN_LABEL,
  BUY_LABEL,
  CAP_LABEL,
  CASH_LABEL,
  CASH_OUT_BLOCKER_WORDS,
  CASH_OUT_LABEL,
  CHECKING_WORDS,
  CHOICES_LABEL,
  CHOICE_WORDS,
  COST_LABEL,
  HOPE_VALUE_WORDS,
  LIMIT_LABEL,
  LINE_WORDS,
  LOST_WORDS,
  NOTHING_PICKED,
  OPEN_TICKET_TITLE,
  PANEL_TITLE,
  PENDING_WORDS,
  PER_TICKET_LABEL,
  PRICE_LABEL,
  PROFIT_IF_WORDS,
  PROFIT_SO_FAR_LABEL,
  QUANTITY_LABEL,
  REAL_VALUE_WORDS,
  REJECTED_LEAD,
  REJECTED_NO_REASON,
  REJECT_WORDS,
  RETRY_HINT,
  RETRY_LABEL,
  SIDE_HINTS,
  SIDE_SHORT,
  SIDE_WORDS,
  SPEND_LABEL,
  TARGET_WORDS,
  WHAT_IF_LABEL,
  WHAT_IF_RESULT_LABEL,
  WORTH_NOW_LABEL,
} from './words';

/**
 * The order ticket: the one form that buys today's ticket and cashes it out.
 * It draws what the rules in `machine.ts` say and sends what they build.
 * Every number on it is the server's, shown as sent; the only thing of the
 * player's is what they chose.
 *
 * Two parts. `TicketView` draws a state and a snapshot and has no rules in
 * it. `OrderTicket` holds the machine and feeds it what the server and the
 * desk say. What a press does is in `handlers.ts`, with no React in it: its
 * `onPress` is the only caller of `pressOf` and the only place `submit` is
 * called.
 */

const SIDES: readonly Side[] = ['up', 'down'];

/** The colour of a side's word. A side is always said in words too, never by colour alone. */
const SIDE_TEXT: Record<Side, string> = { up: 'text-up', down: 'text-down' };

const LABEL = 'text-[0.6875rem] uppercase tracking-[0.12em] text-muted-foreground';
const FOCUS = 'outline-none focus-visible:ring-2 focus-visible:ring-ring';
const OPTION =
  `rounded-md border border-border px-2 py-1.5 text-left text-sm motion-safe:transition-colors ${FOCUS} ` +
  'hover:bg-accent aria-pressed:border-ring aria-pressed:bg-accent disabled:opacity-50 disabled:hover:bg-transparent';
const ACTION = `w-full rounded-md bg-gold px-3 py-2.5 text-base font-medium text-background motion-safe:transition-opacity ${FOCUS} disabled:opacity-40`;

function noticeWords(notice: TicketNotice): string {
  if (notice.kind === 'lost') return LOST_WORDS;
  if (notice.kind === 'accepted') return ACCEPTED_WORDS[notice.of];
  return `${REJECTED_LEAD} ${notice.reason === null ? REJECTED_NO_REASON : REJECT_WORDS[notice.reason]}`;
}

function statusWords(state: TicketState): string | null {
  if (state.form === 'pending') return PENDING_WORDS;
  if (state.form === 'checking') return CHECKING_WORDS;
  return state.notice === null ? null : noticeWords(state.notice);
}

/** A profit is said in the UP colour and a loss in the DOWN colour; the sign says it too. */
function profitText(profitCents: number): { text: string; className: string } {
  if (profitCents > 0) return { text: `+${formatCents(profitCents)}`, className: 'text-up' };
  if (profitCents < 0) return { text: formatCents(profitCents), className: 'text-down' };
  return { text: formatCents(profitCents), className: 'text-foreground' };
}

function Figure({ label, children, className }: { label: ReactNode; children: ReactNode; className?: string }): ReactElement {
  return (
    <div className="min-w-0">
      <dt className={LABEL}>{label}</dt>
      <dd className={`m-0 tabular-nums ${className ?? ''}`}>{children}</dd>
    </div>
  );
}

/** The game's word, then the grown-up word, quieter. */
function TwoWords({ words }: { words: { game: string; real: string } }): ReactElement {
  return (
    <>
      {words.game} <span className="normal-case tracking-normal">({words.real})</span>
    </>
  );
}

function TicketHead({ ticket }: { ticket: Pick<TicketContract, 'companyName' | 'ticker' | 'side' | 'targetCents'> }): ReactElement {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <div className="min-w-0">
        <p className="m-0 truncate text-base font-medium">{ticket.companyName}</p>
        <p className="m-0 text-xs tracking-wider text-muted-foreground">{ticket.ticker}</p>
      </div>
      <div className="text-right">
        <p className={`m-0 text-sm font-medium ${SIDE_TEXT[ticket.side]}`}>
          {SIDE_WORDS[ticket.side].game} <span className="font-normal text-muted-foreground">({SIDE_WORDS[ticket.side].real})</span>
        </p>
        <p className="m-0 text-sm tabular-nums">
          {TARGET_WORDS.game} {formatCents(ticket.targetCents)} <span className="text-muted-foreground">({TARGET_WORDS.real})</span>
        </p>
      </div>
    </div>
  );
}

function Choices({
  choices,
  chosenId,
  locked,
  onPick,
}: {
  choices: readonly SimpleChoice[];
  chosenId: number | null;
  locked: boolean;
  onPick: (contractId: number) => void;
}): ReactElement | null {
  if (choices.length === 0) return null;
  return (
    <fieldset className="m-0 min-w-0 border-0 p-0" disabled={locked}>
      <legend className={`mb-1.5 p-0 ${LABEL}`}>{CHOICES_LABEL}</legend>
      <div className="grid gap-1.5">
        {SIDES.map((side) => (
          <div key={side} role="group" aria-label={`${SIDE_WORDS[side].game}. ${SIDE_HINTS[side]}`} className="grid grid-cols-[3.25rem_repeat(3,minmax(0,1fr))] items-center gap-1.5">
            <span className={`text-sm font-medium ${SIDE_TEXT[side]}`} title={SIDE_HINTS[side]}>
              {SIDE_SHORT[side]}
            </span>
            {choices
              .filter((one) => one.side === side)
              .map((one) => (
                <button
                  key={one.contractId}
                  type="button"
                  className={OPTION}
                  aria-pressed={one.contractId === chosenId}
                  onClick={() => {
                    onPick(one.contractId);
                  }}
                >
                  <span className="block">{CHOICE_WORDS[one.choice]}</span>
                  <span className="block text-xs tabular-nums text-muted-foreground">{formatCents(one.targetCents)}</span>
                </button>
              ))}
          </div>
        ))}
      </div>
    </fieldset>
  );
}

function Spends({
  spendChoices,
  chosen,
  locked,
  onChoose,
}: {
  spendChoices: readonly number[];
  chosen: number | null;
  locked: boolean;
  onChoose: (spendCents: number) => void;
}): ReactElement {
  return (
    <fieldset className="m-0 min-w-0 border-0 p-0" disabled={locked}>
      <legend className={`mb-1.5 p-0 ${LABEL}`}>{SPEND_LABEL}</legend>
      <div className="flex flex-wrap gap-1.5">
        {spendChoices.map((spendCents) => (
          <button
            key={spendCents}
            type="button"
            className={`${OPTION} tabular-nums`}
            aria-pressed={spendCents === chosen}
            onClick={() => {
              onChoose(spendCents);
            }}
          >
            {formatCents(spendCents)}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * "What if, at the closing bell, the price reaches..." A native range input
 * over the places of the quote's stops. It shows the stop the server sent for
 * that place and works nothing out. Where the slider stands is ordinary form
 * state: it is remembered by place for as long as the same draft is quoted,
 * and starts again on the break-even for another.
 */
function WhatIf({ quote }: { quote: TicketQuote | null }): ReactElement | null {
  const inputId = useId();
  const [picked, setPicked] = useState<{ draftKey: string; index: number } | null>(null);
  if (quote === null) return null;
  const draftKey = `${String(quote.contractId)}:${String(quote.spendCents)}`;

  const index = picked !== null && picked.draftKey === draftKey && stopAt(quote, picked.index) !== null ? picked.index : breakEvenStopIndex(quote);
  const stop = stopAt(quote, index);
  const first = stopAt(quote, 0);
  const last = stopAt(quote, quote.whatIf.length - 1);
  if (stop === null || first === null || last === null) return null;
  const profit = profitText(stop.profitCents);

  return (
    <div className="grid gap-1 rounded-md border border-border bg-background/60 p-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={inputId} className="text-xs text-muted-foreground">
          {WHAT_IF_LABEL} <span className="text-sm tabular-nums text-foreground">{formatCents(stop.atCents)}</span>
        </label>
        <p className="m-0 text-right text-xs text-muted-foreground">
          {WHAT_IF_RESULT_LABEL} <span className={`text-sm font-medium tabular-nums ${profit.className}`}>{profit.text}</span>
        </p>
      </div>
      <input
        id={inputId}
        type="range"
        className={`w-full accent-ring ${FOCUS}`}
        min={0}
        max={quote.whatIf.length - 1}
        step={1}
        value={index}
        aria-valuetext={`${formatCents(stop.atCents)}. ${WHAT_IF_RESULT_LABEL} ${profit.text}`}
        onChange={(event) => {
          setPicked({ draftKey, index: Number(event.currentTarget.value) });
        }}
      />
      <div className="flex justify-between text-[0.6875rem] tabular-nums text-muted-foreground" aria-hidden="true">
        <span>{formatCents(first.atCents)}</span>
        <span>{formatCents(last.atCents)}</span>
      </div>
    </div>
  );
}

/** The server's numbers for the ticket being built. Drawn only while the quote echoes the form. */
function QuoteNumbers({ quote, side }: { quote: TicketQuote; side: Side }): ReactElement {
  return (
    <>
      <dl className="m-0 grid gap-2">
        <Figure label={COST_LABEL} className="text-2xl font-medium text-gold">
          {formatCents(quote.costCents)}
        </Figure>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <Figure label={PRICE_LABEL}>{formatCents(quote.priceCents)}</Figure>
          <Figure label={QUANTITY_LABEL}>{quote.quantity.toLocaleString('en-US')}</Figure>
          <Figure label={PROFIT_IF_WORDS[side]}>{formatCents(quote.breakEvenCents)}</Figure>
          <Figure label={LIMIT_LABEL}>{formatCents(quote.limitPriceCents)}</Figure>
        </div>
      </dl>
    </>
  );
}

/** Today's ticket, as the server sent it. */
function OpenTicketNumbers({ ticket }: { ticket: OpenTicket }): ReactElement {
  const profit = profitText(ticket.profitCents);
  return (
    <dl className="m-0 grid gap-2">
      <div className="grid grid-cols-2 gap-2">
        <Figure label={WORTH_NOW_LABEL} className="text-2xl font-medium">
          {formatCents(ticket.valueCents)}
        </Figure>
        <Figure label={PROFIT_SO_FAR_LABEL} className={`text-2xl font-medium ${profit.className}`}>
          {profit.text}
        </Figure>
      </div>
      <div className="grid grid-cols-2 gap-2 text-sm">
        <Figure label={COST_LABEL}>{formatCents(ticket.costCents)}</Figure>
        <Figure label={QUANTITY_LABEL}>{ticket.quantity.toLocaleString('en-US')}</Figure>
        <Figure label={<TwoWords words={REAL_VALUE_WORDS} />}>
          {formatCents(ticket.realCents)} <span className="text-xs text-muted-foreground">{PER_TICKET_LABEL}</span>
        </Figure>
        <Figure label={<TwoWords words={HOPE_VALUE_WORDS} />}>
          {formatCents(ticket.hopeCents)} <span className="text-xs text-muted-foreground">{PER_TICKET_LABEL}</span>
        </Figure>
        <Figure label={BREAK_EVEN_LABEL}>{formatCents(ticket.breakEvenCents)}</Figure>
      </div>
    </dl>
  );
}

function AccountLine({ account }: { account: TicketAccount }): ReactElement {
  return (
    <dl className="m-0 flex flex-wrap justify-between gap-x-3 gap-y-1 border-t border-border pt-2 text-xs text-muted-foreground">
      <div className="flex gap-1.5">
        <dt>{CASH_LABEL}</dt>
        <dd className="m-0 tabular-nums text-foreground">{formatCents(account.cashCents)}</dd>
      </div>
      <div className="flex gap-1.5">
        <dt>{CAP_LABEL}</dt>
        <dd className="m-0 tabular-nums text-foreground">{formatCents(account.capCents)}</dd>
      </div>
    </dl>
  );
}

export interface TicketViewProps {
  state: TicketState;
  snapshot: TicketSnapshot;
  choices: readonly SimpleChoice[];
  spendChoices: readonly number[];
  retryOffered: boolean;
  onPick: (contractId: number) => void;
  onChooseSpend: (spendCents: number) => void;
  /** Told which command the pressed button was drawn for, so that a press can never send the other one. */
  onPress: (drawnAs: CommandKind) => void;
  onRetry: () => void;
}

/**
 * The form, drawn from a state and a snapshot. The part that scrolls, if the
 * panel is ever shorter than the form, is the middle; the action and what it
 * says stay in view.
 */
export function TicketView({ state, snapshot, choices, spendChoices, retryOffered, onPick, onChooseSpend, onPress, onRetry }: TicketViewProps): ReactElement {
  const whyOffId = useId();
  const retryHintId = useId();

  const { contract, quote, account, position, line } = snapshot;
  const drawnAs = commandKindOf(snapshot);
  const holding = position !== null;
  // The choices are open in `draft`, and in `rejected`, where changing one is a way back to `draft`. An accepted form waits for the server.
  const locked = state.form !== 'draft' && state.form !== 'rejected';
  const buyOff = buyBlocker(state, snapshot);
  const cashOutOff = cashOutBlocker(state, snapshot);
  const blocked = holding ? cashOutOff !== null : buyOff !== null;
  const whyOff = holding ? (cashOutOff === null ? null : CASH_OUT_BLOCKER_WORDS[cashOutOff]) : buyOff === null ? null : BLOCKER_WORDS[buyOff];
  const status = statusWords(state);
  const dimmed = line === 'live' ? '' : 'opacity-60';

  return (
    <section aria-label={PANEL_TITLE} className="flex max-h-full w-full max-w-sm flex-col rounded-lg border border-border bg-card text-card-foreground">
      <div className="flex items-center justify-between gap-3 px-4 pt-3.5 pb-2">
        <h3 className={`m-0 font-normal ${LABEL}`}>{holding ? OPEN_TICKET_TITLE : PANEL_TITLE}</h3>
        {line === 'live' ? null : <p className="m-0 rounded-sm border border-border px-1.5 py-0.5 text-xs text-gold">{LINE_WORDS[line]}</p>}
      </div>
      <div className="grid min-h-0 gap-3 overflow-y-auto px-4 pb-3">
        {holding ? (
          <>
            <TicketHead ticket={position} />
            <div className={dimmed}>
              <OpenTicketNumbers ticket={position} />
            </div>
          </>
        ) : (
          <>
            {contract === null ? <p className="m-0 text-sm text-muted-foreground">{NOTHING_PICKED}</p> : <TicketHead ticket={contract} />}
            <Choices choices={choices} chosenId={contract?.contractId ?? null} locked={locked} onPick={onPick} />
            <Spends spendChoices={spendChoices} chosen={state.spendCents} locked={locked} onChoose={onChooseSpend} />
            {contract !== null && quoteEchoes(state, quote) && quote.spendCents !== null ? (
              <div className={`grid gap-3 ${dimmed}`}>
                <QuoteNumbers quote={quote} side={contract.side} />
                <WhatIf quote={quote} />
              </div>
            ) : null}
          </>
        )}
      </div>
      <div className="grid gap-2 border-t border-border px-4 pt-3 pb-3.5">
        <button
          type="button"
          className={ACTION}
          disabled={blocked}
          aria-describedby={whyOff === null ? undefined : whyOffId}
          onClick={() => {
            onPress(drawnAs);
          }}
        >
          {drawnAs === 'cashOut' ? CASH_OUT_LABEL : BUY_LABEL}
        </button>
        {whyOff === null ? null : (
          <p id={whyOffId} className="m-0 text-xs text-muted-foreground">
            {whyOff}
          </p>
        )}
        <p role="status" aria-live="polite" className="m-0 min-h-5 text-sm">
          {status}
        </p>
        {retryAllowed(state, retryOffered) ? (
          <div className="grid gap-1">
            <button type="button" className={`rounded-md border border-ring px-3 py-2 text-sm ${FOCUS} hover:bg-accent`} aria-describedby={retryHintId} onClick={onRetry}>
              {RETRY_LABEL}
            </button>
            <p id={retryHintId} className="m-0 text-xs text-muted-foreground">
              {RETRY_HINT}
            </p>
          </div>
        ) : null}
        <AccountLine account={account} />
      </div>
    </section>
  );
}

const TradingTicket = memo(function TradingTicket(props: OrderTicketProps): ReactElement {
  const quote = useSyncExternalStore(props.quote.subscribe, props.quote.get, props.quote.get);
  const account = useSyncExternalStore(props.account.subscribe, props.account.get, props.account.get);
  const position = useSyncExternalStore(props.position.subscribe, props.position.get, props.position.get);

  const contractId = props.contract?.contractId ?? null;
  const [state, dispatch] = useReducer(ticketReducer, { day: props.day, contractId, spendCents: null, held: position !== null }, initialTicketState);

  const latestProps = useRef(props);
  useEffect(() => {
    latestProps.current = props;
  });

  /**
   * The machine's latest state, moved forward by `send` in the same moment as
   * the event is dispatched to React. The handlers read it and never the
   * rendered state, so a second press in the same moment already sees
   * `pending`. Both are made once per mount and are plain functions with no
   * React in them (`handlers.ts`), which is where they are tried.
   */
  const [{ send, handlers }] = useState(() => {
    const latest = createLatestState(state, dispatch);
    return { send: latest.send, handlers: createTicketHandlers({ state: latest.state, props: () => latestProps.current, send: latest.send }) };
  });

  // The desk owns the selection: the form follows it.
  useEffect(() => {
    send({ type: 'contract', contractId });
  }, [contractId, send]);

  // What the server and the desk say, handed to the machine as it changes. These are what move the form back to `draft`.
  useEffect(() => {
    send({ type: 'line', line: props.line });
  }, [props.line, send]);
  useEffect(() => {
    send({ type: 'quote', quote });
  }, [quote, send]);
  useEffect(() => {
    send({ type: 'position', held: position !== null });
  }, [position, send]);
  useEffect(() => {
    send({ type: 'day', day: props.day });
  }, [props.day, send]);

  /**
   * Tell the desk what the form holds now, so that the server can quote it.
   * `onDraftChange` is only ever called through the pacer, which holds the
   * reports to one a second. One pacer per mount; a report still waiting when
   * the form goes away is dropped.
   */
  const [pacer] = useState(() =>
    createDraftPacer({
      report: (draft) => {
        latestProps.current.onDraftChange(draft);
      },
    }),
  );
  useEffect(
    () => () => {
      pacer.cancel();
    },
    [pacer],
  );
  const handedOn = useRef<TicketDraft>({ contractId: null, spendCents: null });
  useEffect(() => {
    if (handedOn.current.contractId === state.contractId && handedOn.current.spendCents === state.spendCents) return;
    handedOn.current = { contractId: state.contractId, spendCents: state.spendCents };
    pacer.change(handedOn.current);
  }, [pacer, state.contractId, state.spendCents]);

  return (
    <TicketView
      state={state}
      snapshot={{ day: props.day, contract: props.contract, quote, account, position, line: props.line }}
      choices={props.choices}
      spendChoices={props.spendChoices}
      retryOffered={props.retryOffered}
      onPick={handlers.onPick}
      onChooseSpend={handlers.onChooseSpend}
      onPress={handlers.onPress}
      onRetry={handlers.onRetry}
    />
  );
});

function PreviewTicket(props: TicketPreviewProps): ReactElement {
  const inputId = useId();
  const errorId = useId();
  const quote = useSyncExternalStore(props.quote.subscribe, props.quote.get, props.quote.get);
  const account = useSyncExternalStore(props.account.subscribe, props.account.get, props.account.get);
  const contractId = props.contract?.contractId ?? null;
  const { spendCents } = props.spendEditor;
  const latestReport = useRef(props.onDraftChange);
  useEffect(() => { latestReport.current = props.onDraftChange; }, [props.onDraftChange]);
  const [pacer] = useState(() => createDraftPacer({ report: (draft) => { latestReport.current(draft); } }));
  useEffect(() => () => { pacer.cancel(); }, [pacer]);
  useEffect(() => { pacer.change({ contractId, spendCents }); }, [pacer, contractId, spendCents]);
  const matching = quote !== null && quote.contractId === contractId && quote.spendCents === spendCents && spendCents !== null ? quote : null;

  return (
    <section aria-label={PANEL_TITLE} aria-describedby={props.staleNoticeId} className="flex max-h-full w-full max-w-sm flex-col rounded-lg border border-border bg-card text-card-foreground">
      <div className="flex items-center justify-between gap-3 px-4 pt-3.5 pb-2">
        <h3 className={`m-0 font-normal ${LABEL}`}>{PANEL_TITLE}</h3>
        {props.line === 'live' || props.staleNoticeId !== undefined ? null : <p className="m-0 rounded-sm border border-border px-1.5 py-0.5 text-xs text-gold">{LINE_WORDS[props.line]}</p>}
      </div>
      <div className="grid min-h-0 gap-3 overflow-y-auto px-4 pb-3">
        {props.contract === null ? <p className="m-0 text-sm text-muted-foreground">{NOTHING_PICKED}</p> : <TicketHead ticket={props.contract} />}
        <Choices choices={props.choices} chosenId={contractId} locked={false} onPick={props.onPick} />
        <div className="grid gap-1.5">
          <label htmlFor={inputId} className={LABEL}>{SPEND_LABEL}</label>
          <input id={inputId} type="text" inputMode="decimal" autoComplete="off" value={props.spendEditor.value}
            className={`min-w-0 rounded-md border border-border bg-background px-2.5 py-2 text-sm tabular-nums ${FOCUS}`}
            aria-invalid={props.spendEditor.error !== null} aria-describedby={props.spendEditor.error === null ? undefined : errorId}
            onChange={(event) => { props.spendEditor.onChange(event.currentTarget.value); }} />
          {props.spendEditor.error === null ? null : <p id={errorId} className="m-0 text-xs text-down">{props.spendEditor.error}</p>}
        </div>
        <div className={`grid gap-3 ${props.line === 'live' ? '' : 'opacity-60'}`}>
          {matching !== null && props.contract !== null ? <QuoteNumbers quote={matching} side={props.contract.side} /> : null}
          <WhatIf key={`${String(contractId)}:${String(spendCents)}`} quote={matching} />
        </div>
        <AccountLine account={account} />
      </div>
    </section>
  );
}

export const OrderTicket = memo(function OrderTicket(props: OrderTicketProps | TicketPreviewProps): ReactElement {
  return props.mode === 'preview' ? <PreviewTicket key={props.day} {...props} /> : <TradingTicket {...props} />;
});
