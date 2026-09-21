import { useEffect, useId, useMemo, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { RECORDED_LABELS, recordedFrame } from '../../fixtures/recordedGame';
import type { RecordedLabel } from '../../fixtures/recordedGame';
import { PriceChart } from '../../modules/price-chart/index';
import type { ChartLine, ChartMarker, Series, SeriesSource } from '../../modules/price-chart/index';
import {
  FAKE_LINES,
  FAKE_MARKERS,
  FAKE_RANGE,
  createFakeSeriesSource,
  recordedSeries,
} from '../../modules/price-chart/fake';

/**
 * The price chart by itself, twice over: a made-up day drawn a point at a
 * time from a seeded series that moves only when this page tells it to, and a
 * day of a recorded game, shown whole. Nothing here talks to the game.
 *
 * The words on the lines and the markers are the stand-in data's own; the
 * game writes its own.
 */

/** Five points a second, the pace the game's prices arrive at. */
const POINT_EVERY_MS = 200;

/** A whole day is the opening price and 500 more. */
const POINTS_IN_A_DAY = 500;

/** How far a headline moves the made-up price when it lands, in percent. */
const NEWS_JUMP_PERCENT = 6;

/** The company of the recording that is shown: the first. */
const RECORDED_COMPANY = 0;

/** Held here, outside the component, so the chart is handed the same two lists on every render. */
const NO_LINES: readonly ChartLine[] = [];
const NO_MARKERS: readonly ChartMarker[] = [];

/** The moments of the recording that hold prices to draw, in the order they were recorded. */
const LABELS_WITH_PRICES = RECORDED_LABELS.filter(
  (label) => recordedSeries(label, RECORDED_COMPANY).values.length > 0,
);

/** A series that is finished: it never changes, so there is nothing to tell a subscriber. */
function finishedSource(series: Series): SeriesSource {
  return { series: () => series, subscribe: () => () => undefined };
}

/**
 * The scale for a recorded day, as the chart's port asks for it: the lowest
 * and the highest target on that day's board for the company. The board lists
 * a company's targets lowest first, so the two are picked from its ends and
 * nothing is worked out; above all, not from the prices the day went on to
 * have.
 */
function boardScaleOf(label: RecordedLabel): { yMinCents: number; yMaxCents: number } | null {
  const targets = recordedFrame(label).board?.companies[RECORDED_COMPANY]?.targets;
  const lowest = targets?.[0];
  const highest = targets?.at(-1);
  return lowest === undefined || highest === undefined ? null : { yMinCents: lowest, yMaxCents: highest };
}

function LabButton(props: { onClick: () => void; disabled?: boolean; children: ReactNode }): ReactElement {
  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={props.disabled}
      className="rounded-md border border-border bg-muted px-3 py-1.5 text-sm text-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50"
    >
      {props.children}
    </button>
  );
}

function LabSwitch(props: { checked: boolean; onChange: (checked: boolean) => void; children: ReactNode }): ReactElement {
  return (
    <label className="flex items-center gap-1.5 text-sm">
      <input
        type="checkbox"
        checked={props.checked}
        onChange={(event) => {
          props.onChange(event.target.checked);
        }}
        className="size-4 accent-ring focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      />
      {props.children}
    </label>
  );
}

function SectionTitle({ children }: { children: ReactNode }): ReactElement {
  return <h3 className="m-0 text-sm font-medium">{children}</h3>;
}

function Note({ children }: { children: ReactNode }): ReactElement {
  return <p className="m-0 max-w-[68ch] text-xs text-muted-foreground">{children}</p>;
}

export default function PriceChartDemo(): ReactElement {
  const [source] = useState(() => createFakeSeriesSource({ seed: 11, startCents: 8_400 }));
  const [playing, setPlaying] = useState(false);
  const [showLines, setShowLines] = useState(true);
  const [showMarkers, setShowMarkers] = useState(true);
  const [stale, setStale] = useState(false);
  const [recordedLabel, setRecordedLabel] = useState<RecordedLabel | undefined>(LABELS_WITH_PRICES.at(-1));
  const pickerId = useId();

  useEffect(() => {
    if (!playing) return undefined;

    const timer = setInterval(() => {
      if (source.series().values.length > POINTS_IN_A_DAY) {
        setPlaying(false);
        return;
      }
      source.push(1);
    }, POINT_EVERY_MS);
    return () => {
      clearInterval(timer);
    };
  }, [playing, source]);

  const recorded = useMemo(() => {
    if (recordedLabel === undefined) return null;
    const scale = boardScaleOf(recordedLabel);
    if (scale === null) return null;
    return { source: finishedSource(recordedSeries(recordedLabel, RECORDED_COMPANY)), scale };
  }, [recordedLabel]);

  const lines = showLines ? FAKE_LINES : NO_LINES;
  const markers = showMarkers ? FAKE_MARKERS : NO_MARKERS;

  return (
    <div id="lab-demo-price-chart" className="grid gap-6">
      <section className="grid gap-3">
        <SectionTitle>A made-up day, a point at a time</SectionTitle>
        <div className="flex flex-wrap items-center gap-2">
          <LabButton
            onClick={() => {
              setPlaying(true);
            }}
            disabled={playing}
          >
            Play
          </LabButton>
          <LabButton
            onClick={() => {
              setPlaying(false);
            }}
            disabled={!playing}
          >
            Pause
          </LabButton>
          <LabButton
            onClick={() => {
              setPlaying(false);
              source.reset();
            }}
          >
            Start again
          </LabButton>
          <LabButton
            onClick={() => {
              source.jump(NEWS_JUMP_PERCENT);
            }}
          >
            Good news lands
          </LabButton>
          <LabButton
            onClick={() => {
              source.jump(-NEWS_JUMP_PERCENT);
            }}
          >
            Bad news lands
          </LabButton>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <LabSwitch checked={showLines} onChange={setShowLines}>
            Lines
          </LabSwitch>
          <LabSwitch checked={showMarkers} onChange={setShowMarkers}>
            Markers
          </LabSwitch>
          <LabSwitch checked={stale} onChange={setStale}>
            Prices are stale
          </LabSwitch>
        </div>
        {/*
          The handle at this box's bottom right corner drags it wider and
          narrower. The chart is told nothing: it measures the box and follows.
        */}
        <div className="h-72 w-full max-w-full min-w-64 resize-x overflow-hidden rounded-lg border border-border bg-background">
          <PriceChart
            source={source}
            {...FAKE_RANGE}
            lines={lines}
            markers={markers}
            stale={stale}
            label="The price of a made-up company through one day"
          />
        </div>
        <Note>
          Play adds five points a second and stops at the closing bell. News lands as one jump. If a jump takes the
          price off the scale, the scale widens to hold it and stays widened until Start again. Drag the corner of the
          box to resize it.
        </Note>
      </section>

      <section className="grid gap-3">
        <SectionTitle>A day of a recorded game</SectionTitle>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <label htmlFor={pickerId}>Moment of the recording</label>
          <select
            id={pickerId}
            value={recordedLabel}
            onChange={(event) => {
              setRecordedLabel(LABELS_WITH_PRICES.find((label) => label === event.target.value));
            }}
            className="rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {LABELS_WITH_PRICES.map((label) => (
              <option key={label} value={label}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="h-72 rounded-lg border border-border bg-background">
          {recorded === null ? null : (
            <PriceChart
              source={recorded.source}
              xMin={FAKE_RANGE.xMin}
              xMax={FAKE_RANGE.xMax}
              {...recorded.scale}
              lines={lines}
              markers={markers}
              stale={stale}
              label="The price of the first company of a recorded game, as far as that moment"
            />
          )}
        </div>
        <Note>
          The first company&apos;s prices as the chosen moment of the recording holds them. The scale is the lowest and
          the highest target on that day&apos;s board, never the prices the day went on to have. The lines and markers
          are the same stand-ins as above, not the recorded game&apos;s own.
        </Note>
      </section>
    </div>
  );
}
