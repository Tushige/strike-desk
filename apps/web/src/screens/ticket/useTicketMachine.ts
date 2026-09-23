import { useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore } from 'react';
import type { Frame } from '@strike-desk/shared/protocol';
import { connection, newCommandId, store, submitTrade, restoredIntent, restoredOutcome } from '../../boot';
import { lineStateOf } from '../../modules/connection/index';
import { createDraftPacer, createLatestState, createTicketHandlers, initialTicketState, ticketReducer } from '../../modules/order-ticket/index';
import type { TicketContract, TicketHandlers, TicketSnapshot, TicketState, TradingTicketProps } from '../../modules/order-ticket/index';
import { useConnectionState } from '../../store/hooks';
import { openTicketOf, ticketSlices } from './sources';
import { deriveSlice, sameFields } from '../../store/derive';

/**
 * The order ticket's state machine, wired to the running game: the slices
 * cut from the frame, the connection for sending, and the draft pacer that
 * has the server quote what the player is building.
 *
 * The machine and its handlers have no React in them (`modules/order-ticket`);
 * this hook only feeds them what changes and hands back what to draw.
 */

export interface TicketMachine {
  state: TicketState;
  snapshot: TicketSnapshot;
  handlers: TicketHandlers;
}

/** The spend chips, in cents. The last chip is the server's remaining daily allowance. */
export const SPEND_CHIPS = [5_000_000, 10_000_000, 25_000_000] as const;

function startingState(seed: { day: number; contractId: number | null; held: boolean }): TicketState {
  const initial = initialTicketState({ day: seed.day, contractId: seed.contractId, spendCents: null, held: seed.held });
  if (restoredIntent === null) return initial;
  return { ...initial, form: 'checking', spendCents: restoredIntent.command.t === 'buy' ? restoredIntent.command.spendCents : null,
    command: { id: restoredIntent.command.commandId, kind: restoredIntent.command.t, day: restoredIntent.day } };
}

export function useTicketMachine(frame: Frame, contract: TicketContract | null, onPick: (contractId: number) => void, positionId: string | null): TicketMachine {
  const quote = useSyncExternalStore(ticketSlices.quote.subscribe, ticketSlices.quote.get);
  const account = useSyncExternalStore(ticketSlices.account.subscribe, ticketSlices.account.get);
  const positionSlice = useMemo(() => {
    const slice = deriveSlice(store.frame, value => openTicketOf(value, positionId), sameFields);
    return { get: () => slice.get(), subscribe: (listener: () => void) => slice.subscribe(listener) };
  }, [positionId]);
  const position = useSyncExternalStore(positionSlice.subscribe, positionSlice.get);
  const connectionPhase = useConnectionState().phase;
  const line = lineStateOf(connectionPhase);
  const day = frame.clock.day;
  const handedDay = useRef(day);
  const contractId = contract?.contractId ?? null;

  const [state, dispatch] = useReducer(ticketReducer, { day, contractId, held: position !== null }, startingState);

  // The props the handlers read at the moment of a press, always the latest.
  const props: TradingTicketProps = {
    day,
    contract,
    choices: [],
    onPick,
    spendChoices: [...SPEND_CHIPS, account.capCents],
    quote: ticketSlices.quote,
    account: ticketSlices.account,
    position: positionSlice,
    line,
    retryOffered: true,
    onRetry: () => {
      const command = latest.state().command;
      if (command !== null) connection.resend(command.id);
    },
    onDraftChange: (draft) => {
      store.setRequestedDraft(draft);
      connection.send({ t: 'draft', contractId: draft.contractId, spendCents: draft.spendCents });
    },
    submit: submitTrade,
    newCommandId,
  };
  const latestProps = useRef(props);
  latestProps.current = props;

  /**
   * The machine's latest state, moved forward by `send` in the same moment
   * as the event reaches React, so a second press in the same moment already
   * sees `pending`. Made once per mount.
   */
  const [latest] = useState(() => createLatestState(state, dispatch));
  const [handlers] = useState(() =>
    createTicketHandlers({ state: latest.state, props: () => latestProps.current, send: latest.send }),
  );
  const { send } = latest;
  useEffect(() => { send({ type: 'editing' }); }, [positionId, send]);
  useEffect(() => {
    if (restoredOutcome !== null && restoredIntent !== null) {
      const id = restoredIntent.command.commandId;
      void restoredOutcome.then((outcome) => { send({ type: 'outcome', commandId: id, outcome }); });
    }
  }, [send]);

  // What the desk and the server say, handed to the machine as it changes.
  useEffect(() => {
    send({ type: 'contract', contractId });
  }, [contractId, send]);
  useEffect(() => {
    send({ type: 'line', line });
  }, [line, send]);
  useEffect(() => {
    send({ type: 'quote', quote });
  }, [quote, send]);
  useEffect(() => {
    send({ type: 'position', held: position !== null });
  }, [position, send]);
  useEffect(() => {
    send({ type: 'day', day });
    if (day !== handedDay.current) send({ type: 'spend', spendCents: null });
    handedDay.current = day;
  }, [day, send]);

  /**
   * Tell the server what the form holds, at most once a second, so it can
   * quote it. A report still waiting when the form goes away is dropped.
   */
  const [pacer] = useState(() => createDraftPacer({ report: (draft) => { latestProps.current.onDraftChange(draft); } }));
  useEffect(() => () => { pacer.cancel(); }, [pacer]);
  const handedOn = useRef({ contractId: null as number | null, spendCents: null as number | null });
  useEffect(() => {
    if (handedOn.current.contractId === state.contractId && handedOn.current.spendCents === state.spendCents) return;
    handedOn.current = { contractId: state.contractId, spendCents: state.spendCents };
    pacer.change(handedOn.current);
  }, [pacer, state.contractId, state.spendCents]);
  // The server keeps a draft per socket and forgets it when the socket goes.
  // `resumed` is the first frame on a new socket: say the draft again, at
  // once, or the quote would never come back and the buy would stay off.
  useEffect(() => {
    if (connectionPhase !== 'resumed') return;
    if (handedOn.current.contractId === null && handedOn.current.spendCents === null) return;
    latestProps.current.onDraftChange(handedOn.current);
  }, [connectionPhase]);

  return {
    state,
    snapshot: { day, contract, quote, account, position, line },
    handlers,
  };
}
