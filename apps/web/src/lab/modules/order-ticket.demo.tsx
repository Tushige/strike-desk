import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { ReactElement, ReactNode } from 'react';
import type { RejectReason } from '@strike-desk/shared/protocol';
import { OrderTicket } from '../../modules/order-ticket/index';
import { FAKE_ACCOUNT_AFTER_BUY, FAKE_CONTRACT_A, FAKE_CONTRACT_B, FAKE_OPEN_TICKET, createFakeTicketDesk } from '../../modules/order-ticket/fake';
import type { FakeTicketDesk } from '../../modules/order-ticket/fake';
import type { OrderTicketProps } from '../../modules/order-ticket/index';

/**
 * The order ticket against a scripted desk. The buttons on the right play the
 * part of the rest of the game and of the server: they select a contract and
 * answer the command the form sent. Nothing here talks to a server, and every
 * number the form shows was typed into the scripted desk by hand.
 */

const BUTTON =
  'rounded-md border border-border bg-muted px-2.5 py-1.5 text-sm outline-none motion-safe:transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 disabled:hover:bg-muted';
const LABEL = 'm-0 text-[0.6875rem] uppercase tracking-[0.12em] text-muted-foreground';

function Group({ title, children }: { title: string; children: ReactNode }): ReactElement {
  return (
    <div className="grid gap-1.5">
      <h3 className={LABEL}>{title}</h3>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

/** Answers the oldest command the desk has not answered yet. `answered` counts the ones it has. Returns the new count. */
function answerOf(desk: FakeTicketDesk, answered: number, outcome: 'accepted' | 'rejected' | 'lost', reason: RejectReason): number {
  const waiting = desk.controls.submitted()[answered];
  if (waiting === undefined) return answered;
  const kind = waiting.t;
  if (outcome === 'lost') {
    desk.controls.answer({ outcome: 'lost' });
  } else if (outcome === 'accepted') {
    desk.controls.answer(
      { outcome, receipt: { commandId: waiting.commandId, kind, step: 400, outcome, positionId: 'd1' } },
      { account: FAKE_ACCOUNT_AFTER_BUY, position: FAKE_OPEN_TICKET },
    );
  } else {
    desk.controls.answer({ outcome, receipt: { commandId: waiting.commandId, kind, step: 400, outcome, reason } });
  }
  return answered + 1;
}

export default function OrderTicketDemo(): ReactElement {
  const [desk] = useState(createFakeTicketDesk);
  const props = useSyncExternalStore(desk.subscribe, desk.props, desk.props);
  // The desk's logs are plain arrays it does not announce; the page redraws them after each thing it does.
  const [, setTurn] = useState(0);
  const act = useCallback((what: () => void): void => {
    what();
    setTurn((turn) => turn + 1);
  }, []);
  const answered = useRef(0);
  const answer = useCallback(
    (outcome: 'accepted' | 'rejected' | 'lost'): void => {
      act(() => {
        answered.current = answerOf(desk, answered.current, outcome, 'overCap');
      });
    },
    [act, desk],
  );

  // The same props, with the page told whenever the form sends something, so that the log below is never behind.
  const shown = useMemo<OrderTicketProps>(
    () => ({
      ...props,
      submit: (command) => {
        const outcome = props.submit(command);
        setTurn((turn) => turn + 1);
        return outcome;
      },
    }),
    [props],
  );

  const submitted = desk.controls.submitted();

  return (
    <div id="lab-demo-order-ticket" className="mt-4 grid items-start gap-5 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
      <div className="rounded-lg bg-background p-4">
        <OrderTicket {...shown} />
      </div>
      <div className="grid gap-4">
        <Group title="The desk selects">
          <button type="button" className={BUTTON} onClick={() => { act(() => { desk.controls.select(FAKE_CONTRACT_A); }); }}>
            RoboPup UP $85
          </button>
          <button type="button" className={BUTTON} onClick={() => { act(() => { desk.controls.select(FAKE_CONTRACT_B); }); }}>
            Fizzly DOWN $41
          </button>
          <button type="button" className={BUTTON} onClick={() => { act(() => { desk.controls.select(null); }); }}>
            Nothing
          </button>
        </Group>
        <Group title="The server answers the oldest command">
          <button type="button" className={BUTTON} onClick={() => { answer('accepted'); }}>
            Accepted
          </button>
          <button type="button" className={BUTTON} onClick={() => { answer('rejected'); }}>
            Rejected: over the cap
          </button>
          <button type="button" className={BUTTON} onClick={() => { answer('lost'); }}>
            Lost
          </button>
        </Group>
        <div className="grid gap-1.5">
          <h3 className={LABEL}>
            Commands the form sent: {submitted.length}, answered: {answered.current}
          </h3>
          {submitted.length === 0 ? (
            <p className="m-0 text-sm text-muted-foreground">None yet. Select a contract, choose a spend and press buy.</p>
          ) : (
            <ol className="m-0 grid list-none gap-1 p-0 font-mono text-xs">
              {submitted.map((command) => (
                <li key={command.commandId} className="rounded-md bg-background px-2 py-1 break-all">
                  {JSON.stringify(command)}
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
}
