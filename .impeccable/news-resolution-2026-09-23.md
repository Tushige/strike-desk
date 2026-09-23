# News event clarity

Applied Impeccable's clarify guidance to the trading desk and reviews. The user wanted the event behind a sudden move, without repetitive uncertainty labels or intrusive notifications.

## Changes

- Curated confirmation and reversal follow-ups for all 27 existing fictional events. They resolve the original topic using the engine's existing hidden outcome; no new randomness or price logic.
- Publish follow-up text, event direction and observed adjacent prices only when the event lands. Original reports and source confidence labels remain intact.
- Replace the flashing Plot twist banner with a quiet News update chart marker. Reuse the chart's existing information band and add the follow-up beneath its original News story.
- Connect reviews to the actual UP/DOWN choice, original report, event direction, entry/exit timing and payout after ticket cost. Distinguish event pressure from the overall day's movement.
- Preserve completed-day context so final reviews do not borrow a later day's news. Keep slice equality stable for unchanged historical context.

## Verification

Desktop live play: Fizzly packing delay displayed its cause and the price drop. A DOWN purchase after the update produced an accurate timing and premium-loss explanation at the bell.

Mobile live play at 390px: final Day 2 review retained JetKicks' training-delay report, Team catches up follow-up, event prices and after-update UP entry. Verified the complete summary visually without horizontal clipping. Temporary viewport and tab cleaned up.

TypeScript, lint, production build and CSS layer checks passed. Engine/server/component tests cover resolution timing, hidden future events, historical reviews, writer metadata, direction, timing and payout narratives. The broad run passed 1,089 tests; its three format assertions were fixed and passed on rerun. The focused rerun passed 113 tests, including both new suites and the desk component. One existing content-revision CLI integration test still exceeds its explicit 90-second timeout (188 seconds in the isolated-worker rerun); the overall suite is not fully green. No assertion failure remains in that rerun.

No price paths, odds, trade authority, confidence labels or RNG draw order changed. The legacy wasTrue field remains bell-only; the narrated event resolution is intentionally public at its reveal.
