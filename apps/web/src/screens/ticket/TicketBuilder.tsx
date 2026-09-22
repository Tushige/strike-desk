import { useId, useState } from 'react';
import type { Frame, Side } from '@strike-desk/shared/protocol';
import { BLOCKER_WORDS, breakEvenStopIndex, buyBlocker, quoteEchoes, stopAt } from '../../modules/order-ticket/index';
import type { BuyBlocker, TicketQuote } from '../../modules/order-ticket/index';
import { CHOICES, CHOICE_NOTES, choicesFor } from '../desk/pick';
import type { Pick } from '../desk/pick';
import { OpeningBellButton, SkipToBellButton } from '../desk/PhaseActions';
import { count, money, price, signedMoney } from '../format';
import { ActionDock, ArrowDown, ArrowUp, ChoiceButton, cx, PrimaryButton } from '../ui';
import { Notice } from './Notice';
import { SPEND_CHIPS } from './useTicketMachine';
import type { TicketMachine } from './useTicketMachine';

/**
 * Build a ticket the simple way: UP or DOWN, then Close, Far or Moonshot,
 * then how much to spend. Every number on it is the server's: the targets
 * and the ticket prices from the frame, what the spend buys from the quote.
 * The buy goes out only on the press, at the price on screen.
 */

const CHOICE_WORDS = { close: 'Close', far: 'Far', moonshot: 'Moonshot' } as const;

/** Blockers the summary sentence already explains are not said twice. */
const QUIET_BLOCKERS: readonly (BuyBlocker | null)[] = [null, 'notDraft', 'noContract', 'noSpend', 'waitingForQuote'];

const StepLabel = ({ children }: { children: React.ReactNode }) => <div className="text-sm font-semibold text-muted">{children}</div>;

function DirectionButton({ side, selected, onClick }: { side: Side; selected: boolean; onClick: () => void }) {
  const isUp = side === 'up';
  const Icon = isUp ? ArrowUp : ArrowDown;
  return (
    <ChoiceButton
      selected={selected}
      onClick={onClick}
      className={cx(
        'flex h-[76px] flex-col items-center justify-center gap-0.5 rounded-[18px] border-2 short:h-14',
        isUp
          ? selected ? 'border-mint bg-mint text-ink' : 'border-mint/50 bg-mint/10 text-mint'
          : selected ? 'border-coral bg-coral text-ink' : 'border-coral/50 bg-coral/10 text-coral',
      )}
    >
      <span className="flex items-center gap-1.5 font-display text-lg font-extrabold">
        <Icon className="size-5" />
        {isUp ? 'UP' : 'DOWN'}
      </span>
      <span className="text-xs font-medium">{isUp ? 'Wins if the price climbs' : 'Wins if the price drops'}</span>
    </ChoiceButton>
  );
}

function summaryOf(machine: TicketMachine, pick: Pick): string {
  const { state, snapshot } = machine;
  if (pick.side === null && pick.contractId === null) return 'Pick UP or DOWN to start your ticket.';
  if (snapshot.contract === null) return 'Now pick a target.';
  if (state.spendCents === null) return 'Now choose how much to spend.';
  if (!quoteEchoes(state, snapshot.quote)) return 'Getting the price…';
  const quote = snapshot.quote;
  if (quote.quantity < 1) return 'That is not enough for even one ticket. Spend more or pick a cheaper target.';
  const { contract } = snapshot;
  const side = contract.side === 'up' ? 'UP' : 'DOWN';
  return `You get ${count(quote.quantity)} ${side} tickets for ${money(quote.costCents)}.`;
}

/**
 * "What if, at the closing bell, the price reaches…": a slider over the stops
 * the server quoted, each with the profit or loss the ticket would make if the
 * share price finished exactly there. The page looks a stop up; it multiplies
 * nothing.
 */
function WhatIf({ quote, ticker }: { quote: TicketQuote; ticker: string }) {
  const id = useId();
  const [chosen, setChosen] = useState<{ contractId: number; index: number } | null>(null);
  const last = quote.whatIf.length - 1;
  const index = chosen !== null && chosen.contractId === quote.contractId ? Math.min(chosen.index, last) : breakEvenStopIndex(quote);
  const stop = stopAt(quote, index);
  if (stop === null) return null;
  const ahead = stop.profitCents >= 0;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-[12px] text-muted">
        What if, at the closing bell, {ticker} is at <span className="font-semibold text-cloud tabular-nums">{price(stop.atCents)}</span>?
      </label>
      <div className="flex items-center gap-3">
        <input
          id={id}
          type="range"
          min={0}
          max={last}
          step={1}
          value={index}
          className="h-2 grow accent-sun"
          aria-valuetext={`${price(stop.atCents)}: ${signedMoney(stop.profitCents)}`}
          onChange={(event) => { setChosen({ contractId: quote.contractId, index: Number(event.currentTarget.value) }); }}
        />
        <span className={cx('w-24 shrink-0 text-right text-[15px] font-bold tabular-nums', ahead ? 'text-mint' : 'text-coral')}>{signedMoney(stop.profitCents)}</span>
      </div>
    </div>
  );
}

export function TicketBuilder({
  frame,
  companyId,
  pick,
  onChooseSide,
  onChooseChoice,
  machine,
}: {
  frame: Frame;
  companyId: number;
  pick: Pick;
  onChooseSide: (side: Side) => void;
  onChooseChoice: (choice: Pick['choice']) => void;
  machine: TicketMachine;
}) {
  const { state, snapshot, handlers } = machine;
  const company = frame.companies[companyId];
  const side = pick.side ?? 'up';
  const targets = choicesFor(frame.board, companyId).filter((choice) => choice.side === side);
  const cap = snapshot.account.capCents;
  const blocker = buyBlocker(state, snapshot);
  const quote = quoteEchoes(state, snapshot.quote) ? snapshot.quote : null;
  const locked = state.form !== 'draft' && state.form !== 'rejected';

  return (
    <div className="flex min-h-full flex-col gap-4 short:gap-3">
      <h2 className="m-0 font-display text-xl font-bold short:text-lg">Build your ticket</h2>

      <div className="flex flex-col gap-2">
        <StepLabel>1. Which way will {company?.name ?? 'it'} go?</StepLabel>
        <div className="grid grid-cols-2 gap-2.5">
          <DirectionButton side="up" selected={pick.side === 'up'} onClick={() => { onChooseSide('up'); }} />
          <DirectionButton side="down" selected={pick.side === 'down'} onClick={() => { onChooseSide('down'); }} />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <StepLabel>2. How far? Pick a target price</StepLabel>
        {targets.map((target) => {
          const selected = pick.side !== null && snapshot.contract?.contractId === target.contractId;
          const ticketPrice = frame.quotes[target.contractId];
          return (
            <ChoiceButton
              key={target.choice}
              selected={selected}
              disabled={pick.side === null || locked}
              onClick={() => { onChooseChoice(target.choice); }}
              className={cx(
                'flex h-[58px] items-center justify-between rounded-2xl border-2 px-4 text-left text-cloud short:h-[46px]',
                selected ? 'border-sun bg-raised' : 'border-line',
              )}
            >
              <span className="flex flex-col gap-px">
                <span className="text-[15px] font-bold">{CHOICE_WORDS[target.choice]}</span>
                <span className="text-xs text-muted">{CHOICE_NOTES[target.choice]}</span>
              </span>
              <span className="flex flex-col items-end gap-px tabular-nums">
                <span className="text-[15px] font-bold">{price(target.targetCents)}</span>
                <span className="text-xs text-muted">{ticketPrice === undefined ? '' : `${money(ticketPrice)} per ticket`}</span>
              </span>
            </ChoiceButton>
          );
        })}
        {pick.contractId !== null && pick.choice === null && snapshot.contract !== null && (
          <div className="flex h-[58px] items-center justify-between rounded-2xl border-2 border-sun bg-raised px-4 text-left text-cloud short:h-[46px]">
            <span className="flex flex-col gap-px">
              <span className="text-[15px] font-bold">From the table</span>
              <span className="text-xs text-muted">Your own target.</span>
            </span>
            <span className="flex flex-col items-end gap-px tabular-nums">
              <span className="text-[15px] font-bold">{price(snapshot.contract.targetCents)}</span>
              <span className="text-xs text-muted">{frame.quotes[snapshot.contract.contractId] === undefined ? '' : `${money(frame.quotes[snapshot.contract.contractId] ?? 0)} per ticket`}</span>
            </span>
          </div>
        )}
        {targets.length === 0 && CHOICES.map((choice) => (
          <div key={choice} className="flex h-[58px] items-center rounded-2xl border-2 border-line px-4 text-sm text-muted short:h-[46px]">
            {CHOICE_WORDS[choice]}
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-2">
        <StepLabel>3. How much will you spend?</StepLabel>
        <div className="grid grid-cols-4 gap-2">
          {[...SPEND_CHIPS, cap].map((amount, i) => {
            const half = i === SPEND_CHIPS.length;
            const selected = state.spendCents === amount;
            const tooMuch = half ? cap < 100_000 : amount > cap;
            return (
              <ChoiceButton
                key={half ? 'half' : amount}
                selected={selected}
                disabled={tooMuch || locked}
                onClick={() => { handlers.onChooseSpend(amount); }}
                className={cx(
                  'h-12 rounded-[14px] border-2 text-[15px] font-bold short:h-10',
                  selected ? 'border-sun bg-sun text-ink' : 'border-line text-cloud',
                )}
              >
                {half ? 'Half' : `$${String(amount / 100_000)}K`}
              </ChoiceButton>
            );
          })}
        </div>
        <div className="text-xs text-muted short:hidden">Desk rule: never bet more than half your cash in one day.</div>
      </div>

      <ActionDock>
        <div className="flex min-h-[60px] flex-col gap-1.5 rounded-[14px] bg-raised px-3.5 py-3 text-sm leading-snug short:min-h-[52px] short:py-2.5 short:text-[13px]" aria-live="polite">
          <p className="m-0">{summaryOf(machine, pick)}</p>
          {quote !== null && quote.quantity > 0 && quote.whatIf.length > 0 && snapshot.contract !== null && (
            <WhatIf quote={quote} ticker={snapshot.contract.ticker} />
          )}
        </div>
        <PrimaryButton className="h-[60px] short:h-[50px]" disabled={blocker !== null} onClick={() => { handlers.onPress('buy'); }}>
          {quote !== null && quote.quantity > 0 ? `Buy for ${money(quote.costCents)}` : 'Buy ticket'}
        </PrimaryButton>
        {!QUIET_BLOCKERS.includes(blocker) && blocker !== null && BLOCKER_WORDS[blocker] !== null && (
          <p className="m-0 text-xs text-muted" role="status">{BLOCKER_WORDS[blocker]}</p>
        )}
        <Notice machine={machine} />
        {frame.clock.phase === 'preBell' ? <OpeningBellButton frame={frame} compact /> : <SkipToBellButton frame={frame} compact />}
      </ActionDock>
    </div>
  );
}
