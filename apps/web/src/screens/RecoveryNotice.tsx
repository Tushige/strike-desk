import { connection, recovery, restoredIntent } from '../boot';
import { useView, usePendingCommands, useConnectionState } from '../store/hooks';
import { REJECT_WORDS } from '../modules/order-ticket/words';

/** Survives screen changes, including recovery straight into final results. */
export function RecoveryNotice() {
  const value = useView(recovery);
  const pending = usePendingCommands();
  const line = useConnectionState();
  if (value === null || value.intent.command.commandId !== restoredIntent?.command.commandId) return null;
  const outcome = value.outcome;
  const text = outcome === null ? 'Checking your last request…' : outcome.outcome === 'lost'
    ? 'Your last request could not be verified. Check the current day, balance and ticket. It will not be replayed into another day or game.'
    : outcome.outcome === 'accepted' ? 'Your last request was confirmed by the server.'
    : outcome.receipt.reason === undefined ? 'Your last request was declined.' : REJECT_WORDS[outcome.receipt.reason];
  const checking = pending.find((p) => p.command.commandId === value.intent.command.commandId)?.status === 'checking';
  return <aside role="status" className="border-b border-line px-4 py-2 text-sm text-sun">
    {text} {outcome === null && checking && <button type="button" className="ml-3 underline" disabled={line.phase !== 'live'}
      onClick={() => { connection.resend(value.intent.command.commandId); }}>Retry safely</button>}
  </aside>;
}
