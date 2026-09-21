import type { ReactElement } from 'react';
import { formatCents } from '@strike-desk/shared/money';
import { receiptSchema } from '@strike-desk/shared/protocol';
import type { Receipt } from '@strike-desk/shared/protocol';
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
 * The page works nothing out. Every number on it was in the server's answer;
 * the page reads the file, checks it, and formats what it finds.
 */

interface Ticket {
  id: string;
  quantity: number;
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

/** What was sent, in a line: the kind of command, then what it named. The id is shown beside it. */
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
  const ticket: Ticket = { id: text(raw.id), quantity: wholeNumber(raw.quantity), costCents: wholeNumber(raw.costCents) };
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

const ENTRIES = read(transcriptText);

function ticketLine(ticket: Ticket): string {
  const held = `${ticket.id}: ${String(ticket.quantity)} for ${formatCents(ticket.costCents)}`;
  if (ticket.exit === undefined) return held;
  return `${held}, paid ${formatCents(ticket.exit.proceedsCents)} ${ticket.exit.kind === 'bell' ? 'at the bell' : 'on cash-out'}`;
}

const HEAD = 'px-3 py-2 text-left text-[11px] font-normal uppercase tracking-[0.12em] text-muted-foreground';
const CELL = 'px-3 py-2 align-top';

function Row({ entry }: { entry: Entry }): ReactElement {
  const accepted = entry.receipt.outcome === 'accepted';
  return (
    <tr className="border-t border-border">
      <th scope="row" className={`${CELL} text-left font-normal text-foreground`}>
        {entry.label}
      </th>
      <td className={`${CELL} text-right tabular-nums text-muted-foreground`}>{entry.step}</td>
      <td className={`${CELL} text-muted-foreground`}>
        {entry.sent}
        <span className="block text-[11px]">{entry.receipt.commandId}</span>
      </td>
      <td className={`${CELL} ${accepted ? 'text-up' : 'text-down'}`}>
        {entry.receipt.outcome}
        {entry.receipt.reason === undefined ? null : <span className="block text-[11px]">{entry.receipt.reason}</span>}
      </td>
      <td className={`${CELL} ${entry.repeat ? 'text-gold' : 'text-muted-foreground'}`}>{entry.repeat ? 'repeat' : 'first time'}</td>
      <td className={`${CELL} text-right tabular-nums text-foreground`}>{formatCents(entry.cashCents)}</td>
      <td className={`${CELL} text-right tabular-nums text-muted-foreground`}>{entry.rev}</td>
      <td className={`${CELL} text-muted-foreground`}>
        {entry.tickets.length === 0 ? 'none' : entry.tickets.map((ticket) => <span className="block" key={ticket.id}>{ticketLine(ticket)}</span>)}
      </td>
    </tr>
  );
}

export default function CommandPathDemo(): ReactElement {
  return (
    <section id="lab-demo-command-path" className="mt-5 overflow-x-auto rounded-lg border border-border bg-card" aria-label="Command path transcript">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr>
            <th scope="col" className={HEAD}>What happened</th>
            <th scope="col" className={`${HEAD} text-right`}>Step</th>
            <th scope="col" className={HEAD}>Sent</th>
            <th scope="col" className={HEAD}>Answer</th>
            <th scope="col" className={HEAD}>Repeat</th>
            <th scope="col" className={`${HEAD} text-right`}>Cash</th>
            <th scope="col" className={`${HEAD} text-right`}>Revision</th>
            <th scope="col" className={HEAD}>Tickets</th>
          </tr>
        </thead>
        <tbody>
          {ENTRIES.map((entry, index) => (
            <Row entry={entry} key={index} />
          ))}
        </tbody>
      </table>
    </section>
  );
}
