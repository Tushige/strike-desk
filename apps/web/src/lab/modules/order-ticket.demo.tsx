import { useCallback, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { formatCents } from '@strike-desk/shared/money';
import { rejectReasonSchema } from '@strike-desk/shared/protocol';
import type { RejectReason } from '@strike-desk/shared/protocol';
import { OrderTicket } from '../../modules/order-ticket/index';
import type { LineState, OrderTicketProps } from '../../modules/order-ticket/index';
import {
  FAKE_ACCOUNT,
  FAKE_ACCOUNT_AFTER_BUY,
  FAKE_ACCOUNT_AFTER_CASH_OUT,
  FAKE_CONTRACT_A,
  FAKE_CONTRACT_B,
  FAKE_OPEN_TICKET,
  FAKE_OPEN_TICKET_LEVEL_2,
  createHeldTicketDesk,
} from '../../modules/order-ticket/fake';
import type { HeldTicketDesk } from '../../modules/order-ticket/fake';

/**
 * The order ticket against a scripted desk. The controls on the right play
 * the part of the rest of the game and of the server: they select a contract,
 * hold a quote back, move the price, drop the line and answer the command the
 * form sent. Nothing here talks to a server, and every number the form shows
 * was typed into the scripted desk by hand.
 */

const BUTTON =
  'rounded-md border border-border bg-muted px-2.5 py-1.5 text-sm outline-none motion-safe:transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring aria-pressed:border-ring aria-pressed:bg-accent disabled:opacity-50 disabled:hover:bg-muted';
const LABEL = 'm-0 text-[0.6875rem] font-normal uppercase tracking-[0.12em] text-muted-foreground';
const NOTE = 'm-0 text-sm text-muted-foreground';
const LOG = 'm-0 grid list-none gap-1 p-0 font-mono text-xs';
const LOG_LINE = 'rounded-md bg-background px-2 py-1 break-all';

const DELAY_MS = 800;
const LINES: readonly LineState[] = ['live', 'stale', 'offline'];
const REASONS: readonly RejectReason[] = rejectReasonSchema.options;

function browserSchedule(run: () => void, delayMs: number): () => void {
  const timer = setTimeout(run, delayMs);
  return () => {
    clearTimeout(timer);
  };
}

function Group({ title, children, note }: { title: string; children: ReactNode; note?: ReactNode }): ReactElement {
  return (
    <div className="grid gap-1.5">
      <h3 className={LABEL}>{title}</h3>
      <div className="flex flex-wrap items-center gap-1.5">{children}</div>
      {note === undefined ? null : <p className={NOTE}>{note}</p>}
    </div>
  );
}

function draftWords(draft: { contractId: number | null; spendCents: number | null }): string {
  const contract = draft.contractId === null ? 'no contract' : `contract ${String(draft.contractId)}`;
  const spend = draft.spendCents === null ? 'no spend' : formatCents(draft.spendCents);
  return `${contract}, ${spend}`;
}

/** Answers the oldest command the desk has not answered yet. `answered` counts the ones it has. Returns the new count. */
function answerOf(desk: HeldTicketDesk, answered: number, outcome: 'accepted' | 'rejected' | 'lost', reason: RejectReason): number {
  const waiting = desk.controls.submitted()[answered];
  if (waiting === undefined) return answered;
  const kind = waiting.t;
  if (outcome === 'lost') {
    desk.controls.answer({ outcome: 'lost' });
  } else if (outcome === 'accepted') {
    desk.controls.answer({ outcome, receipt: { commandId: waiting.commandId, kind, step: 400, outcome, positionId: 'd1' } });
  } else {
    desk.controls.answer({ outcome, receipt: { commandId: waiting.commandId, kind, step: 400, outcome, reason } });
  }
  return answered + 1;
}

export default function OrderTicketDemo(): ReactElement {
  const [desk] = useState(() => createHeldTicketDesk({ schedule: browserSchedule }));
  const props = useSyncExternalStore(desk.subscribe, desk.props, desk.props);
  const quote = useSyncExternalStore(props.quote.subscribe, props.quote.get, props.quote.get);
  const position = useSyncExternalStore(props.position.subscribe, props.position.get, props.position.get);

  // The desk's logs are plain arrays it does not announce; the page redraws them after each thing that happens.
  const [, setTurn] = useState(0);
  const redraw = useCallback((): void => {
    setTurn((turn) => turn + 1);
  }, []);
  const act = useCallback(
    (what: () => void): void => {
      what();
      redraw();
    },
    [redraw],
  );

  const [holding, setHolding] = useState(false);
  const [delayed, setDelayed] = useState(false);
  const [level, setLevel] = useState<1 | 2>(1);
  const [reason, setReason] = useState<RejectReason>('overCap');
  const reasonId = useId();
  const answered = useRef(0);
  const [startedAt] = useState(() => Date.now());
  const draftTimes = useRef<number[]>([]);

  // The same props, with the page told whenever the form sends or reports something, so that the logs are never behind.
  const shown = useMemo<OrderTicketProps>(
    () => ({
      ...props,
      submit: (command) => {
        const outcome = props.submit(command);
        redraw();
        return outcome;
      },
      onDraftChange: (draft) => {
        draftTimes.current.push(Date.now() - startedAt);
        props.onDraftChange(draft);
        redraw();
      },
      onPick: (contractId) => {
        props.onPick(contractId);
        // The form only reports a pick. Selecting is the desk's part, played here.
        const choice = props.choices.find((one) => one.contractId === contractId);
        if (contractId === FAKE_CONTRACT_A.contractId) desk.controls.select(FAKE_CONTRACT_A);
        else if (choice !== undefined) desk.controls.select({ ...FAKE_CONTRACT_A, contractId, side: choice.side, targetCents: choice.targetCents });
        redraw();
      },
      onRetry: () => {
        props.onRetry();
        redraw();
      },
    }),
    [desk, props, redraw, startedAt],
  );

  const answer = (outcome: 'accepted' | 'rejected' | 'lost'): void => {
    act(() => {
      answered.current = answerOf(desk, answered.current, outcome, reason);
    });
  };

  const submitted = desk.controls.submitted();
  const drafts = desk.controls.drafts();
  const lastDraft = drafts.at(-1) ?? { contractId: null, spendCents: null };
  const echoes = quote !== null && quote.contractId === lastDraft.contractId && quote.spendCents === lastDraft.spendCents;

  return (
    <div id="lab-demo-order-ticket" className="mt-4 grid items-start gap-5 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
      <div className="rounded-lg bg-background p-4">
        <OrderTicket {...shown} />
      </div>
      <div className="grid gap-4">
        <Group title="The desk selects" note="Only these two contracts have scripted quotes. Any other pick on the form is selected too, and the form then waits for a price that never comes.">
          <button type="button" className={BUTTON} aria-pressed={props.contract === FAKE_CONTRACT_A} onClick={() => { act(() => { desk.controls.select(FAKE_CONTRACT_A); }); }}>
            RoboPup UP $85
          </button>
          <button type="button" className={BUTTON} aria-pressed={props.contract === FAKE_CONTRACT_B} onClick={() => { act(() => { desk.controls.select(FAKE_CONTRACT_B); }); }}>
            Fizzly DOWN $41
          </button>
          <button type="button" className={BUTTON} aria-pressed={props.contract === null} onClick={() => { act(() => { desk.controls.select(null); }); }}>
            Nothing
          </button>
        </Group>

        <Group
          title="The server's quote"
          note={
            <>
              The form last reported {draftWords(lastDraft)}. The quote it can see answers {quote === null ? 'nothing' : draftWords(quote)}:{' '}
              <strong className="font-medium text-foreground">{echoes ? 'it echoes the form, so its numbers show.' : 'it does not echo the form, so no server number shows and the buy is off.'}</strong>{' '}
              {desk.held.waiting() ? 'A newer quote is waiting at the server.' : 'No newer quote is waiting.'}
            </>
          }
        >
          <button
            type="button"
            className={BUTTON}
            aria-pressed={holding}
            onClick={() => {
              act(() => {
                desk.held.setHolding(!holding);
                setHolding(!holding);
              });
            }}
          >
            Hold quotes
          </button>
          <button type="button" className={BUTTON} disabled={!desk.held.waiting()} onClick={() => { act(desk.held.release); }}>
            Release quote
          </button>
          <button
            type="button"
            className={BUTTON}
            aria-pressed={delayed}
            onClick={() => {
              act(() => {
                desk.held.setDelay(delayed ? null : DELAY_MS);
                setDelayed(!delayed);
              });
            }}
          >
            Delay every quote 800 ms
          </button>
          <button
            type="button"
            className={BUTTON}
            onClick={() => {
              act(() => {
                const next = level === 1 ? 2 : 1;
                desk.controls.setPriceLevel(next);
                setLevel(next);
              });
            }}
          >
            Move RoboPup&apos;s ticket price to {level === 1 ? '$120' : '$118'}
          </button>
        </Group>

        <Group title="The line to the server">
          {LINES.map((line) => (
            <button key={line} type="button" className={BUTTON} aria-pressed={props.line === line} onClick={() => { act(() => { desk.controls.setLine(line); }); }}>
              {line}
            </button>
          ))}
          <button type="button" className={BUTTON} aria-pressed={props.retryOffered} onClick={() => { act(() => { desk.controls.offerRetry(!props.retryOffered); }); }}>
            Offer a retry while checking
          </button>
        </Group>

        <Group
          title="The server answers the oldest command"
          note={`${String(submitted.length)} sent, ${String(answered.current)} answered. Accepted only answers: the ticket and the account arrive with the buttons below, as a frame would bring them.`}
        >
          <button type="button" className={BUTTON} onClick={() => { answer('accepted'); }}>
            Accepted
          </button>
          <button type="button" className={BUTTON} onClick={() => { answer('rejected'); }}>
            Rejected, because
          </button>
          <label htmlFor={reasonId} className="sr-only">
            The reason for a rejection
          </label>
          <select
            id={reasonId}
            className="rounded-md border border-border bg-muted px-2 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={reason}
            onChange={(event) => {
              const picked = REASONS.find((one) => one === event.currentTarget.value);
              if (picked !== undefined) setReason(picked);
            }}
          >
            {REASONS.map((one) => (
              <option key={one} value={one}>
                {one}
              </option>
            ))}
          </select>
          <button type="button" className={BUTTON} onClick={() => { answer('lost'); }}>
            Lost
          </button>
        </Group>

        <Group title="What the next frame brings" note={`Day ${String(props.day)}. ${position === null ? 'No ticket is held.' : 'The ticket is held.'}`}>
          <button type="button" className={BUTTON} onClick={() => { act(() => { desk.held.hand({ account: FAKE_ACCOUNT_AFTER_BUY, position: FAKE_OPEN_TICKET }); }); }}>
            The bought ticket and the account
          </button>
          <button
            type="button"
            className={BUTTON}
            disabled={position === null}
            onClick={() => {
              act(() => {
                desk.held.hand({ position: position === FAKE_OPEN_TICKET ? FAKE_OPEN_TICKET_LEVEL_2 : FAKE_OPEN_TICKET });
              });
            }}
          >
            The ticket&apos;s worth moves
          </button>
          <button type="button" className={BUTTON} disabled={position === null} onClick={() => { act(() => { desk.held.hand({ account: FAKE_ACCOUNT_AFTER_CASH_OUT, position: null }); }); }}>
            The ticket is gone (cashed out)
          </button>
          <button
            type="button"
            className={BUTTON}
            onClick={() => {
              act(() => {
                desk.held.hand({ account: FAKE_ACCOUNT, position: null });
                desk.held.setDay(props.day >= 5 ? 1 : props.day + 1);
              });
            }}
          >
            The next day starts
          </button>
        </Group>

        <div className="grid gap-3 xl:grid-cols-2">
          <div className="grid content-start gap-1.5">
            <h3 className={LABEL}>Commands the form sent: {submitted.length}</h3>
            {submitted.length === 0 ? (
              <p className={NOTE}>None yet. Select a contract, choose a spend and press buy.</p>
            ) : (
              <ol className={LOG}>
                {submitted.map((command) => (
                  <li key={command.commandId} className={LOG_LINE}>
                    {JSON.stringify(command)}
                  </li>
                ))}
              </ol>
            )}
          </div>
          <div className="grid content-start gap-1.5">
            <h3 className={LABEL}>Drafts the form reported: {drafts.length}, at most one a second after the first</h3>
            {drafts.length === 0 ? (
              <p className={NOTE}>None yet.</p>
            ) : (
              <ol className={LOG}>
                {drafts.map((draft, index) => (
                  <li key={index} className={LOG_LINE}>
                    {String(draftTimes.current[index] ?? 0)} ms: {draftWords(draft)}
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
        <p className={NOTE}>
          Picks reported to the desk: {desk.controls.picks().join(', ') || 'none'}. Retries asked for: {desk.controls.retries()}.
        </p>
      </div>
    </div>
  );
}
