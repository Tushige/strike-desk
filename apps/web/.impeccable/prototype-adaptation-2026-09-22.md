# Prototype-informed desk adaptation

The user supplied `option-arcade.zip` and its hosted URL, preferring its spacing, company access, and separate news presentation while retaining Strike Desk's backend and playful character. The user explicitly chose market-first mobile navigation with a separate News view.

## Reference evidence

The uploaded prototype's `app/page.tsx` separates `CompanyList`, `NewsWire`, the chart, and the ticket. Its mobile CSS moves the company selector and chart ahead of news. Its news items use company metadata, a headline, body copy, and an explicit company action rather than combining everything into company cards.

During implementation, the hosted prototype required an OpenAI login, so that pass used the supplied source. After the user updated permissions, the live site was inspected at 390×844 and 1440×900. No prototype backend, scripts, authentication, dependencies, or financial model were imported.

### Follow-up live inspection

Selecting Fizzly visibly updated the company chart and draft context. The live mobile composition confirmed a three-column company selector followed by the chart, a separate newswire section, and the ticket. Its newswire remains inline below the chart; Strike Desk's separate News navigation follows the user's explicit preference.

The reference has stronger chart-header hierarchy: company identity on the left, price and change on the right, and phase information on a separate row. Its mobile chart panel measured 349.25px tall, with a 92.25px header; company cards measured 102px tall with 11px padding and 9px radii. News metadata, headlines, body text, and actions have distinct levels.

The prior adaptation addresses navigation and content separation but does not yet match the reference's chart-header composition, quieter borders, and consistent density. These remain visual differences, not covered by the earlier test/build results. A temporary reconnecting state appeared initially and cleared; no trading or backend parity was assessed on the prototype.

## Implemented direction

- Six compact company controls select the chart directly, independently of headlines.
- Mobile opens in Market, with separate News and Your ticket views. Changing views preserves the mounted ticket draft and chart state. View changes reset mobile scroll and focus the selected navigation control.
- News uses article structure, full headline and body, source and trust information, and an explicit View company chart action. Hidden outcomes remain governed by the existing server frame.
- Desktop keeps company navigation and a scrolling newswire beside the chart and ticket.
- The mobile header retains the game name, day, time, and worth. The desk uses a quieter solid background while preserving company icons, colors, and the yellow primary action.
- Company names occupy their own line on mobile. The selector uses two columns at 320px and three at 390px. Selection feedback uses short color transitions and respects reduced motion.
- Detailed comparison remains available; its exit now says Close comparison to distinguish it from the separate News view.

## Verification evidence

Browser checks used Chromium through the Codex in-app browser with emulated viewports, not physical touch devices.

- At 320px, document client and scroll widths were both 305px; company controls contained their content. The chart price and clock had separate bounds after correction.
- At 390px, client and scroll widths were both 375px. All six complete company names fit their 93px text tracks. News-to-chart navigation selected the requested company and returned to Market.
- A $100K draft remained selected after switching task views and companies.
- At 768px, the company selector and task navigation remained available without horizontal page overflow.
- At 1280×720, comparison retained a 720px document height and a visible 112.5px grid content area. At 390px, its grid content area was 358px tall.
- Desktop composition was visually inspected at 1440×900. Mobile Market, News, and Ticket were inspected with real server content.
- Keyboard chart inspection returned an observed price. Browser warning/error logs were empty when checked.
- The five-file targeted suite passed 21 tests, including the new separation and navigation assertions. TypeScript, ESLint, production build, CSS ordering, and whitespace checks passed. The design detector reported no findings.

One repeat of the comparison regression test exceeded its five-second timeout; the follow-up run passed with a 20-second timeout without changing the checked behavior. The production build retains the existing large lazy comparison chunk warning.

Limits: no Safari, physical touch, screen-reader, or browser-profiler measurements were performed. Layout measurements are not a claim of zero reflows, CLS performance, or whole-product visual approval.
