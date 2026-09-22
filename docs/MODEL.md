# Fictional market and reproducible audit

The model is unchanged by this port. Node/TypeScript owns seeded market generation, the clock, option pricing, integer-cent accounting, execution and settlement. Every ticket represents 100 shares. A target crossing creates payout at expiry only if the closing price stays on the paying side; profit also has to recover the premium. Hope/time value expires at the bell but can rise or fall beforehand.

The same seed plus engine/content versions reproduces the market. New sessions receive new seeds. Headlines come from a curated pool, not live news or an LLM. During play the browser receives observed history and public news; hidden event truth is disclosed only once that day finishes. The final market code supports replay; it is absent during trading.

## Audit

Run from the root with the pinned Node 24 and pnpm 12.5.1:

```sh
pnpm simulate 1000
```

The script is `apps/server/scripts/simulate-strategies.ts`, adapted from the donor. The fresh output is [model-audit.json](model-audit.json). It covers 1,000 seeds, each evaluated under four policies (4,000 games, five days each). Seed `i` is `42424242 + i * 104729`, starting at `i = 0`. Version identities are included in the output. This audit produced **zero rejected commands**.

Each policy spends the smaller of $100,000 and the server's half-cash cap at the day's opening quote. Whole-ticket quantities and fills use the engine. Policies use only the current day's public opening headline, source trust, direction, public board/quote and their cash. A missing preferred source falls back to company `(sample + day) % 6` and a deterministic alternating direction. The blind policy always uses that fallback. No decision inspects event truth, future prices or future headlines. The script owns the market for settlement and counts headline variety separately from decisions.

| Policy | Exit | Games with gain | Games with loss | Median final | 10th / 90th percentile final |
| --- | --- | ---: | ---: | ---: | ---: |
| Solid source, Close | Bell | 70.8% | 29.2% | $1,176,581 | $777,278 / $1,749,249 |
| Solid source, Close | Midpoint (observed index 250) | 63.7% | 36.3% | $1,071,907 | $822,453 / $1,412,620 |
| Wild rumor, Moonshot | Bell | 19.7% | 80.3% | $500,109 | $500,040 / $1,754,660 |
| Blind direction, Close | Bell | 37.8% | 62.2% | $891,874 | $516,222 / $1,439,224 |

The bell is observed index 500; the market opens at logical step 300 of each 900-step day. Policies buy at the opening quote before the bell. The audit found 162 distinct headline titles in its seed series. Reported dollar quantiles are rounded only for presentation; the simulation uses integer cents.

These are distributions of this fictional model, not real-world return claims, target win rates, or proof of a profitable strategy. They include losing games for every policy. The pricing model was not tuned to the audit output.
