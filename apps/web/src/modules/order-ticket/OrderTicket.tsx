import { memo, useCallback, useEffect, useId, useReducer, useRef, useState, useSyncExternalStore } from 'react';
import type { ReactElement } from 'react';
import { formatCents } from '@strike-desk/shared/money';
import type { Side } from '@strike-desk/shared/protocol';
import { createDraftPacer } from './draftPacer';
import { buyBlocker, initialTicketState, pressOf, quoteEchoes, retryAllowed, ticketReducer } from './machine';
import type { TicketEvent, TicketNotice, TicketSnapshot, TicketState } from './machine';
import type { OrderTicketProps, SimpleChoice, TicketAccount, TicketContract, TicketDraft, TicketQuote } from './ports';
import {
  ACCEPTED_BUY_WORDS,
  BLOCKER_WORDS,
  BUY_LABEL,
  CAP_LABEL,
  CASH_LABEL,
  CHECKING_WORDS,
  CHOICES_LABEL,
  CHOICE_WORDS,
  COST_LABEL,
  LINE_WORDS,
  LOST_WORDS,
  NOTHING_PICKED,
  PANEL_TITLE,
  PENDING_WORDS,
  PRICE_LABEL,
  QUANTITY_LABEL,
  REJECTED_LEAD,
  REJECTED_NO_REASON,
  REJECT_WORDS,
  RETRY_HINT,
  RETRY_LABEL,
  SIDE_HINTS,
  SIDE_WORDS,
  SPEND_LABEL,
  TARGET_WORDS,
} from './words';

/**
 * The order ticket: the one form that buys today's ticket. It draws what the
 * rules in `machine.ts` say and sends what they build. Every number on it is
 * the server's, shown as sent; the only thing of the player's is what they
 * chose.
 *
 * The rules a reader should check first are all in one handler, `onPress`:
 * it is the only caller of `pressOf` and the only place `submit` is called.
 */

const SIDES: readonly Side[] = ['up', 'down'];

/** The colour of a side's word. A side is also always said in words, never by colour alone. */
const SIDE_TEXT: Record<Side, string> = { up: 'text-up', down: 'text-down' };

const LABEL = 'text-[0.6875rem] uppercase tracking-[0.12em] text-muted-foreground';
const FOCUS = 'outline-none focus-visible:ring-2 focus-visible:ring-ring';
const OPTION =
  `rounded-md border border-border px-2 py-1.5 text-left text-sm motion-safe:transition-colors ${FOCUS} ` +
  'hover:bg-accent aria-pressed:border-ring aria-pressed:bg-accent disabled:opacity-50 disabled:hover:bg-transparent';

function snapshotOf(props: OrderTicketProps): TicketSnapshot {
  return {
    day: props.day,
    contract: props.contract,
    quote: props.quote.get(),
    account: props.account.get(),
    position: props.position.get(),
    line: props.line,
  };
}

function noticeWords(notice: TicketNotice): string {
  if (notice.kind === 'lost') return LOST_WORDS;
  if (notice.kind === 'accepted') return ACCEPTED_BUY_WORDS;
  return `${REJECTED_LEAD} ${notice.reason === null ? REJECTED_NO_REASON : REJECT_WORDS[notice.reason]}`;
}

function ContractHead({ contract }: { contract: TicketContract }): ReactElement {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <div className="min-w-0">
        <p className="truncate text-base font-medium">{contract.companyName}</p>
        <p className="text-xs tracking-wider text-muted-foreground">{contract.ticker}</p>
      </div>
      <div className="text-right">
        <p className={`text-sm font-medium ${SIDE_TEXT[contract.side]}`}>
          {SIDE_WORDS[contract.side].game} <span className="font-normal text-muted-foreground">({SIDE_WORDS[contract.side].real})</span>
        </p>
        <p className="text-sm tabular-nums">
          {TARGET_WORDS.game} {formatCents(contract.targetCents)} <span className="text-muted-foreground">({TARGET_WORDS.real})</span>
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
    <fieldset className="m-0 border-0 p-0" disabled={locked}>
      <legend className={`mb-1.5 p-0 ${LABEL}`}>{CHOICES_LABEL}</legend>
      <div className="grid gap-1.5">
        {SIDES.map((side) => (
          <div key={side} role="group" aria-label={`${SIDE_WORDS[side].game}. ${SIDE_HINTS[side]}`} className="grid grid-cols-[3.25rem_repeat(3,minmax(0,1fr))] items-center gap-1.5">
            <span className={`text-sm font-medium ${SIDE_TEXT[side]}`} title={SIDE_HINTS[side]}>
              {side === 'up' ? 'UP' : 'DOWN'}
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
    <fieldset className="m-0 border-0 p-0" disabled={locked}>
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

/** The server's numbers for the ticket being built. Drawn only while the quote echoes the form. */
function QuoteNumbers({ quote }: { quote: TicketQuote }): ReactElement {
  return (
    <dl className="m-0 grid gap-2">
      <div>
        <dt className={LABEL}>{COST_LABEL}</dt>
        <dd className="m-0 text-2xl font-medium tabular-nums text-gold">{formatCents(quote.costCents)}</dd>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <dt className={LABEL}>{PRICE_LABEL}</dt>
          <dd className="m-0 tabular-nums">{formatCents(quote.priceCents)}</dd>
        </div>
        <div>
          <dt className={LABEL}>{QUANTITY_LABEL}</dt>
          <dd className="m-0 tabular-nums">{quote.quantity.toLocaleString('en-US')}</dd>
        </div>
      </div>
    </dl>
  );
}

function AccountLine({ account }: { account: TicketAccount }): ReactElement {
  return (
    <dl className="m-0 flex justify-between gap-3 border-t border-border pt-2 text-xs text-muted-foreground">
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

function statusWords(state: TicketState): string | null {
  if (state.form === 'pending') return PENDING_WORDS;
  if (state.form === 'checking') return CHECKING_WORDS;
  return state.notice === null ? null : noticeWords(state.notice);
}

export const OrderTicket = memo(function OrderTicket(props: OrderTicketProps): ReactElement {
  const quote = useSyncExternalStore(props.quote.subscribe, props.quote.get, props.quote.get);
  const account = useSyncExternalStore(props.account.subscribe, props.account.get, props.account.get);
  const position = useSyncExternalStore(props.position.subscribe, props.position.get, props.position.get);

  const whyOffId = useId();
  const retryHintId = useId();

  const contractId = props.contract?.contractId ?? null;
  const [state, dispatch] = useReducer(ticketReducer, { day: props.day, contractId, spendCents: null, held: position !== null }, initialTicketState);

  /**
   * The machine's latest state, moved forward by `send` in the same moment as
   * the event is dispatched. A handler reads this and never the rendered
   * state, so a second press in the same moment already sees `pending`.
   */
  const latestState = useRef(state);
  const latestProps = useRef(props);
  useEffect(() => {
    latestProps.current = props;
  });

  const send = useCallback((event: TicketEvent): void => {
    latestState.current = ticketReducer(latestState.current, event);
    dispatch(event);
  }, []);

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

  const onChooseSpend = useCallback(
    (spendCents: number): void => {
      send({ type: 'spend', spendCents });
    },
    [send],
  );

  /** The one place a command leaves the form. */
  const onPress = useCallback((): void => {
    const now = latestProps.current;
    const press = pressOf(latestState.current, snapshotOf(now), now.newCommandId);
    if (press === null) return;
    send(press.event);
    const { commandId } = press.command;
    void now.submit(press.command).then((outcome) => {
      send({ type: 'outcome', commandId, outcome });
    });
  }, [send]);

  /** The retry asks the desk to send the unanswered command again, under its own id. The form itself sends nothing. */
  const onRetryPress = useCallback((): void => {
    const now = latestProps.current;
    if (retryAllowed(latestState.current, now.retryOffered)) now.onRetry();
  }, []);

  const snapshot: TicketSnapshot = { day: props.day, contract: props.contract, quote, account, position, line: props.line };
  const locked = state.form === 'pending' || state.form === 'checking';
  const status = statusWords(state);
  const blocker = buyBlocker(state, snapshot);
  const whyOff = blocker === null ? null : BLOCKER_WORDS[blocker];
  const live = props.line === 'live';

  return (
    <section aria-label={PANEL_TITLE} className="grid w-full max-w-sm gap-3 rounded-lg border border-border bg-card p-4 text-card-foreground">
      <div className="flex items-center justify-between gap-3">
        <h3 className={`m-0 ${LABEL}`}>{PANEL_TITLE}</h3>
        {props.line === 'live' ? null : <p className="m-0 rounded-sm border border-border px-1.5 py-0.5 text-xs text-gold">{LINE_WORDS[props.line]}</p>}
      </div>
      {props.contract === null ? <p className="m-0 text-sm text-muted-foreground">{NOTHING_PICKED}</p> : <ContractHead contract={props.contract} />}
      <Choices choices={props.choices} chosenId={contractId} locked={locked} onPick={props.onPick} />
      <Spends spendChoices={props.spendChoices} chosen={state.spendCents} locked={locked} onChoose={onChooseSpend} />
      {quoteEchoes(state, quote) && quote.spendCents !== null ? (
        <div className={live ? undefined : 'opacity-60'}>
          <QuoteNumbers quote={quote} />
        </div>
      ) : null}
      <button
        type="button"
        className={`rounded-md bg-gold px-3 py-2.5 text-base font-medium text-background motion-safe:transition-opacity ${FOCUS} disabled:opacity-40`}
        disabled={blocker !== null}
        aria-describedby={whyOff === null ? undefined : whyOffId}
        onClick={onPress}
      >
        {BUY_LABEL}
      </button>
      {whyOff === null ? null : (
        <p id={whyOffId} className="m-0 text-xs text-muted-foreground">
          {whyOff}
        </p>
      )}
      <p role="status" aria-live="polite" className="m-0 min-h-5 text-sm">
        {status}
      </p>
      {retryAllowed(state, props.retryOffered) ? (
        <div className="grid gap-1">
          <button type="button" className={`rounded-md border border-ring px-3 py-2 text-sm ${FOCUS} hover:bg-accent`} aria-describedby={retryHintId} onClick={onRetryPress}>
            {RETRY_LABEL}
          </button>
          <p id={retryHintId} className="m-0 text-xs text-muted-foreground">
            {RETRY_HINT}
          </p>
        </div>
      ) : null}
      <AccountLine account={account} />
    </section>
  );
});
