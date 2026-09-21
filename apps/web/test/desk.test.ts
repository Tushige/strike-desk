import { createElement } from 'react';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RECORDED_LABELS } from '../src/fixtures/recordedGame';
import { deskPropsAt } from '../src/modules/desk/fake';
import { signedCentsText, timeLeftText } from '../src/modules/desk/format';
import { CompanyChip, CompanyMark, CompanyStrip, NewsCard, PhaseScreen, RevealBanner, TopBar } from '../src/modules/desk/index';
import type { CompanyChipProps, DaySummary, NewsCardProps, TopBarProps } from '../src/modules/desk/index';

/**
 * The desk pieces, rendered to static markup from props typed in here. Every
 * expected text below is typed in too: none is read from the block's words
 * file or from the recorded game, so a changed word fails a test instead of
 * quietly agreeing with itself. One suite draws the recorded game's moments,
 * and pins none of its words or numbers.
 */

function nothing(): void {
  return undefined;
}

function markupOf(element: ReactElement): string {
  return renderToStaticMarkup(element);
}

/** What a player reads or hears: the markup with its tags and attributes taken out. */
function textOf(markup: string): string {
  return markup.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

/** A colour written as a value, in any of the ways one can be written. */
const COLOUR_VALUE = /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|oklch\(/;

describe('the time left', () => {
  it('turns steps and pace into minutes and seconds of real time', () => {
    // 300 steps x 200 ms = 60,000 ms of game time; at pace 1 that is 60 s.
    expect(timeLeftText(300, 1)).toBe('1:00');
    // 60,000 ms / 3 = 20,000 ms.
    expect(timeLeftText(300, 3)).toBe('0:20');
    // 60,000 ms / 7.5 = 8,000 ms.
    expect(timeLeftText(300, 7.5)).toBe('0:08');
  });

  it('rounds a part of a second up, so the clock never shows zero while time is left', () => {
    // 1 step x 200 ms = 200 ms, shown as one whole second.
    expect(timeLeftText(1, 1)).toBe('0:01');
    expect(timeLeftText(0, 1)).toBe('0:00');
  });

  it('shows minutes past the first', () => {
    // 500 steps x 200 ms = 100,000 ms = 1 min 40 s.
    expect(timeLeftText(500, 1)).toBe('1:40');
  });

  it('is empty before a pace is chosen', () => {
    expect(timeLeftText(300, null)).toBe('');
  });
});

describe('the top bar', () => {
  const open: TopBarProps = {
    worthCents: 104_991_400,
    cashCents: 100_000_000,
    day: 2,
    phase: 'open',
    stepsLeft: 300,
    pace: 3,
    line: 'live',
  };

  it('shows total worth, cash, the day, the phase, the time left and a live line', () => {
    const markup = markupOf(createElement(TopBar, open));
    const text = textOf(markup);

    expect(text).toContain('Total worth');
    expect(text).toContain('$1,049,914');
    expect(text).toContain('Cash');
    expect(text).toContain('$1,000,000');
    expect(text).toContain('Day 2 of 5');
    expect(text).toContain('Market open');
    expect(text).toContain('0:20');
    expect(text).toContain('Connected');
    expect(markup).toContain('data-old="false"');
  });

  it('puts total worth before cash', () => {
    const text = textOf(markupOf(createElement(TopBar, open)));

    expect(text.indexOf('$1,049,914')).toBeLessThan(text.indexOf('$1,000,000'));
  });

  it('says in words that the line is stale, and marks the numbers as old', () => {
    const markup = markupOf(createElement(TopBar, { ...open, line: 'stale' }));
    const text = textOf(markup);

    expect(text).toContain('Waiting for new prices');
    expect(text).toContain('These numbers may be old');
    expect(text).not.toContain('Connected');
    expect(markup).toContain('data-old="true"');
    // The numbers are still there to read: old, not gone.
    expect(text).toContain('$1,049,914');
  });

  it('says in words that the line is offline, and marks the numbers as old', () => {
    const markup = markupOf(createElement(TopBar, { ...open, line: 'offline' }));
    const text = textOf(markup);

    expect(text).toContain('Connection lost');
    expect(text).toContain('These numbers may be old');
    expect(markup).toContain('data-old="true"');
  });

  it('shows no day and no time in the lobby', () => {
    const lobby: TopBarProps = {
      worthCents: 100_000_000,
      cashCents: 100_000_000,
      day: 0,
      phase: 'lobby',
      stepsLeft: 0,
      pace: null,
      line: 'live',
    };

    const text = textOf(markupOf(createElement(TopBar, lobby)));

    expect(text).toContain('$1,000,000');
    expect(text).toContain('Getting ready');
    expect(text).not.toContain('Day ');
    expect(text).not.toContain('Time left');
    expect(text).not.toMatch(/\d:\d\d/);
  });

  it('names each phase in words', () => {
    const phaseWords = (phase: TopBarProps['phase']): string => textOf(markupOf(createElement(TopBar, { ...open, phase })));

    expect(phaseWords('preBell')).toContain('Before the bell');
    expect(phaseWords('debrief')).toContain('Closing bell');
    expect(phaseWords('final')).toContain('Game over');
  });
});

describe('the company mark', () => {
  const markOf = (companyId: number): string => markupOf(createElement(CompanyMark, { companyId, ticker: 'TEST', size: 'md' }));

  /** The drawing alone, so that two marks are compared by their glyph and not by their tint. */
  const glyphOf = (markup: string): string => /<svg[\s\S]*<\/svg>/.exec(markup)?.[0] ?? '';

  it('washes the tile of company 0 and of company 5 with their own tints', () => {
    const first = markOf(0);
    const last = markOf(5);

    expect(first).toContain('bg-company-0/15');
    expect(first).toContain('border-company-0/30');
    expect(first).toContain('text-company-0');
    expect(last).toContain('bg-company-5/15');
    expect(last).toContain('border-company-5/30');
    expect(last).toContain('text-company-5');
    expect(first).not.toContain('company-5');
    expect(last).not.toContain('company-0');
  });

  it('draws a different glyph for each of the six companies', () => {
    const glyphs = [0, 1, 2, 3, 4, 5].map((companyId) => glyphOf(markOf(companyId)));

    expect(glyphs.every((glyph) => glyph.startsWith('<svg'))).toBe(true);
    expect(new Set(glyphs).size).toBe(6);
  });

  it('shows the ticker at both sizes', () => {
    expect(textOf(markOf(3))).toBe('TEST');
    expect(textOf(markupOf(createElement(CompanyMark, { companyId: 3, ticker: 'TEST', size: 'sm' })))).toBe('TEST');
  });

  it('falls back to company 0 for an id it does not know, and does not throw', () => {
    for (const unknown of [6, -1, 2.5, Number.NaN]) {
      expect(markOf(unknown)).toBe(markOf(0));
    }
  });

  it('never uses a direction colour or gold for a tile, and never a colour written as a value', () => {
    for (const companyId of [0, 1, 2, 3, 4, 5]) {
      const markup = markOf(companyId);
      expect(markup).not.toContain('bg-up');
      expect(markup).not.toContain('bg-down');
      expect(markup).not.toContain('bg-gold');
      expect(markup).not.toMatch(COLOUR_VALUE);
    }
  });
});

describe('the company chip', () => {
  const chip: CompanyChipProps = {
    companyId: 0,
    ticker: 'RPUP',
    name: 'RoboPup',
    priceCents: 8400,
    trend: 'up',
    hasNews: true,
    selected: true,
    onSelect: nothing,
  };

  it('is a real button holding the name, the ticker, the price, the trend in words and the news mark', () => {
    const markup = markupOf(createElement(CompanyChip, chip));
    const text = textOf(markup);

    expect(markup.startsWith('<button')).toBe(true);
    expect(markup).toContain('type="button"');
    expect(markup).toContain('aria-pressed="true"');
    expect(text).toContain('RoboPup');
    expect(text).toContain('RPUP');
    expect(text).toContain('$84');
    expect(text).toContain('Up today');
    expect(text).toContain('News');
  });

  it('says the other trends in words too, and is not pressed when it is not the selected one', () => {
    const down = markupOf(createElement(CompanyChip, { ...chip, trend: 'down', selected: false, hasNews: false }));
    const flat = markupOf(createElement(CompanyChip, { ...chip, trend: 'flat' }));

    expect(textOf(down)).toContain('Down today');
    expect(down).toContain('aria-pressed="false"');
    expect(textOf(down)).not.toContain('News');
    expect(textOf(flat)).toContain('Flat today');
  });

  it('shows the no-price text and no dollar sign until the first price', () => {
    const text = textOf(markupOf(createElement(CompanyChip, { ...chip, priceCents: null })));

    expect(text).toContain('No price yet');
    expect(text).not.toContain('$');
  });

  it('shows no percentage and no change amount', () => {
    const text = textOf(markupOf(createElement(CompanyChip, chip)));

    expect(text).not.toContain('%');
    // One amount only: the price.
    expect(text.split('$').length - 1).toBe(1);
  });

  it('has a focus ring to be found by', () => {
    expect(markupOf(createElement(CompanyChip, chip))).toContain('focus-visible:outline-ring');
  });
});

describe('the company strip', () => {
  it('is a list with the name it was handed, holding its children one to an item', () => {
    const markup = markupOf(
      createElement(CompanyStrip, {
        label: 'The six test companies',
        children: [createElement('span', { key: 'a' }, 'first'), createElement('span', { key: 'b' }, 'second')],
      }),
    );

    expect(markup.startsWith('<ul')).toBe(true);
    expect(markup).toContain('aria-label="The six test companies"');
    expect(markup.split('<li').length - 1).toBe(2);
    expect(textOf(markup)).toBe('first second');
  });
});

describe('the news card', () => {
  const card: NewsCardProps = {
    companyId: 2,
    companyName: 'BubbleTest',
    ticker: 'BTST',
    trust: 3,
    source: 'A test source says',
    title: 'A test title',
    body: 'A test body.',
    direction: 'up',
    revealed: false,
    selected: false,
    onSelect: nothing,
  };

  const cardOf = (over: Partial<NewsCardProps>): string => markupOf(createElement(NewsCard, { ...card, ...over }));

  /** How many of the three trust dots are filled in. */
  const filledDots = (markup: string): number => markup.split('data-filled="true"').length - 1;
  const allDots = (markup: string): number => markup.split('data-filled=').length - 1;

  /** The one element that says the news is out, and the one that says how it turned out. */
  const NEWS_OUT_MARK = /<span data-news-out="true"[^>]*>[^<]*<\/span>/;
  const OUTCOME_LINE = /<p data-outcome="(?:true|false)"[^>]*>[^<]*<\/p>/;

  it('shows who is speaking, the title, the body, the company and its ticker', () => {
    const text = textOf(cardOf({}));

    expect(text).toContain('A test source says');
    expect(text).toContain('A test title');
    expect(text).toContain('A test body.');
    expect(text).toContain('BubbleTest');
    expect(text).toContain('BTST');
  });

  it('says the trust level in words and in dots: solid news, three of three', () => {
    const markup = cardOf({ trust: 3 });

    expect(textOf(markup)).toContain('Solid news');
    expect(textOf(markup)).toContain('Trust: 3 of 3');
    expect(filledDots(markup)).toBe(3);
    expect(allDots(markup)).toBe(3);
  });

  it('says could be true with two dots, and wild rumor with one', () => {
    const middle = cardOf({ trust: 2 });
    const low = cardOf({ trust: 1 });

    expect(textOf(middle)).toContain('Could be true');
    expect(textOf(middle)).toContain('Trust: 2 of 3');
    expect(filledDots(middle)).toBe(2);
    expect(allDots(middle)).toBe(3);
    expect(textOf(low)).toContain('Wild rumor');
    expect(textOf(low)).toContain('Trust: 1 of 3');
    expect(filledDots(low)).toBe(1);
    expect(allDots(low)).toBe(3);
  });

  it('words the direction as what the news says, not as what will happen', () => {
    expect(textOf(cardOf({ direction: 'up' }))).toContain('This news says UP');
    expect(textOf(cardOf({ direction: 'down' }))).toContain('This news says DOWN');
  });

  it('says nothing about the outcome unless it is handed in: a card that is out differs only by its mark', () => {
    const waiting = cardOf({ revealed: false });
    const out = cardOf({ revealed: true });

    expect(textOf(out)).toContain('The news is out');
    expect(textOf(waiting)).not.toContain('The news is out');
    expect(out.replace(NEWS_OUT_MARK, '')).toBe(waiting);

    for (const markup of [waiting, out]) {
      expect(markup).not.toContain('data-outcome');
      expect(textOf(markup)).not.toContain('This news turned out true.');
      expect(textOf(markup)).not.toContain('This news did not come true.');
    }
  });

  it('says how the news turned out when the outcome is handed in, in words and in no direction colour', () => {
    const out = cardOf({ revealed: true });
    const cameTrue = cardOf({ revealed: true, outcome: 'true' });
    const didNot = cardOf({ revealed: true, outcome: 'false' });

    expect(textOf(cameTrue)).toContain('This news turned out true.');
    expect(textOf(cameTrue)).not.toContain('This news did not come true.');
    expect(textOf(didNot)).toContain('This news did not come true.');
    expect(textOf(didNot)).not.toContain('This news turned out true.');

    // The outcome line is the only thing an outcome adds or changes...
    expect(cameTrue.replace(OUTCOME_LINE, '')).toBe(out);
    expect(didNot.replace(OUTCOME_LINE, '')).toBe(out);
    // ...and it wears neither the up nor the down colour, nor gold.
    for (const markup of [cameTrue, didNot]) {
      const line = OUTCOME_LINE.exec(markup)?.[0] ?? '';
      expect(line).not.toBe('');
      expect(line).not.toMatch(/-(?:up|down|gold)\b/);
    }
  });

  it('holds a real button whose pressed state follows the selection, with a focus ring', () => {
    const resting = cardOf({ selected: false });
    const selected = cardOf({ selected: true });

    expect(resting).toContain('<button type="button"');
    expect(resting).toContain('aria-pressed="false"');
    expect(selected).toContain('aria-pressed="true"');
    expect(resting).toContain('outline-ring');
  });

  it('shows a headline as text, never as markup', () => {
    const markup = cardOf({ title: '<img src=x onerror=alert(1)>', body: '<b>bold</b>' });

    expect(markup).not.toContain('<img');
    expect(markup).not.toContain('<b>');
    expect(markup).toContain('&lt;img');
  });
});

describe('the reveal banner', () => {
  it('is an empty polite live region when there is no name', () => {
    const markup = markupOf(createElement(RevealBanner, { companyName: null }));

    expect(markup).toContain('aria-live="polite"');
    expect(textOf(markup)).toBe('');
  });

  it('says the plot twist and names the company', () => {
    const markup = markupOf(createElement(RevealBanner, { companyName: 'BubbleTest' }));
    const text = textOf(markup);

    expect(markup).toContain('aria-live="polite"');
    expect(text).toContain('Plot twist!');
    expect(text).toContain('BubbleTest');
  });

  it('never says whether the news was true', () => {
    const text = textOf(markupOf(createElement(RevealBanner, { companyName: 'BubbleTest' })));

    expect(text).not.toMatch(/\b(?:true|false|right|wrong|real|fake)\b/i);
  });

  it('keeps any movement behind the reduced-motion preference', () => {
    const markup = markupOf(createElement(RevealBanner, { companyName: 'BubbleTest' }));

    expect(markup).toContain('motion-reduce:transition-none');
  });
});

describe('the pieces at every moment of the recorded game', () => {
  /**
   * No word or number of the recording is pinned here: it may be retaken.
   * What is checked is that every piece draws every moment, and that the
   * ending stays unsaid while a day is still running.
   */
  it('draw all thirteen moments, and say no outcome before the closing bell', () => {
    expect(RECORDED_LABELS).toHaveLength(13);

    for (const label of RECORDED_LABELS) {
      const props = deskPropsAt(label);
      const beforeTheBell = props.topBar.phase === 'preBell' || props.topBar.phase === 'open';

      const pieces = [
        markupOf(createElement(TopBar, props.topBar)),
        markupOf(createElement(RevealBanner, props.banner)),
        markupOf(createElement(PhaseScreen, props.screen)),
        ...props.chips.map((chip) => markupOf(createElement(CompanyChip, chip))),
      ];
      const cards = props.news.map((card) => markupOf(createElement(NewsCard, card)));

      for (const markup of pieces) expect([label, markup === '']).toEqual([label, false]);
      for (const markup of [...pieces, ...cards]) expect([label, COLOUR_VALUE.test(markup)]).toEqual([label, false]);
      if (beforeTheBell) {
        for (const markup of cards) expect([label, markup.includes('data-outcome')]).toEqual([label, false]);
      }
    }
  });
});

describe('a signed amount', () => {
  it('wears a plus or a minus in front of the formatted amount, and neither at zero', () => {
    expect(signedCentsText(4_991_400)).toBe('+$49,914');
    expect(signedCentsText(-250_000)).toBe('-$2,500');
    expect(signedCentsText(0)).toBe('$0');
    // Cents show only when there are some: 12,036 cents is $120.36.
    expect(signedCentsText(-12_036)).toBe('-$120.36');
  });
});

describe('the phase screens', () => {
  const inside = createElement('p', null, 'the desk of the day');

  const lobby = (canStart: boolean): string =>
    markupOf(createElement(PhaseScreen, { phase: 'lobby', paces: [1, 3, 7.5], canStart, onStart: nothing }));
  const preBell = (canAct: boolean): string =>
    markupOf(createElement(PhaseScreen, { phase: 'preBell', day: 2, canAct, onOpenBell: nothing, children: inside }));
  const open = (canAct: boolean): string =>
    markupOf(createElement(PhaseScreen, { phase: 'open', day: 2, canAct, onSkipToBell: nothing, children: inside }));
  const debrief = (result: DaySummary | null, canAct = true, day = 1): string =>
    markupOf(createElement(PhaseScreen, { phase: 'debrief', day, result, canAct, onNextDay: nothing, children: inside }));
  const final = (): string =>
    markupOf(
      createElement(PhaseScreen, {
        phase: 'final',
        finalCents: 104_991_400,
        changeCents: 4_991_400,
        marketCode: '7NS-URH-ME42',
        days: [
          { day: 1, startCents: 100_000_000, endCents: 105_241_400, changeCents: 5_241_400 },
          { day: 2, startCents: 105_241_400, endCents: 104_991_400, changeCents: -250_000 },
        ],
        onPlayAgain: nothing,
      }),
    );

  const dayOne: DaySummary = { day: 1, startCents: 100_000_000, endCents: 104_991_400, changeCents: 4_991_400 };

  const buttonsOf = (markup: string): string[] => markup.match(/<button[^>]*>/g) ?? [];
  const disabledOf = (markup: string): number => buttonsOf(markup).filter((button) => button.includes('disabled=""')).length;

  it('offers one start button for each pace in the lobby', () => {
    const markup = lobby(true);
    const text = textOf(markup);

    expect(buttonsOf(markup)).toHaveLength(3);
    expect(disabledOf(markup)).toBe(0);
    expect(text).toContain('Start at normal speed');
    expect(text).toContain('Start fast (3x)');
    expect(text).toContain('Start turbo (7.5x)');
  });

  it('disables all three start buttons while a game cannot be started', () => {
    expect(disabledOf(lobby(false))).toBe(3);
  });

  it('shows before the bell its heading for the day, its one button and the desk inside its content region', () => {
    const markup = preBell(true);
    const text = textOf(markup);

    expect(text).toContain('Day 2: before the bell');
    expect(text).toContain('Ring the opening bell');
    expect(buttonsOf(markup)).toHaveLength(1);
    expect(disabledOf(markup)).toBe(0);
    expect(disabledOf(preBell(false))).toBe(1);
    expect(markup.split('data-region="content"').length - 1).toBe(1);
    expect(markup).toMatch(/data-region="content"[^>]*><p>the desk of the day<\/p><\/div>/);
  });

  it('shows while the market is open its heading, its one button and the desk', () => {
    const markup = open(true);
    const text = textOf(markup);

    expect(text).toContain('Day 2: the market is open');
    expect(text).toContain('Skip to the closing bell');
    expect(buttonsOf(markup)).toHaveLength(1);
    expect(disabledOf(open(false))).toBe(1);
    expect(markup).toMatch(/data-region="content"[^>]*><p>the desk of the day<\/p><\/div>/);
  });

  it('shows at the debrief the day as the server summed it up, the change with its sign', () => {
    const markup = debrief(dayOne);
    const text = textOf(markup);

    expect(text).toContain('Day 1: closing bell');
    expect(text).toContain('$1,000,000');
    expect(text).toContain('$1,049,914');
    expect(text).toContain('+$49,914');
    expect(text).toContain('Go to day 2');
    expect(buttonsOf(markup)).toHaveLength(1);
    expect(disabledOf(debrief(dayOne, false))).toBe(1);
    expect(markup).toMatch(/data-region="content"[^>]*><p>the desk of the day<\/p><\/div>/);
  });

  it('shows a losing day with a minus, in words as well as in colour', () => {
    const text = textOf(debrief({ day: 1, startCents: 100_000_000, endCents: 99_750_000, changeCents: -250_000 }));

    expect(text).toContain('-$2,500');
    expect(text).not.toContain('+');
  });

  it('waits in words, with no amount, until the result of the day arrives', () => {
    const text = textOf(debrief(null));

    expect(text).toContain('Counting up the day…');
    expect(text).not.toContain('$');
  });

  it('leads from the last debrief to the final result, not to a sixth day', () => {
    const text = textOf(debrief({ ...dayOne, day: 5 }, true, 5));

    expect(text).toContain('See your final result');
    expect(text).not.toContain('day 6');
  });

  it('shows on the final screen the final worth, the change, a row for each day, the market number and play again', () => {
    const markup = final();
    const text = textOf(markup);

    expect(text).toContain('$1,049,914');
    expect(text).toContain('+$49,914');
    expect(text).toContain('-$2,500');
    expect(text).toContain('Market number');
    expect(text).toContain('7NS-URH-ME42');
    expect(text).toContain('Play again');
    expect(/<tbody[\s\S]*<\/tbody>/.exec(markup)?.[0].split('<tr').length).toBe(3);
    expect(buttonsOf(markup)).toHaveLength(1);
  });

  it('shows a market number on no screen but the final one', () => {
    for (const markup of [lobby(true), preBell(true), open(true), debrief(dayOne), debrief(null)]) {
      expect(textOf(markup)).not.toContain('Market number');
      expect(markup).not.toMatch(/[0-9A-Z]{3}-[0-9A-Z]{3}-[0-9A-Z]{4}/);
    }
  });

  it('fills the height it is given on every screen, and takes none from the window', () => {
    for (const markup of [lobby(true), preBell(true), open(true), debrief(dayOne), final()]) {
      const root = /^<section[^>]*>/.exec(markup)?.[0] ?? '';
      expect(root).toContain('h-full');
      expect(root).toContain('min-h-0');
      expect(markup).not.toMatch(/h-screen|h-dvh|min-h-screen|100vh|100dvh/);
    }
  });

  it('gives every button a focus ring', () => {
    for (const markup of [lobby(true), preBell(true), open(true), debrief(dayOne), final()]) {
      for (const button of buttonsOf(markup)) {
        expect(button).toContain('focus-visible:outline-ring');
      }
    }
  });
});
