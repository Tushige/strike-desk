import { describe, expect, it } from 'vitest';
import type { DeskProps } from '../../src/modules/desk/index';

/**
 * What any source of desk props must keep true at every moment it gives,
 * whatever is behind it: the pieces agree with each other, and nothing says
 * more than a player may know at that moment.
 *
 * This file is not a test file by itself: a test file names the source to
 * try and calls `describeDeskPropsContract`.
 */

export function describeDeskPropsContract(name: string, make: () => readonly DeskProps[]): void {
  describe(`${name}: what any source of desk props must keep true`, () => {
    it('gives at least one moment', () => {
      expect(make().length).toBeGreaterThanOrEqual(1);
    });

    it('shows the screen of the phase the top bar names', () => {
      for (const [index, props] of make().entries()) {
        expect([index, props.screen.phase]).toEqual([index, props.topBar.phase]);
      }
    });

    it('shows worth and cash as whole numbers, and worth never under cash', () => {
      for (const [index, { topBar }] of make().entries()) {
        expect([index, Number.isInteger(topBar.worthCents), Number.isInteger(topBar.cashCents)]).toEqual([index, true, true]);
        expect([index, topBar.worthCents >= topBar.cashCents]).toEqual([index, true]);
      }
    });

    it('shows exactly six chips, companies 0 to 5 in order, at most one of them selected', () => {
      for (const [index, { chips }] of make().entries()) {
        expect([index, chips.map((chip) => chip.companyId)]).toEqual([index, [0, 1, 2, 3, 4, 5]]);
        expect([index, chips.filter((chip) => chip.selected).length <= 1]).toEqual([index, true]);
      }
    });

    it('shows at most three news cards, no two of one trust level', () => {
      for (const [index, { news }] of make().entries()) {
        expect([index, news.length <= 3]).toEqual([index, true]);
        expect([index, new Set(news.map((card) => card.trust)).size]).toEqual([index, news.length]);
      }
    });

    it('says how a headline turned out only once it is out, and never before the closing bell', () => {
      for (const [index, { news, topBar }] of make().entries()) {
        const beforeTheBell = topBar.phase === 'preBell' || topBar.phase === 'open';
        for (const card of news) {
          if (card.outcome !== undefined) expect([index, card.title, card.revealed]).toEqual([index, card.title, true]);
          if (beforeTheBell) expect([index, card.title, card.outcome]).toEqual([index, card.title, undefined]);
        }
      }
    });

    it('names a company on the banner only when a card of that company is out', () => {
      for (const [index, { banner, news }] of make().entries()) {
        if (banner.companyName === null) continue;
        const out = news.filter((card) => card.revealed).map((card) => card.companyName);
        expect([index, out.includes(banner.companyName)]).toEqual([index, true]);
      }
    });

    it('shows a market number on a final screen', () => {
      for (const [index, { screen }] of make().entries()) {
        if (screen.phase === 'final') expect([index, screen.marketCode === '']).toEqual([index, false]);
      }
    });
  });
}
