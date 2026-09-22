# Run state

The bookmark for the screen rewrite described in the bridge brief. Updated at every checkpoint so a fresh session can pick up in one line: read this, read `DECISIONS.md`, run the checks, continue with the next step.

## How to resume

```sh
pnpm install --frozen-lockfile   # Node 24, pnpm 12.5.1 (corepack)
pnpm typecheck && pnpm lint && pnpm test && pnpm build
pnpm dev                          # server on :10000, web on :5173
```

Screenshots for each step are taken with headless Chromium against the built server (`node apps/server/dist/server.js`).

## Steps

| # | Step | Status |
|---|---|---|
| 1 | Tokens and shell: v1 tokens and fonts, TopBar, StartScreen, FinalScreen; old screens, lab and old feed deleted | done |
| 2 | The desk: RoundScreen, NewsCard, PriceChart on the store | done |
| 3 | The ticket: TicketBuilder and LiveTicket on the order-ticket machine; cash-out opened at the door | done |
| 4 | The bell and the days: ResultPanel, day pips, final screen wiring, play again | done |
| 5 | Compare options: the kept grid opened from the desk | done |
| 6 | Reconnect and honesty: status, stale, buy disabled, dev disconnect, end-to-end test | done |
| 7 | What-if slider and stress readout | done |
| 8 | README, final pass at 1366×768, full game, deliverable | done |

## Done means (bridge section 6), checked in headless Chromium on 2026-09-22

1. Start screen and the v1 desk at 1366×768 and 1440×900, one screen, no page scroll during play.
2. Ticket built the simple way and from Compare options (filter to affordable UP tickets on one company, sort by break-even, pick a row); buy while prices move: pending, then accepted; total worth does not lurch.
3. `?dev` → Drop the line: status shows Reconnecting, the desk dims, buying and cashing out are off; after the reconnect the same single ticket and the same cash (also proved by `apps/web/test/reconnect.e2e.test.ts`).
4. Plot twist lands (marker on the chart, banner, hope value drops); cash out or hold.
5. Closing bell debrief with the lesson sentence and "holding on would have paid"; five days; final screen with rank, five bars and the market number; Play again.
6. `?board=2500`: 2,508 contracts with the readout; numbers in the README.
7. `pnpm typecheck`, `lint`, `test` (1,373 tests), `build`, `check:bundle`, `check:css` green; no console errors in a full game; a whole day played with Tab, Enter and Space.

## Notes

- `.planning/` is not in this working copy (it was not in the snapshot the port started from). The one-paragraph note the bridge asks for at the top of `.planning/STATE.md` still has to be added in the real repository: "The GSD process described here stopped on 2026-09-22; the screen rewrite is governed by the bridge brief and recorded in `docs/DECISIONS.md`."
