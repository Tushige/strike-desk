# Three purchases per day — design brief

Status: brief, mechanics, and revised scratch flow approved. Production integration authorized after review of the prominent New purchase action. The scratch remains available as a design reference.

## Job and audience

Let beginners make and manage up to three purchases per day without losing the readable, playful desk. Give experienced players room to compare contracts and react to events. Mode: Operate, with Read for explanations and reviews.

Success: a player can distinguish an unpurchased draft from owned positions, identify remaining purchase allowance and spending capacity, and cash out the intended position without confusion.

## Confirmed direction

- Reveal the full three-purchase allowance before the first purchase. No discovery gate after buying and no special market-open unlock for purchases two and three.
- Keep one purchase builder. Show owned positions as they are confirmed.
- Preserve the existing brand, chart-first mobile navigation, comparison table, news-event explanations, and five-day structure.
- Keep the production chart implementation, company boxes, and existing desk elements. Scratch chart paths, sample company controls and sample comparison rows are context placeholders, not replacement designs. Integrate only the approved purchase allowance, builder/position management flow and necessary multi-position review changes.
- Agree on a concrete plan before production implementation. Use frontend-design for visual hierarchy and Impeccable shape/critique for flow and readability.

## Proposed composition

Visual thesis: a compact ticket ledger beside a spacious working surface, using the established purple ink, fine dividers, yellow actions, and readable numeric alignment.

Content hierarchy: market/chart first; allowance and current task second; owned-position scan third; detailed contract or position information in one shared inspector. No three full-size purchase forms or empty position cards.

Signature: a small three-mark purchase strip, visible even at zero purchases, labelled in text: “0 of 3 purchases used.” Each mark represents a confirmed purchase, not a reusable open-position slot. Unused marks are quiet and never pulse to encourage filling them.

Desktop proposal:

```text
Company selection + chart / comparison     Your tickets
                                          Purchases used  0 / 3
                                          [three small marks]
                                          [budget remaining — rule pending]
                                          ------------------------------
                                          New purchase | Your positions
                                          [one builder OR one inspector]
                                          ------------------------------
                                          Today's positions
                                          [compact rows as purchases fill]
```

The compact list remains visible when switching tasks. “Your positions” selects the last inspected position; each row can open that position directly. At zero positions, use one short empty-state sentence rather than an empty dashboard. Validate whether the task switch is redundant alongside the rows during scratch review; remove it if rows plus “New purchase” are sufficient.

Review feedback: the small New purchase link was too easy to miss. The revised scratch uses a full-width yellow New purchase button directly below the allowance, above the owned-position list, with “2 left” / “1 left” alongside it. It appears while inspecting a position with purchases remaining. Cash-out stays clearly labelled within the selected position, with a secondary outlined treatment so the actions have distinct hierarchy. When the builder is already active, its Buy action remains primary; after three purchases, the new-purchase action is removed and the existing used-up explanation remains.

Each position row shows company, UP/DOWN, target, current value or cash-out proceeds, profit/loss, and status. Use two readable lines rather than fitting every field into one narrow row. Keep purchase order stable as prices change. Separate purchases in the same contract remain individually identifiable by purchase number and entry time.

Only the selected position expands to show quantity, cost, break-even, real/hope value, event context, and its cash-out action. Closed positions remain in the list with a textual status; they do not disappear or free a purchase mark.

## Mobile proposal

Keep Market, News, and Your tickets navigation. The purchase allowance is visible in the ticket area before buying; the compact ticket entry on Market must also communicate “0 / 3 used” so the allowance is discoverable before opening the form.

Within Your tickets, place allowance, compact position rows, then the active builder/inspector. Use explicit New purchase navigation. Save the unfinished draft while inspecting a position. On narrow screens use normal vertical scrolling, readable two-line rows, and generous tap targets. Do not introduce three columns, horizontally scrolling position cards, or nested scrolling panes.

## State and action rules

| State | Proposed behavior |
| --- | --- |
| Zero purchases | Builder active; all three allowance marks visible; no owned-position placeholders. |
| Buy pending | Keep the submitted draft and label the pending action; do not count a purchase yet. Prevent duplicate submission. |
| Buy confirmed | Increment used count, add its position row, and show the purchased position with a brief confirmation. New purchase remains visible. |
| Buy rejected | Preserve draft, show the actionable reason, and leave used count unchanged. |
| One or two purchases | Allow another draft within the remaining budget; inspecting an owned position never changes the draft's company or contract silently. |
| Three purchases | Prioritize owned positions. State “All 3 purchases used today.” Keep charts, comparison, and cash-out available during trading. |
| Budget exhausted before three | Show the real budget constraint; do not imply that unused purchase marks guarantee another affordable order. |
| Cash-out pending/confirmed | Name the position and amount in its own control. Update it only after confirmation; retain the row and used mark. |
| Stale/disconnected | Retain visible state and draft; clearly mark stale values and block actions requiring a current quote. |
| Bell while editing or submitting | Server settlement wins. Show the resulting receipt or rejection and day's result; never imply that an unconfirmed draft was purchased. |
| Refresh | Restore authoritative allowance and positions; choose a valid inspector or the builder. Never infer an extra slot locally. |

Selecting a comparison-table row explicitly opens/updates a new-purchase draft; it must not appear to edit an owned position. Selecting an owned-position row opens its inspector and identifies the corresponding chart context. If the chart has multiple entries/exits, give markers purchase identities and emphasize the selected position rather than drawing every target with equal prominence.

## Reviews

Show the combined daily profit/loss once, then up to three purchase rows. Preserve one day-level Balance Journey point. Selecting a purchase reveals its original report, event, entry/exit timing, cost and payout explanation. The same-company event can be shared as context, but each purchase keeps its own timing and financial result. Sitting out remains a valid, calm empty state.

## Visual and motion constraints

Use existing tokens: ink #14112a, panel #1d1938, cloud #f4f1ff, sun #ffd447, mint #3ee0a5, coral #ff7d6e. Retain existing muted text and line tokens. Lexend carries forms/data; Unbounded is reserved for short headings; keep Ticket S branding unchanged. Use tabular digits and aligned monetary columns.

Retain 12px panel corners, 8px controls, thin dividers and consistent 20px insets. Prefer whitespace and type weight over more filled containers. Direction and status always have text, not color alone.

Use a brief arrival for a confirmed position and a finite emphasis on its used mark. Inspector changes preserve focus and draft state. Avoid moving cash-out controls as numbers update, animating layout properties on each tick, or repeatedly announcing streamed values. Follow the user's existing motion preference independently of OS reduced-motion settings.

## Approved mechanics for the study

- Recommended: one shared daily purchase-cost allowance equal to 50% of start-of-day cash, also constrained by available cash. Cash-outs do not replenish this allowance.
- Recommended: three successful purchases total, not three concurrent positions. Rejected/retried duplicate commands do not consume allowance; cash-outs do not restore it.
- Recommended: allow repeated company/contract selections and opposing directions, each as an independently managed purchase. No multi-leg order builder, option selling, partial exits, or unlimited re-entry in this scope.

The user's “Approved” reply accepts this brief and its recommended shared daily budget. These rules are simulated in the scratch flow, not implemented in the production engine yet.

## Next review artifact and acceptance

After mechanics are settled, create a scratch flow in the existing visual language for zero, one, two and three purchases, one cashed-out position, rejection and closing review. Use labelled fictional sample data. Review desktop and 390px mobile together before changing the live app.

The review artifact is now `apps/web/scratch/three-purchases.html`, served at `/scratch/three-purchases.html`. It includes an interactive builder, six sample comparison contracts, independent position inspection/cash-out, shared budget accounting, and direct state shortcuts. The scratch uses normal vertical scrolling on mobile and an always-visible compact ledger above the inspector on desktop; rows plus New purchase replace the redundant task tabs proposed above. Quote amounts and chart paths are labelled fictional illustrations. Streaming, refresh recovery, full contract coverage, and server races remain production requirements rather than simulated guarantees.

The review must establish that all three opportunities are discoverable initially; draft versus owned position is unmistakable; remaining budget is not confused with cash or portfolio value; three rows fit without compressed type; a cash-out cannot target a different row; repeated contracts are distinguishable; prices do not shift controls; and day totals reconcile with the individual positions.

Scratch verification: checked the desktop composition at 1280px and three-position/closing views at 390px. Confirmed a custom Fizzly draft retained its company, direction and $123,000 budget across inspecting another position. Confirmed cashing out purchase 2 preserved all three used purchases and the $350,000 remaining allowance. The mixed cash-out/settlement example reconciled to +$27,500 ($20,000 - $5,000 + $12,500) and $1,027,500 portfolio value. Mobile document width equalled viewport width, with no horizontal overflow; browser error log was empty. JavaScript syntax check passed. This verifies the scratch flow, not production engine behavior.

Production work follows the approved design: engine limits and unique IDs; authoritative allowance fields; builder/position state separation; chart selection; multi-purchase day reviews; deterministic accounting and duplicate-command tests; desktop/mobile verification. A controlled strategy comparison can then evaluate the gameplay effect of three purchases separately from this UI change.

## Production integration and verification

The live desk now uses the approved allowance, prominent New purchase action, compact purchase ledger, and selected-position inspector. Existing PriceChart, company cards, comparison table, and market/news navigation are retained. The server enforces three successful purchases and one shared start-of-day allowance; each purchase has its own ID and cash-out. The persistent draft survives position inspection. Day and final reviews expose each purchase with its own authoritative outcome and news context.

Verification on 2026-09-23:
- Broad regression run: 80 files / 1,413 tests; 1,403 initially passed. The ten failures were legacy one-purchase assertions plus a new review-test contract selection. Updated those cases; all nine retested files / 388 tests passed. The unrelated, previously timing-out news-content CLI test was excluded.
- Final focused run: all 211 tests passed after focus and review refinements. TypeScript build and lint passed. Production web build, CSS layer check, and engine-exclusion bundle check passed.
- Real browser: bought three independent positions, rejected-price attempts consumed no slots, sold purchase 2 while 1 and 3 remained open, and confirmed neither purchase count nor allowance refilled. The next day reset to 0/3 and its new start-of-day allowance.
- At 390px, the ledger remained readable with no horizontal overflow. Desktop keeps the allowance, New purchase action, and positions visible while the inspector scrolls. Existing chart and company navigation remained available.
- Mixed cash-out/settlement day reconciled exactly: $78,988 + $168,560 + $113,094 = $360,642. Selecting the sold position showed its own cash-out and hold-to-bell comparison. A full five-day run confirmed Balance Journey and final reviews include multiple purchases. Browser error log was empty.
