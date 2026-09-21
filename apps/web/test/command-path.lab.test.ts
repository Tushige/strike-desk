import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import CommandPathDemo from '../src/lab/modules/command-path.demo';

/**
 * The lab page of the command path, rendered to static markup like the lab's
 * other tests. What is checked is what the page says: that its reader takes
 * the committed transcript, and that the answers a reader came for are on it.
 * No price and no quantity is named, so ordinary price work cannot turn this
 * red.
 */

/** How many times `needle` appears in `text`. */
function countOf(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

const markup = renderToStaticMarkup(createElement(CommandPathDemo));

describe("the command path's lab page", () => {
  it('reads the committed transcript and shows an accepted buy and the refusal of a second one', () => {
    expect(markup).toContain('id="lab-demo-command-path"');
    expect(markup).toContain('accepted');
    expect(markup).toContain('alreadyBought');
  });

  it('says in plain words what it shows and where the file came from', () => {
    expect(markup).toContain('the same function the server calls');
    expect(markup).toContain('works nothing out');
  });

  it.each(['alreadyBought', 'overCap', 'priceMoved', 'marketClosed', 'alreadyClosed'])('shows a refusal with the reason %s', (reason) => {
    expect(markup).toContain(`>${reason}<`);
  });

  it('tells accepted from rejected by a word, on every line', () => {
    // Fifteen lines. Ten accepted: the start, the buy, the same buy again (its
    // first receipt), the opening bell, the cash-out, the skip, the next day,
    // the buy that claimed too high a price, and the two cash-outs after the
    // bell. Five refused: the second buy, the second cash-out, over the cap,
    // half the price, and the buy at the bell.
    expect(countOf(markup, '>accepted<')).toBe(10);
    expect(countOf(markup, '>rejected<')).toBe(5);
  });

  it('marks the buy that was sent again as a repeat, and nothing else', () => {
    expect(countOf(markup, 'the same buy, sent again')).toBe(1);
    expect(countOf(markup, '>repeat<')).toBe(1);
    expect(countOf(markup, '>first time<')).toBe(14);
  });

  it('groups the lines by day', () => {
    expect(countOf(markup, '>Day 1<')).toBe(1);
    expect(countOf(markup, '>Day 2<')).toBe(1);
    expect(markup.indexOf('>Day 1<')).toBeLessThan(markup.indexOf('a buy before the bell'));
    expect(markup.indexOf('a second cash-out of the same ticket')).toBeLessThan(markup.indexOf('>Day 2<'));
    expect(markup.indexOf('>Day 2<')).toBeLessThan(markup.indexOf('a buy over the spending cap'));
  });

  it('shows money the way the game writes it', () => {
    // The starting cash, on the line that starts the game: one million dollars, no cents.
    expect(markup).toContain('$1,000,000');
    expect(markup).not.toMatch(/\d{7,}/);
  });
});
