import { describe, expect, it } from 'vitest';
import { RECORDED_LABELS, recordedFrame } from '../src/fixtures/recordedGame';
import { deskPropsAt } from '../src/modules/desk/fake';
import { describeDeskPropsContract } from './contracts/deskProps.contract';

/**
 * The desk props' laws, tried against the props picked from every moment of
 * the recorded game, and what those props are at four of its moments.
 */

describeDeskPropsContract('the recorded game', () => RECORDED_LABELS.map(deskPropsAt));

describe('desk props picked from the recorded game', () => {
  it('are a quiet lobby before the game starts', () => {
    const props = deskPropsAt('lobby');

    expect(props.topBar.worthCents).toBe(100_000_000);
    expect(props.topBar.cashCents).toBe(100_000_000);
    expect(props.topBar.phase).toBe('lobby');
    expect(props.topBar.day).toBe(0);
    expect(props.topBar.line).toBe('live');
    expect(props.news).toEqual([]);
    expect(props.banner.companyName).toBeNull();
    expect(props.chips.map((chip) => chip.trend)).toEqual(['flat', 'flat', 'flat', 'flat', 'flat', 'flat']);
    expect(props.screen.phase === 'lobby' ? props.screen.paces : null).toEqual([1, 3, 7.5]);
  });

  it('carry the names, tickers and prices the frame holds', () => {
    const frame = recordedFrame('day1-open');
    const props = deskPropsAt('day1-open');

    expect(props.chips.map((chip) => chip.name)).toEqual(frame.companies.map((company) => company.name));
    expect(props.chips.map((chip) => chip.ticker)).toEqual(frame.companies.map((company) => company.ticker));
    expect(props.chips.map((chip) => chip.priceCents)).toEqual(frame.prices);
    expect(props.chips.map((chip) => chip.selected)).toEqual([true, false, false, false, false, false]);
    expect(props.topBar.stepsLeft).toBe(frame.clock.stepsLeft);
    expect(props.topBar.pace).toBe(1);
  });

  it('name on the banner a company whose headline is out, just after it came out', () => {
    const props = deskPropsAt('day1-after-reveal');
    const out = props.news.filter((card) => card.revealed).map((card) => card.companyName);

    expect(props.banner.companyName).not.toBeNull();
    expect(out).toContain(props.banner.companyName);
    expect(props.news.every((card) => card.outcome === undefined)).toBe(true);
  });

  it('show the debrief of day one with the change the server sent', () => {
    const { screen } = deskPropsAt('day1-debrief');
    const [firstDay] = recordedFrame('day1-debrief').days;

    expect(screen.phase).toBe('debrief');
    expect(screen.phase === 'debrief' ? screen.day : null).toBe(1);
    expect(firstDay).toBeDefined();
    expect(screen.phase === 'debrief' ? screen.result?.changeCents : null).toBe(firstDay?.changeCents);
  });

  it('say after the bell how each headline turned out, and take the banner down', () => {
    const props = deskPropsAt('day1-debrief');

    expect(props.news).toHaveLength(3);
    expect(props.news.every((card) => card.outcome === 'true' || card.outcome === 'false')).toBe(true);
    expect(props.banner.companyName).toBeNull();
  });

  it('show the market number the final frame holds, and every finished day', () => {
    const { screen } = deskPropsAt('final');
    const frame = recordedFrame('final');

    expect(screen.phase).toBe('final');
    expect(screen.phase === 'final' ? screen.marketCode : null).toBe(frame.final?.marketCode);
    expect(screen.phase === 'final' ? screen.finalCents : null).toBe(frame.final?.finalCents);
    expect(screen.phase === 'final' ? screen.days.map((day) => day.day) : null).toEqual([1, 2, 3, 4, 5]);
  });
});
