import { useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { RECORDED_LABELS } from '../../fixtures/recordedGame';
import type { RecordedLabel } from '../../fixtures/recordedGame';
import { deskPropsAt } from '../../modules/desk/fake';
import { CompanyChip, CompanyStrip, TopBar, stripWords } from '../../modules/desk/index';
import type { LineState } from '../../modules/desk/index';

/**
 * The desk pieces at any moment of the recorded game. The stand-in source
 * gives the props for the picked moment; the page lays its own state over
 * them: the state of the line and which company is selected. Nothing here
 * talks to a server, and no piece is given anything but props.
 */

const LINES: readonly LineState[] = ['live', 'stale', 'offline'];

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

export default function DeskDemo(): ReactElement {
  const [label, setLabel] = useState<RecordedLabel>('day1-open');
  const [line, setLine] = useState<LineState>('live');
  const [selectedId, setSelectedId] = useState(0);

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
      </div>

      <TopBar {...recorded.topBar} line={line} />
      <CompanyStrip label={stripWords.label}>
        {chips.map((chip) => (
          <CompanyChip key={chip.companyId} {...chip} />
        ))}
      </CompanyStrip>
    </div>
  );
}
