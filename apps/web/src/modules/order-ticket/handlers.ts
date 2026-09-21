import { commandKindOf, pressOf, retryAllowed, ticketReducer } from './machine';
import type { CommandKind, TicketEvent, TicketSnapshot, TicketState } from './machine';
import type { OrderTicketProps } from './ports';

/**
 * What the form does when it is pressed, with no React in it, so that it can
 * be tried without a page: the component makes these once and hands them to
 * the view. They are the only code in the block that calls `submit`,
 * `newCommandId`, `onRetry` or `onPick`.
 */

/** Where the handlers read from and write to. Each is asked at the moment of a press, never kept. */
export interface TicketHandlerSource {
  /** The machine's latest state: already moved forward by every `send`, never a rendered copy. */
  state: () => TicketState;
  /** The props as they are now. */
  props: () => OrderTicketProps;
  /** Applies an event to the machine now, so that the next `state()` already shows it. */
  send: (event: TicketEvent) => void;
}

export interface TicketHandlers {
  onPick: (contractId: number) => void;
  onChooseSpend: (spendCents: number) => void;
  /** `drawnAs` is the command the pressed button was drawn for. */
  onPress: (drawnAs: CommandKind) => void;
  onRetry: () => void;
}

/** The current values of everything the rules read, taken from the props and their slices now. */
export function snapshotOf(props: OrderTicketProps): TicketSnapshot {
  return {
    day: props.day,
    contract: props.contract,
    quote: props.quote.get(),
    account: props.account.get(),
    position: props.position.get(),
    line: props.line,
  };
}

/**
 * A holder for the machine's latest state outside React: `send` moves it
 * forward at once and then tells whoever draws it. A press reads this and
 * never the rendered state, so a second press in the same moment already
 * sees `pending`.
 */
export function createLatestState(initial: TicketState, onEvent: (event: TicketEvent) => void): Pick<TicketHandlerSource, 'state' | 'send'> {
  let latest = initial;
  return {
    state: () => latest,
    send: (event) => {
      latest = ticketReducer(latest, event);
      onEvent(event);
    },
  };
}

export function createTicketHandlers(source: TicketHandlerSource): TicketHandlers {
  return {
    // The desk owns the selection: the form only reports a pick.
    onPick: (contractId) => {
      source.props().onPick(contractId);
    },
    onChooseSpend: (spendCents) => {
      source.send({ type: 'spend', spendCents });
    },
    /** The one place a command leaves the form. */
    onPress: (drawnAs) => {
      const now = source.props();
      const snapshot = snapshotOf(now);
      // The ticket can arrive or go between the drawing of the button and the press. A press sends what its button said, or nothing.
      if (commandKindOf(snapshot) !== drawnAs) return;
      const press = pressOf(source.state(), snapshot, now.newCommandId);
      if (press === null) return;
      source.send(press.event);
      const { commandId } = press.command;
      void now.submit(press.command).then((outcome) => {
        source.send({ type: 'outcome', commandId, outcome });
      });
    },
    /** The retry asks the desk to send the unanswered command again, under the id it already has. The form itself sends nothing and takes no new id. */
    onRetry: () => {
      const now = source.props();
      if (retryAllowed(source.state(), now.retryOffered)) now.onRetry();
    },
  };
}
