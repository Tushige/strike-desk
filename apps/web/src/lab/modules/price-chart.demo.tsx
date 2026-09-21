import { useEffect, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { PriceChart } from '../../modules/price-chart/index';
import type { ChartLine, ChartMarker } from '../../modules/price-chart/index';
import { FAKE_RANGE, createFakeSeriesSource } from '../../modules/price-chart/fake';

/**
 * The price chart by itself: a made-up day drawn a point at a time, from a
 * seeded series that moves only when this page tells it to. Nothing here
 * talks to the game.
 */

/** Five points a second, the pace the game's prices arrive at. */
const POINT_EVERY_MS = 200;

/** A whole day is the opening price and 500 more. */
const POINTS_IN_A_DAY = 500;

/** Held here, outside the component, so the chart is handed the same two lists on every render. */
const NO_LINES: readonly ChartLine[] = [];
const NO_MARKERS: readonly ChartMarker[] = [];

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

export default function PriceChartDemo(): ReactElement {
  const [source] = useState(() => createFakeSeriesSource({ seed: 11, startCents: 8_400 }));
  const [playing, setPlaying] = useState(false);

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

  return (
    <div id="lab-demo-price-chart" className="grid gap-3">
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
      </div>
      <div className="h-72 rounded-lg border border-border bg-background">
        <PriceChart
          source={source}
          {...FAKE_RANGE}
          lines={NO_LINES}
          markers={NO_MARKERS}
          stale={false}
          label="The price of a made-up company through one day"
        />
      </div>
    </div>
  );
}
