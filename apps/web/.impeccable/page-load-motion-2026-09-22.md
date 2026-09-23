# Landing promotion and page-load motion

The approved V2 composition is now the default landing at `/`; `?landing=v2` remains compatible and `?landing=original` retains the untouched original. The main landing is loaded with the app rather than behind a second JavaScript request. Its data-dependent company roster reserves six places while connecting. Game commands, timing, pricing and the engineering demo are unchanged.

## Motion direction

Applied design-taste-frontend to the landing, frontend-design to composition and loading states, and Impeccable animate to timing and continuity. Preserve the approved night-arcade brand and dials (variance 8, motion 6, density 3).

- Focal moment: the two-line invitation rises through its own typographic crop, followed by the start controls while RoboPup and the bell settle into place. The sequence finishes within 810ms; controls remain usable throughout.
- Continuity: desk panels arrive within 440ms on desktop; mobile Market/News/Ticket switches use 220–280ms fades without remounting the ticket draft. Final results gain a finite bar reveal, anchored at the zero line.
- Feedback: existing press states, pending/accepted trade feedback, bell and ticket stamp remain. Price updates never trigger a new page entrance.
- Budget: native CSS, no new libraries, no animation timers, no scroll handlers, no animated layout dimensions. Loading surfaces get one transform sheen each, three passes then a steady placeholder. No fake minimum loading time. OS motion suppression remains omitted per explicit user preference.

## Loading states

- Company roster: same six positions, responsive grid and 52px row minimum as loaded content.
- Comparison: shared intro copy and filter metrics, non-interactive placeholders, eight columns (seven for workload mode), 34px rows, the same 360px mobile table region and flexible desktop region. The existing retry boundary remains.
- Chart: guides and label placeholders occupy the chart box until ResizeObserver supplies its dimensions. No fabricated price trace.
- Game snapshots arrive atomically; do not cover known data with skeletons during ongoing price updates or reconnects.

## Verification

- TypeScript, focused ESLint, production build, CSS layer checks and Impeccable detector passed. Seven tests verify original fallback/default promotion, start acceptance and chosen pace, pending company data, deferred comparison chunk replacement, chart measurement replacement, and draft preservation during live table filtering.
- Browser checked landing at 1440×900 and 390×844, real two-minute game start, mobile News/Ticket navigation and actual lazy comparison loading followed by a live grid. No horizontal overflow; mobile CTA bottom ~432px. Loaded table and skeleton both measure 360px on mobile.
- Rendered actual skeleton components at desktop/mobile in a temporary inspection page, then removed it. Verified sheen is finite (three passes). No synthetic load delay was added to production.
- Desktop entrance fill uses backwards only, so completed motion does not override stale/offline opacity.
- The real two-minute game reached its five-day final review; checked final-summary and bar animation styles, completed state and absence of document overflow.
- Existing large comparison-chunk warning remains. Frame rate and Core Web Vitals were not profiled; no performance-score claim.
