import { useId, useState } from 'react';
import { parseBudget } from './budget';
import { GameHelp } from '../GameHelp';
import type { Frame, Side } from '@strike-desk/shared/protocol';
import { BLOCKER_WORDS, breakEvenStopIndex, buyBlocker, quoteEchoes, stopAt } from '../../modules/order-ticket/index';
import type { BuyBlocker, TicketQuote } from '../../modules/order-ticket/index';
import { CHOICES, CHOICE_NOTES, choicesFor } from '../desk/pick';
import type { Pick } from '../desk/pick';
import { OpeningBellButton, SkipToBellButton } from '../desk/PhaseActions';
import { count, money, price, signedMoney } from '../format';
import { ActionDock, ArrowDown, ArrowUp, ChoiceButton, cx, InfoIcon, PrimaryButton } from '../ui';
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
        'flex h-14 min-w-0 flex-col items-center justify-center gap-0.5 rounded-lg border short:h-12',
        isUp
          ? selected ? 'border-mint bg-mint/15 text-mint' : 'border-line text-muted'
          : selected ? 'border-coral bg-coral/15 text-coral' : 'border-line text-muted',
      )}
    >
      <span className="flex items-center gap-1.5 text-[15px] font-semibold">
        <Icon className="size-5" />
        {isUp ? 'UP' : 'DOWN'}
      </span>
      <span className="text-xs font-medium">{isUp ? 'Pays above target' : 'Pays below target'}</span>
    </ChoiceButton>
  );
}

function summaryOf(machine: TicketMachine, pick: Pick) {
  const { state, snapshot } = machine;
  if (pick.side === null && pick.contractId === null) return 'Pick UP or DOWN to start your ticket.';
  if (snapshot.contract === null) return 'Now pick a target.';
  if (state.spendCents === null) return 'Now choose how much to spend.';
  if (!quoteEchoes(state, snapshot.quote)) return 'Getting the price…';
  const quote = snapshot.quote;
  if (quote.quantity < 1) return 'That is not enough for even one ticket. Spend more or pick a cheaper target.';
  const { contract } = snapshot;
  const side = contract.side === 'up' ? 'UP' : 'DOWN';
  return <span className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-2">
    <span className="col-span-2 whitespace-nowrap tabular-nums">{count(quote.quantity)} {side} tickets</span>
    <span>Price limit</span><span className="text-right whitespace-nowrap tabular-nums">{money(quote.limitPriceCents)} /ticket</span>
  </span>;
}

/**
 * "Scenario: what if, at the closing bell, the price reaches…": a slider over the stops
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
  const breakEven = breakEvenStopIndex(quote);
  const breakEvenStop = stopAt(quote, breakEven);
  const exactBreakEven = breakEvenStop?.profitCents === 0;
  return (
    <div className="price-scenario" data-outcome={stop.profitCents === 0 ? 'even' : ahead ? 'profit' : 'loss'}>
      <label htmlFor={id} className="text-[12px] text-muted">
        Scenario: what if, at the closing bell, {ticker} is at <span className="inline-block w-[8ch] text-right font-semibold text-cloud tabular-nums">{price(stop.atCents)}</span>?
      </label>
      <div className="scenario-result">
        <span>{stop.profitCents === 0 ? 'Break even' : ahead ? 'Profit at the bell' : 'Loss at the bell'}</span>
        <strong className="tabular-nums">{stop.profitCents === 0 ? '$0' : signedMoney(stop.profitCents)}</strong>
      </div>
      <div className="scenario-track">
        {exactBreakEven && last > 0 && <span className="scenario-break-even" style={{ left: `${String(breakEven / last * 100)}%` }} aria-hidden="true" />}
        <input
          id={id}
          type="range"
          min={0}
          max={last}
          step={1}
          value={index}
          className="scenario-slider"
          aria-valuetext={`${price(stop.atCents)}: ${signedMoney(stop.profitCents)}`}
          onChange={(event) => { setChosen({ contractId: quote.contractId, index: Number(event.currentTarget.value) }); }}
        />
      </div>
      <div className="scenario-scale" aria-hidden="true">
        <span>{price(quote.whatIf[0]?.atCents ?? stop.atCents)}</span>
        <span>{exactBreakEven ? 'Break-even tick' : 'Explore an outcome'}</span>
        <span>{price(quote.whatIf[last]?.atCents ?? stop.atCents)}</span>
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
  const [custom, setCustom] = useState<{ day: number; text: string } | null>(null);
  const [customDay, setCustomDay] = useState<number | null>(null);
  const editing = custom?.day === frame.clock.day ? custom.text : null;
  const showCustom = customDay === frame.clock.day || editing !== null;
  const budgetError = editing === null ? null : parseBudget(editing, cap).error;
  const customId = useId();

  return (
    <div className="ticket-builder flex min-h-full flex-col gap-3 short:gap-2.5">
      <div className="ticket-panel-heading flex items-center justify-between gap-3">
        <h2 className="m-0">Build your ticket</h2>
        <GameHelp ticket />
      </div>
      <div className="ticket-content">
      {frame.stress && <p className="m-0 flex items-start gap-2 text-xs text-sun"><InfoIcon className="mt-0.5 size-4 shrink-0" /><span>Read-only workload. Latest complete quote scenario, refreshed about every 1.5 seconds. Table prices can move between scenarios.</span></p>}

      <div className="flex flex-col gap-2 short:gap-1.5">
        <StepLabel>1. Which way will {company?.name ?? 'it'} go?</StepLabel>
        <div className="grid grid-cols-2 gap-2">
          <DirectionButton side="up" selected={pick.side === 'up'} onClick={() => { onChooseSide('up'); }} />
          <DirectionButton side="down" selected={pick.side === 'down'} onClick={() => { onChooseSide('down'); }} />
        </div>
      </div>

      <div className="flex flex-col gap-2 short:gap-1.5">
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
                'grid min-h-[58px] grid-cols-2 items-center gap-3 rounded-lg border px-3 py-2 text-left text-cloud short:min-h-[48px] short:py-1',
                selected ? 'border-sun bg-raised' : 'border-line',
              )}
            >
              <span className="flex min-w-0 flex-col gap-px">
                <span className="text-[15px] font-bold">{CHOICE_WORDS[target.choice]}</span>
                <span className="text-xs text-muted">{CHOICE_NOTES[target.choice]}</span>
              </span>
              <span className="flex shrink-0 flex-col items-end gap-px whitespace-nowrap tabular-nums">
                <span className="text-[15px] font-bold">{price(target.targetCents)}</span>
                <span className="text-xs text-muted">{ticketPrice === undefined ? '' : `${money(ticketPrice)} /ticket`}</span>
              </span>
            </ChoiceButton>
          );
        })}
        {pick.contractId !== null && pick.choice === null && snapshot.contract !== null && (
          <div className="grid min-h-[58px] grid-cols-2 items-center gap-3 rounded-lg border border-sun bg-raised px-3 py-2 text-left text-cloud short:min-h-[48px] short:py-1">
            <span className="flex flex-col gap-px">
              <span className="text-[15px] font-bold">From the table</span>
              <span className="text-xs text-muted">{snapshot.contract.ticker} {snapshot.contract.side === 'up' ? 'UP' : 'DOWN'}</span>
            </span>
            <span className="flex shrink-0 flex-col items-end gap-px whitespace-nowrap tabular-nums">
              <span className="text-[15px] font-bold">{price(snapshot.contract.targetCents)}</span>
              <span className="text-xs text-muted">{frame.quotes[snapshot.contract.contractId] === undefined ? '' : `${money(frame.quotes[snapshot.contract.contractId] ?? 0)} /ticket`}</span>
            </span>
          </div>
        )}
        {targets.length === 0 && CHOICES.map((choice) => (
          <div key={choice} className="flex min-h-[58px] items-center rounded-lg border border-line px-3 text-sm text-muted short:min-h-[48px]">
            {CHOICE_WORDS[choice]}
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-2 short:gap-1.5">
        <div className="flex items-baseline justify-between gap-2">
          <StepLabel>3. How much will you spend?</StepLabel>
          <button type="button" className="text-xs text-muted underline underline-offset-4 hover:text-cloud" disabled={locked}
            aria-expanded={showCustom} aria-controls={`${customId}-field`} onClick={() => { setCustomDay(frame.clock.day); }}>Custom</button>
        </div>
        <div className="grid grid-cols-4 gap-2">
          {[...SPEND_CHIPS, cap].map((amount, i) => {
            const half = i === SPEND_CHIPS.length;
            const selected = state.spendCents === amount;
            const tooMuch = half ? cap < frame.minTicketCents : amount > cap;
            return (
              <ChoiceButton
                key={half ? 'half' : amount}
                selected={selected}
                disabled={tooMuch || locked}
                title={half ? `Remaining daily allowance: ${money(cap)}` : undefined}
                aria-label={half ? `Remaining daily allowance, ${money(cap)}` : undefined}
                onClick={() => { setCustom(null); setCustomDay(null); handlers.onChooseSpend(amount); }}
                className={cx(
                  'h-12 rounded-lg border text-[15px] font-bold short:h-10',
                  selected ? 'border-sun bg-sun/10 text-sun' : 'border-line text-cloud',
                )}
              >
                {half ? 'Left' : `$${String(amount / 100_000)}K`}
              </ChoiceButton>
            );
          })}
        </div>
        {showCustom && <div id={`${customId}-field`} className="flex flex-col gap-1">
          <label htmlFor={customId} className="text-xs text-muted">Custom amount (dollars)</label>
          <input id={customId} inputMode="numeric" autoComplete="off" className="w-full rounded-xl border border-line bg-well px-3 py-2 text-sm text-cloud"
            value={editing ?? (state.spendCents === null ? '' : String(state.spendCents / 100))} disabled={locked}
            aria-invalid={budgetError !== null} aria-describedby={budgetError === null ? undefined : `${customId}-error`}
            onChange={(event) => { const text = event.currentTarget.value; setCustom({ day: frame.clock.day, text }); handlers.onChooseSpend(parseBudget(text, cap).cents); }} />
        </div>}
        {budgetError !== null && <p id={`${customId}-error`} className="m-0 text-xs text-coral" role="status">{budgetError}</p>}
      </div>

      </div>
      <ActionDock>
        <div className="ticket-cost-summary flex flex-col gap-3 text-sm leading-snug short:text-[13px]">
          <p className="m-0 min-h-[2.75em]">{summaryOf(machine, pick)}</p>
          {quote !== null && quote.quantity > 0 && quote.whatIf.length > 0 && snapshot.contract !== null && (
            <details className="scenario-disclosure text-xs text-muted">
              <summary className="cursor-pointer hover:text-cloud">Explore a price scenario</summary>
              <div className="pt-2"><WhatIf quote={quote} ticker={snapshot.contract.ticker} /></div>
            </details>
          )}
        </div>
        <PrimaryButton className={cx('h-[52px] short:h-11', quote !== null && quote.quantity > 0 && 'live-trade-action')} disabled={blocker !== null || budgetError !== null} onClick={() => { handlers.onPress('buy'); }}>
          {quote !== null && quote.quantity > 0 ? <><span>Buy for</span><span>{money(quote.costCents)}</span></> : 'Buy ticket'}
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
