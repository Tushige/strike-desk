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

describe("the command path's lab page", () => {
  it('reads the committed transcript and shows an accepted buy and the refusal of a second one', () => {
    const markup = renderToStaticMarkup(createElement(CommandPathDemo));

    expect(markup).toContain('id="lab-demo-command-path"');
    expect(markup).toContain('accepted');
    expect(markup).toContain('alreadyBought');
  });

  it('marks the buy that was sent again as a repeat', () => {
    const markup = renderToStaticMarkup(createElement(CommandPathDemo));

    // One line of the transcript is the same press arriving again, and one
    // cell on the page says so; every other line says it came the first time.
    expect(countOf(markup, 'the same buy, sent again')).toBe(1);
    expect(countOf(markup, '>repeat<')).toBe(1);
    expect(countOf(markup, '>first time<')).toBe(3);
  });
});
