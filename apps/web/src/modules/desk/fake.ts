import { PACES } from '@strike-desk/shared/time';
import { recordedFrame } from '../../fixtures/recordedGame';
import type { RecordedLabel } from '../../fixtures/recordedGame';
import type { CompanyChipProps, DaySummary, DeskProps, NewsCardProps, PhaseScreenProps, Trend } from './ports';

/**
 * Props for every desk piece at a moment of the recorded game, for showing
 * the pieces away from the running game and for tests.
 *
 * Everything here is picked out of a recorded frame, or found by comparing
 * two numbers the frame holds. Nothing is worked out: no amount is added,
 * taken away or scaled. Every callback does nothing, the first company is the
 * selected one, and the line is always live.
 */

type RecordedFrame = ReturnType<typeof recordedFrame>;

const SELECTED_COMPANY = 0;

function nothing(): void {
  return undefined;
}

/** Against the day's open, by comparing; flat when either number is missing. */
function trendOf(priceCents: number | null, openCents: number | undefined): Trend {
  if (priceCents === null || openCents === undefined) return 'flat';
  if (priceCents > openCents) return 'up';
  if (priceCents < openCents) return 'down';
  return 'flat';
}

function chipsOf(frame: RecordedFrame): CompanyChipProps[] {
  return frame.companies.map((company, companyId) => {
    const priceCents = frame.prices[companyId] ?? null;
    return {
      companyId,
      ticker: company.ticker,
      name: company.name,
      priceCents,
      trend: trendOf(priceCents, frame.history?.[companyId]?.[0]),
      hasNews: frame.news.some((item) => item.companyId === companyId),
      selected: companyId === SELECTED_COMPANY,
      onSelect: nothing,
    };
  });
}

function newsOf(frame: RecordedFrame): NewsCardProps[] {
  return frame.news.map((item) => {
    const company = frame.companies[item.companyId];
    const card: NewsCardProps = {
      companyId: item.companyId,
      companyName: company?.name ?? '',
      ticker: company?.ticker ?? '',
      trust: item.trust,
      source: item.source,
      title: item.title,
      body: item.body,
      direction: item.direction,
      revealed: item.revealed,
      selected: item.companyId === SELECTED_COMPANY,
      onSelect: nothing,
    };
    if (item.wasTrue === undefined) return card;
    return { ...card, outcome: item.wasTrue ? 'true' : 'false' };
  });
}

/** The company of the first headline that is out while the day is still running. */
function bannerCompanyOf(frame: RecordedFrame): string | null {
  const item = frame.news.find((candidate) => candidate.revealed && candidate.wasTrue === undefined);
  if (item === undefined) return null;
  return frame.companies[item.companyId]?.name ?? null;
}

function summaryOf(day: RecordedFrame['days'][number]): DaySummary {
  return { day: day.day, startCents: day.startCents, endCents: day.endCents, changeCents: day.changeCents };
}

function screenOf(frame: RecordedFrame): PhaseScreenProps {
  const { phase, day } = frame.clock;
  switch (phase) {
    case 'lobby':
      return { phase, paces: PACES, canStart: true, onStart: nothing };
    case 'preBell':
      return { phase, day, canAct: true, onOpenBell: nothing, children: null };
    case 'open':
      return { phase, day, canAct: true, onSkipToBell: nothing, children: null };
    case 'debrief': {
      const result = frame.days.find((candidate) => candidate.day === day);
      return { phase, day, result: result === undefined ? null : summaryOf(result), canAct: true, onNextDay: nothing, children: null };
    }
    case 'final':
      return {
        phase,
        finalCents: frame.final?.finalCents ?? frame.account.worthCents,
        changeCents: frame.final?.changeCents ?? 0,
        marketCode: frame.final?.marketCode ?? '',
        days: frame.days.map(summaryOf),
        onPlayAgain: nothing,
      };
  }
}

export function deskPropsAt(label: RecordedLabel): DeskProps {
  const frame = recordedFrame(label);
  return {
    topBar: {
      worthCents: frame.account.worthCents,
      cashCents: frame.account.cashCents,
      day: frame.clock.day,
      phase: frame.clock.phase,
      stepsLeft: frame.clock.stepsLeft,
      pace: frame.clock.pace,
      line: 'live',
    },
    chips: chipsOf(frame),
    news: newsOf(frame),
    banner: { companyName: bannerCompanyOf(frame) },
    screen: screenOf(frame),
  };
}
