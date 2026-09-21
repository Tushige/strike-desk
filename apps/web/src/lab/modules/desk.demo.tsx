import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { RECORDED_LABELS } from '../../fixtures/recordedGame';
import type { RecordedLabel } from '../../fixtures/recordedGame';
import { deskPropsAt } from '../../modules/desk/fake';
import { CompanyChip, CompanyStrip, NewsCard, PhaseScreen, RevealBanner, TopBar, stripWords } from '../../modules/desk/index';
import type { LineState, NewsCardProps, PhaseScreenProps } from '../../modules/desk/index';

/**
 * The whole desk at any moment of the recorded game, inside a frame of a
 * fixed size, so that "it fits one screen" can be looked at rather than
 * taken on trust. The stand-in source gives the props for the picked moment;
 * the page lays its own state over them: the state of the line, which
 * company is selected, whether a card is told how its news turned out, and
 * callbacks that say they were called. Nothing here talks to a server, and
 * no piece is given anything but props.
 */

const LINES: readonly LineState[] = ['live', 'stale', 'offline'];

const OUTCOMES = ['passed on', 'held back'] as const;
type OutcomeChoice = (typeof OUTCOMES)[number];

const FRAMES = [
  { name: '1440 by 900', width: 1440, height: 900 },
  { name: '1366 by 768', width: 1366, height: 768 },
] as const;
type FrameName = (typeof FRAMES)[number]['name'];

/*
 * The frame keeps its true size and is drawn smaller when the lab's column is
 * narrower than it. Each class name is written out in full because the
 * utility engine cannot see a name put together while the page runs.
 */
const SCALES = [
  { factor: 1, className: 'scale-100' },
  { factor: 0.9, className: 'scale-90' },
  { factor: 0.8, className: 'scale-80' },
  { factor: 0.7, className: 'scale-70' },
  { factor: 0.6, className: 'scale-60' },
  { factor: 0.5, className: 'scale-50' },
  { factor: 0.4, className: 'scale-40' },
  { factor: 0.3, className: 'scale-30' },
] as const;
const SMALLEST_SCALE = SCALES[7];

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

function isFrameName(value: string): value is FrameName {
  return FRAMES.some((frame) => frame.name === value);
}

/** The same card, never told how its news turned out. */
function withoutOutcome(card: NewsCardProps): NewsCardProps {
  const { outcome, ...rest } = card;
  // Taken out so that `rest` is everything else; deliberately not used.
  void outcome;
  return rest;
}

/** The stand-in's screen, with callbacks that report and the day's desk inside it. */
function screenWith(screen: PhaseScreenProps, report: (call: string) => void, children: ReactNode): PhaseScreenProps {
  switch (screen.phase) {
    case 'lobby':
      return {
        ...screen,
        onStart: (pace) => {
          report(`onStart(${String(pace)})`);
        },
      };
    case 'preBell':
      return {
        ...screen,
        children,
        onOpenBell: () => {
          report('onOpenBell()');
        },
      };
    case 'open':
      return {
        ...screen,
        children,
        onSkipToBell: () => {
          report('onSkipToBell()');
        },
      };
    case 'debrief':
      return {
        ...screen,
        children,
        onNextDay: () => {
          report('onNextDay()');
        },
      };
    case 'final':
      return {
        ...screen,
        onPlayAgain: () => {
          report('onPlayAgain()');
        },
      };
  }
}

export default function DeskDemo(): ReactElement {
  const [label, setLabel] = useState<RecordedLabel>('day1-after-reveal');
  const [line, setLine] = useState<LineState>('live');
  const [selectedId, setSelectedId] = useState(0);
  const [outcomes, setOutcomes] = useState<OutcomeChoice>('passed on');
  const [frameName, setFrameName] = useState<FrameName>('1440 by 900');
  const [lastCall, setLastCall] = useState('none yet');
  const [room, setRoom] = useState<number | null>(null);
  const [cutOff, setCutOff] = useState<boolean | null>(null);

  const columnRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);

  const frame = FRAMES.find((one) => one.name === frameName) ?? FRAMES[0];
  const scale = room === null ? SCALES[0] : (SCALES.find((one) => one.factor * frame.width <= room) ?? SMALLEST_SCALE);

  // How wide the lab's column is, measured when it changes and never while rendering.
  useEffect(() => {
    const column = columnRef.current;
    if (column === null) return undefined;
    const observer = new ResizeObserver(() => {
      setRoom(column.clientWidth);
    });
    observer.observe(column);
    return () => {
      observer.disconnect();
    };
  }, []);

  const recorded = useMemo(() => deskPropsAt(label), [label]);
  const chips = useMemo(
    () =>
      recorded.chips.map((chip) => ({
        ...chip,
        selected: chip.companyId === selectedId,
        onSelect: () => {
          setSelectedId(chip.companyId);
          setLastCall(`chip ${chip.ticker}: onSelect()`);
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
          setLastCall(`news card ${card.ticker}: onSelect()`);
        },
      })),
    [recorded, selectedId, outcomes],
  );
  const screen = useMemo(
    () =>
      screenWith(
        recorded.screen,
        setLastCall,
        <div className="grid grid-cols-3 gap-2">
          {news.map((card) => (
            <NewsCard key={card.companyId} {...card} />
          ))}
        </div>,
      ),
    [recorded, news],
  );

  // Is anything inside the frame taller or wider than the box it was given? Asked after each draw.
  useEffect(() => {
    const box = frameRef.current;
    if (box === null) return;
    const boxes = [box, ...box.querySelectorAll('[data-region="content"]')];
    setCutOff(boxes.some((one) => one.scrollHeight > one.clientHeight + 1 || one.scrollWidth > one.clientWidth + 1));
  }, [screen, chips, line, frameName]);

  return (
    <div id="lab-demo-desk" ref={columnRef} className="grid gap-4">
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
        <label className={CONTROL_LABEL}>
          Screen size
          <select
            className={CONTROL}
            name="frame"
            value={frameName}
            onChange={(event) => {
              if (isFrameName(event.target.value)) setFrameName(event.target.value);
            }}
          >
            {FRAMES.map((one) => (
              <option key={one.name} value={one.name}>
                {one.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div style={{ width: frame.width * scale.factor, height: frame.height * scale.factor }}>
        <div
          ref={frameRef}
          style={{ width: frame.width, height: frame.height }}
          className={`flex origin-top-left flex-col gap-3 overflow-hidden rounded-lg border border-border bg-background p-4 ${scale.className}`}
        >
          <TopBar {...recorded.topBar} line={line} />
          <RevealBanner {...recorded.banner} />
          <CompanyStrip label={stripWords.label}>
            {chips.map((chip) => (
              <CompanyChip key={chip.companyId} {...chip} />
            ))}
          </CompanyStrip>
          <div className="min-h-0 flex-1">
            <PhaseScreen {...screen} />
          </div>
        </div>
      </div>

      <dl className="m-0 grid gap-1 text-sm">
        <div className="flex gap-2">
          <dt className="text-muted-foreground">Frame</dt>
          <dd className="m-0">
            {frame.name}, drawn at {String(Math.round(scale.factor * 100))}% to fit this column
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-muted-foreground">Fits the frame</dt>
          <dd className="m-0" role="status">
            {cutOff === null ? 'measuring…' : cutOff ? 'no: something is cut off' : 'yes: nothing is cut off, nothing scrolls'}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-muted-foreground">Last callback</dt>
          <dd className="m-0 font-mono" role="status">
            {lastCall}
          </dd>
        </div>
      </dl>
    </div>
  );
}
