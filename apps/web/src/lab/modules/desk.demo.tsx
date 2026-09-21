import { useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { RECORDED_LABELS } from '../../fixtures/recordedGame';
import type { RecordedLabel } from '../../fixtures/recordedGame';
import { deskPropsAt } from '../../modules/desk/fake';
import { CompanyChip, CompanyStrip, NewsCard, RevealBanner, TopBar, stripWords } from '../../modules/desk/index';
import type { LineState, NewsCardProps } from '../../modules/desk/index';

/**
 * The desk pieces at any moment of the recorded game. The stand-in source
 * gives the props for the picked moment; the page lays its own state over
 * them: the state of the line, which company is selected, and whether a
 * card is told how its news turned out. Nothing here talks to a server, and
 * no piece is given anything but props.
 */

const LINES: readonly LineState[] = ['live', 'stale', 'offline'];

const OUTCOMES = ['passed on', 'held back'] as const;
type OutcomeChoice = (typeof OUTCOMES)[number];

const CONTROL_LABEL = 'grid gap-1 text-xs text-muted-foreground';
const CONTROL =
  'rounded-sm border border-border bg-card px-2 py-1.5 text-sm text-foreground ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';

function isLabel(value: string): value is RecordedLabel {
  return RECORDED_LABELS.some((label) => label === value);
}

function isLine(value: string): value is LineState {
  return LINES.some((line) => line === value);
}

function isOutcomeChoice(value: string): value is OutcomeChoice {
  return OUTCOMES.some((choice) => choice === value);
}

/** The same card, never told how its news turned out. */
function withoutOutcome(card: NewsCardProps): NewsCardProps {
  const { outcome, ...rest } = card;
  // Taken out so that `rest` is everything else; deliberately not used.
  void outcome;
  return rest;
}

export default function DeskDemo(): ReactElement {
  const [label, setLabel] = useState<RecordedLabel>('day1-after-reveal');
  const [line, setLine] = useState<LineState>('live');
  const [selectedId, setSelectedId] = useState(0);
  const [outcomes, setOutcomes] = useState<OutcomeChoice>('passed on');

  const recorded = useMemo(() => deskPropsAt(label), [label]);
  const chips = useMemo(
    () =>
      recorded.chips.map((chip) => ({
        ...chip,
        selected: chip.companyId === selectedId,
        onSelect: () => {
          setSelectedId(chip.companyId);
        },
      })),
    [recorded, selectedId],
  );
  const news = useMemo(
    () =>
      recorded.news.map((card) => ({
        ...(outcomes === 'passed on' ? card : withoutOutcome(card)),
        selected: card.companyId === selectedId,
        onSelect: () => {
          setSelectedId(card.companyId);
        },
      })),
    [recorded, selectedId, outcomes],
  );

  return (
    <div id="lab-demo-desk" className="grid gap-4">
      <div className="flex flex-wrap items-end gap-4">
        <label className={CONTROL_LABEL}>
          Moment of the recorded game
          <select
            className={CONTROL}
            name="moment"
            value={label}
            onChange={(event) => {
              if (isLabel(event.target.value)) setLabel(event.target.value);
            }}
          >
            {RECORDED_LABELS.map((one) => (
              <option key={one} value={one}>
                {one}
              </option>
            ))}
          </select>
        </label>
        <label className={CONTROL_LABEL}>
          Line
          <select
            className={CONTROL}
            name="line"
            value={line}
            onChange={(event) => {
              if (isLine(event.target.value)) setLine(event.target.value);
            }}
          >
            {LINES.map((one) => (
              <option key={one} value={one}>
                {one}
              </option>
            ))}
          </select>
        </label>
        <label className={CONTROL_LABEL}>
          Selected company
          <select
            className={CONTROL}
            name="company"
            value={selectedId}
            onChange={(event) => {
              setSelectedId(Number(event.target.value));
            }}
          >
            {recorded.chips.map((chip) => (
              <option key={chip.companyId} value={chip.companyId}>
                {chip.name}
              </option>
            ))}
          </select>
        </label>
        <label className={CONTROL_LABEL}>
          How the news turned out (after the bell)
          <select
            className={CONTROL}
            name="outcomes"
            value={outcomes}
            onChange={(event) => {
              if (isOutcomeChoice(event.target.value)) setOutcomes(event.target.value);
            }}
          >
            {OUTCOMES.map((one) => (
              <option key={one} value={one}>
                {one}
              </option>
            ))}
          </select>
        </label>
      </div>

      <TopBar {...recorded.topBar} line={line} />
      <RevealBanner {...recorded.banner} />
      <CompanyStrip label={stripWords.label}>
        {chips.map((chip) => (
          <CompanyChip key={chip.companyId} {...chip} />
        ))}
      </CompanyStrip>
      <div className="grid grid-cols-3 gap-2 max-sm:grid-cols-1">
        {news.map((card) => (
          <NewsCard key={card.companyId} {...card} />
        ))}
      </div>
    </div>
  );
}
