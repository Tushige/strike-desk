import type { TicketDraft } from './ports';

/**
 * Holds the form's draft reports back, so that a player who changes their
 * mind quickly cannot use up the connection's message budget from the form:
 * the first change is reported at once, and after that at most one report
 * goes out per gap, carrying the latest choice. A server that allows 20
 * messages in 10 seconds sees at most 11 from here.
 *
 * A paced report is not a command. It buys nothing, carries no command id and
 * gets no answer; it only asks the desk to have the server quote what the
 * form holds. "Nothing is sent by a timer" is a rule about commands, and it
 * still holds: only a press sends one.
 *
 * While a report waits, the quote on screen still answers the choice before
 * it, so it does not echo the form: the form shows no server number for the
 * new choice and the buy stays off until the quote for it arrives.
 */

/** The shortest time between two draft reports, in milliseconds. */
export const DRAFT_MIN_GAP_MS = 1000;

export interface DraftPacer {
  /** The form holds this now. Reported at once, or when the gap has passed, or never if a later change replaces it first. */
  change: (draft: TicketDraft) => void;
  /** Drops a report that is waiting. For when the form goes away. */
  cancel: () => void;
}

export interface DraftPacerOptions {
  report: (draft: TicketDraft) => void;
  /** Runs `run` after `delayMs`; returns the way to call it off. The browser's timer unless given. */
  schedule?: (run: () => void, delayMs: number) => () => void;
  /** The time in milliseconds. The browser's clock unless given. */
  now?: () => number;
  minGapMs?: number;
}

function browserSchedule(run: () => void, delayMs: number): () => void {
  const timer = setTimeout(run, delayMs);
  return () => {
    clearTimeout(timer);
  };
}

function sameDraft(a: TicketDraft, b: TicketDraft): boolean {
  return a.contractId === b.contractId && a.spendCents === b.spendCents;
}

export function createDraftPacer(options: DraftPacerOptions): DraftPacer {
  const { report, schedule = browserSchedule, now = Date.now, minGapMs = DRAFT_MIN_GAP_MS } = options;

  let reported: { draft: TicketDraft; at: number } | null = null;
  let waiting: TicketDraft | null = null;
  let callOff: (() => void) | null = null;

  function send(draft: TicketDraft): void {
    reported = { draft, at: now() };
    report(draft);
  }

  function onGapPassed(): void {
    callOff = null;
    const draft = waiting;
    waiting = null;
    // The player may have gone back to the choice the desk already has.
    if (draft !== null && (reported === null || !sameDraft(draft, reported.draft))) send(draft);
  }

  return {
    change: (draft) => {
      if (reported === null) {
        send(draft);
        return;
      }
      const sinceLast = now() - reported.at;
      if (callOff === null && sinceLast >= minGapMs) {
        if (!sameDraft(draft, reported.draft)) send(draft);
        return;
      }
      waiting = draft;
      callOff ??= schedule(onGapPassed, minGapMs - sinceLast);
    },
    cancel: () => {
      callOff?.();
      callOff = null;
      waiting = null;
    },
  };
}
