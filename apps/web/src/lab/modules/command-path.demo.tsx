import type { ReactElement } from 'react';
import { formatCents } from '@strike-desk/shared/money';
import { receiptSchema } from '@strike-desk/shared/protocol';
import type { Receipt } from '@strike-desk/shared/protocol';
import { BELL_STEP_IN_DAY, DAY_STEPS, momentAt } from '@strike-desk/shared/time';
import transcriptText from './command-path.transcript.json?raw';

/**
 * The command path has no face of its own: it is one function on the server.
 * This page shows it as something to read instead: a committed transcript of
 * one scripted game, every line of which is one call of that function.
 *
 * Retake the transcript with
 *
 *   pnpm --filter @strike-desk/server exec tsx scripts/command-path-transcript.ts
 *
 * The page works nothing out. Every amount on it was in the server's answer;
 * the page reads the file, checks it, and formats what it finds. The one
 * thing it derives is which day and which part of the day a step falls in,
 * which is the shared clock's arithmetic and no money.
 */

interface Ticket {
  id: string;
  quantity: number;
  priceCents: number;
  costCents: number;
  exit?: { kind: string; proceedsCents: number };
}

interface Entry {
  label: string;
  step: number;
  sent: string;
  receipt: Receipt;
  repeat: boolean;
  cashCents: number;
  rev: number;
  tickets: readonly Ticket[];
}

const WRONG_SHAPE = 'the command path transcript is not in the expected shape';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function wholeNumber(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) throw new Error(WRONG_SHAPE);
  return value;
}

function text(value: unknown): string {
  if (typeof value !== 'string') throw new Error(WRONG_SHAPE);
  return value;
}

/** What was sent, in a line: the kind of command, then what it named. The id is shown beneath it. */
function sentLine(command: Record<string, unknown>): string {
  const kind = text(command.t);
  if (kind === 'start') return `start, pace ${String(wholeNumber(command.pace))}`;
  if (kind === 'buy') {
    return `buy ticket ${String(wholeNumber(command.contractId))} on day ${String(wholeNumber(command.day))}, spend ${formatCents(wholeNumber(command.spendCents))}, saw ${formatCents(wholeNumber(command.seenPriceCents))}`;
  }
  if (kind === 'cashOut') return `cash out ${text(command.positionId)}`;
  return `${kind}, day ${String(wholeNumber(command.day))}`;
}

function readTicket(raw: unknown): Ticket {
  if (!isRecord(raw)) throw new Error(WRONG_SHAPE);
  const ticket: Ticket = {
    id: text(raw.id),
    quantity: wholeNumber(raw.quantity),
    priceCents: wholeNumber(raw.priceCents),
    costCents: wholeNumber(raw.costCents),
  };
  if (raw.exit === undefined) return ticket;
  if (!isRecord(raw.exit)) throw new Error(WRONG_SHAPE);
  return { ...ticket, exit: { kind: text(raw.exit.kind), proceedsCents: wholeNumber(raw.exit.proceedsCents) } };
}

/** The outer shape is checked by hand; every receipt goes through the shared receipt schema. */
function read(raw: string): readonly Entry[] {
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed) || !isRecord(parsed.recordedWith) || !Array.isArray(parsed.entries)) throw new Error(WRONG_SHAPE);
  return parsed.entries.map((entry: unknown): Entry => {
    if (!isRecord(entry) || !isRecord(entry.command) || !Array.isArray(entry.tickets) || typeof entry.repeat !== 'boolean') {
      throw new Error(WRONG_SHAPE);
    }
    return {
      label: text(entry.label),
      step: wholeNumber(entry.step),
      sent: sentLine(entry.command),
      receipt: receiptSchema.parse(entry.receipt),
      repeat: entry.repeat,
      cashCents: wholeNumber(entry.cashCents),
      rev: wholeNumber(entry.rev),
      tickets: entry.tickets.map(readTicket),
    };
  });
}

/** The lines of each day, in the order they came. */
function byDay(entries: readonly Entry[]): readonly { day: number; entries: readonly Entry[] }[] {
  const days: { day: number; entries: Entry[] }[] = [];
  for (const entry of entries) {
    const { day } = momentAt(entry.step);
    const last = days[days.length - 1];
    if (last !== undefined && last.day === day) last.entries.push(entry);
    else days.push({ day, entries: [entry] });
  }
  return days;
}

const DAYS = byDay(read(transcriptText));

/** Which part of the day a step falls in, in the words the game uses for it. */
function partOfDay(step: number): string {
  if (step % DAY_STEPS === BELL_STEP_IN_DAY) return 'at the closing bell';
  const { phase } = momentAt(step);
  if (phase === 'preBell') return 'before the bell';
  if (phase === 'open') return 'open market';
  return 'after the closing bell';
}

function ticketLine(ticket: Ticket): string {
  const held = `${ticket.id}: ${String(ticket.quantity)} filled at ${formatCents(ticket.priceCents)}, cost ${formatCents(ticket.costCents)}`;
  if (ticket.exit === undefined) return held;
  return `${held}; paid ${formatCents(ticket.exit.proceedsCents)} ${ticket.exit.kind === 'bell' ? 'at the bell' : 'on cash-out'}`;
}

/* The column heads speak in the game table's voice: small, medium weight, letter-spaced, quiet. */
const HEAD = 'bg-muted px-3 py-2 text-left text-[11px] font-medium tracking-[0.12em] text-muted-foreground';
const CELL = 'px-3 py-2.5 align-top';
const SMALL = 'mt-0.5 block text-[11px] text-muted-foreground';

function Row({ entry }: { entry: Entry }): ReactElement {
  const accepted = entry.receipt.outcome === 'accepted';
  return (
    <tr className="border-t border-border">
      <th scope="row" className={`${CELL} text-left font-normal text-foreground`}>
        {entry.label}
        <span className={SMALL}>
          step {entry.step}, {partOfDay(entry.step)}
        </span>
      </th>
      <td className={`${CELL} text-muted-foreground`}>
        {entry.sent}
        <span className={SMALL}>{entry.receipt.commandId}</span>
      </td>
      <td className={CELL}>
        <span className={`font-medium ${accepted ? 'text-up' : 'text-down'}`}>{entry.receipt.outcome}</span>
        {entry.receipt.reason === undefined ? null : <span className="mt-0.5 block text-[12px] text-down">{entry.receipt.reason}</span>}
      </td>
      <td className={CELL}>
        {entry.repeat ? (
          <span className="rounded-sm border border-ring px-1.5 py-0.5 text-[12px] text-foreground">repeat</span>
        ) : (
          <span className="text-[12px] text-muted-foreground">first time</span>
        )}
      </td>
      <td className={`${CELL} text-right tabular-nums text-foreground`}>{formatCents(entry.cashCents)}</td>
      <td className={`${CELL} text-right tabular-nums text-muted-foreground`}>{entry.rev}</td>
      <td className={`${CELL} text-muted-foreground`}>
        {entry.tickets.length === 0
          ? 'none'
          : entry.tickets.map((ticket) => (
              <span className="block tabular-nums" key={ticket.id}>
                {ticketLine(ticket)}
              </span>
            ))}
      </td>
    </tr>
  );
}

export default function CommandPathDemo(): ReactElement {
  return (
    <section id="lab-demo-command-path" className="mt-5" aria-label="Command path transcript">
      <div className="max-w-[68ch] text-[14px] text-foreground">
        <p className="m-0">
          The command path is one function on the server. A command goes in, an answer comes out, and nothing else
          happens. Below is a day and a half of one scripted game, with every kind of answer in it. Each line was made
          by calling the same function the server calls for every command, and written to a file this page reads.
        </p>
        <p className="mt-2 mb-0 text-muted-foreground">
          The page talks to no server and works nothing out: every amount was in the answer. A repeat is the same
          command id arriving again. It gets the first receipt back, and the cash, the revision and the tickets do not
          move. A cash-out that arrives after the closing bell is accepted, because the ticket really was sold, at the
          bell; the money is paid once however often it is pressed.
        </p>
      </div>
      <div className="mt-4 overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full min-w-[64rem] border-collapse text-[13px]">
          <thead>
            <tr>
              <th scope="col" className={HEAD}>What happened</th>
              <th scope="col" className={HEAD}>Sent</th>
              <th scope="col" className={HEAD}>Answer</th>
              <th scope="col" className={HEAD}>Repeat</th>
              <th scope="col" className={`${HEAD} text-right`}>Cash after</th>
              <th scope="col" className={`${HEAD} text-right`}>Revision</th>
              <th scope="col" className={HEAD}>Tickets</th>
            </tr>
          </thead>
          {DAYS.map(({ day, entries }) => (
            <tbody key={day}>
              <tr className="border-t border-border">
                <th scope="rowgroup" colSpan={7} className="bg-accent px-3 py-1.5 text-left text-[12px] font-medium text-accent-foreground">
                  <span>{`Day ${String(day)}`}</span>
                </th>
              </tr>
              {entries.map((entry, index) => (
                <Row entry={entry} key={index} />
              ))}
            </tbody>
          ))}
        </table>
      </div>
    </section>
  );
}
