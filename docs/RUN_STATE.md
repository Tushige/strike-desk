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
| 3 | The ticket: TicketBuilder and LiveTicket on the order-ticket machine; cash-out opened at the door | next |
| 4 | The bell and the days: ResultPanel, day pips, final screen wiring, play again | pending |
| 5 | Compare options: the kept grid opened from the desk | pending |
| 6 | Reconnect and honesty: status, stale, buy disabled, dev disconnect, end-to-end test | pending |
| 7 | What-if slider and stress readout | pending |
| 8 | README, final pass at 1366×768, full game, deliverable | pending |

## Notes

- `.planning/` is not in this working copy (it was not in the snapshot the port started from). The one-paragraph note the bridge asks for at the top of `.planning/STATE.md` still has to be added in the real repository: "The GSD process described here stopped on 2026-09-22; the screen rewrite is governed by the bridge brief and recorded in `docs/DECISIONS.md`."
