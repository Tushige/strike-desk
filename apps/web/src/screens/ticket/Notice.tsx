import {
  CHECKING_WORDS,
  LOST_WORDS,
  PENDING_WORDS,
  REJECTED_LEAD,
  REJECTED_NO_REASON,
  RETRY_HINT,
  RETRY_LABEL,
} from '../../modules/order-ticket/words';
import { REJECT_WORDS, retryAllowed } from '../../modules/order-ticket/index';
import type { TicketMachine } from './useTicketMachine';
import { cx, GhostButton } from '../ui';

const ACCEPTED = {
  buy: 'Accepted. The ticket is yours.',
  cashOut: 'Accepted. You cashed out.',
};

/**
 * What became of the last press, said under the button: pending, checking
 * (with the safe retry), accepted, rejected with the reason, or lost.
 */
export function Notice({ machine }: { machine: TicketMachine }) {
  const { state, handlers } = machine;
  if (state.form === 'pending') {
    return (
      <p className="trade-pending m-0 text-sm font-semibold text-sun" role="status">
        {PENDING_WORDS}
      </p>
    );
  }
  if (state.form === 'checking') {
    return (
      <div className="flex flex-col gap-2" role="status">
        <p className="m-0 text-sm font-semibold text-sun">{CHECKING_WORDS}</p>
        {retryAllowed(state, true) && (
          <>
            <GhostButton
              tone="sun"
              className="h-11"
              disabled={machine.snapshot.line !== 'live'}
              onClick={handlers.onRetry}
            >
              {RETRY_LABEL}
            </GhostButton>
            <p className="m-0 text-xs text-muted">{RETRY_HINT}</p>
          </>
        )}
      </div>
    );
  }
  const notice = state.notice;
  if (notice === null) return null;
  if (notice.kind === 'accepted') {
    return (
      <p className="trade-accepted m-0 text-sm font-semibold text-mint" role="status">
        {ACCEPTED[notice.of]}
      </p>
    );
  }
  if (notice.kind === 'lost') {
    return (
      <p className="m-0 text-sm text-coral" role="status">
        {LOST_WORDS}
      </p>
    );
  }
  return (
    <p className={cx('m-0 text-sm text-coral')} role="status">
      <span className="font-semibold">{REJECTED_LEAD}</span>{' '}
      {notice.reason === null ? REJECTED_NO_REASON : REJECT_WORDS[notice.reason]}
    </p>
  );
}
