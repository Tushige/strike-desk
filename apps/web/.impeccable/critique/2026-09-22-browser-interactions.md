# Pupside: live interaction review

Follow-up to the source critique, 22 September 2026. The user prioritizes micro-interactions, animation, enjoyable controls, minimal layout movement, typography, and tasteful spacing. This review supersedes the earlier browser-unavailable limitation for the flows tested below; it does not replace that critique's product findings or assign a new Nielsen score.

## Environment and scope

- Current source served by Vite at localhost:5173 with the local Node server at :10000. Existing Node 24.21.0 runtime; build identifier b569a3e, generated timestamp 2026-09-22T20:24:29Z.
- In-app browser: default 1280×720, a 390×844 mobile viewport, and 1440×900 desktop. These are desktop browser viewport tests, not physical touch-device tests.
- Exercised game start, direction and budget selection, scenario disclosure and slider keyboard input, comparison loading, company filters, return to news, native help dialog and Escape focus restoration, purchase, cash-out, chart keyboard inspection, day transitions, and final day selection.
- Also exercised the separate 2,508-contract read-only workload, including company filtering and price-column sorting during streaming.
- No application source was changed. Generated ignored version metadata was refreshed for the running source. Temporary app processes and test tabs were closed; viewport override reset.

## Confirmed findings, ordered for the user's priorities

### 1. Mobile comparison grid collapses to zero height

At 390×844, the comparison area occupied 360px, but both `.ag-root-wrapper` and `[role="grid"]` measured 0px high. Rows existed in the DOM but were clipped, leaving a blank panel beneath the filters. At 1440×900 the grid measured 306.5px and rendered normally.

Likely cause: the mobile comparison establishes a minimum height, while nested wrappers use `h-full` and flex sizing that depend on a definite available height. Trace `.comparison-region` in `src/styles.css:235`, the `flex h-full` wrapper and grid container in `src/screens/desk/CompareOptions.tsx`, and the nested `h-full` wrappers in `src/modules/live-grid/LiveGrid.tsx`.

Fix direction: give the mobile grid a definite usable block size independent of filter wrapping; keep virtualized scrolling inside it. Verify both cold-load and desktop-to-mobile transitions.

### 2. The mobile comparison button breaks the page width

In the normal mobile desk, the document client width was 375px within a 390px viewport with a 15px scrollbar. Document scroll width was 406px. The Compare contracts button extended to x=405.69px and measured 219.25px wide. The neighboring tip wrapped into a narrow column, and the button was visibly clipped at the right edge.

Evidence: `src/screens/desk/Desk.tsx` places a nonshrinking comparison button alongside the icon and growing tip text in one row. `src/screens/ui.tsx` supplies display typography for the sun-tone ghost button.

Fix direction: give the action its own row on narrow containers, or use a compact secondary control with an explicit type size and wrapping rules. Preserve the paragraph's readable measure. Do not hide document overflow to conceal the defect.

### 3. Short desktop layouts combine page scrolling and ticket scrolling

At 1280×720, expanding Explore a price scenario caused the ticket contents to exceed the panel. The purchase control was partly below its clipping boundary until the internal region scrolled. In comparison, the ticket measured 574px client height versus 658px scroll height, with an 84px scroll offset.

Normal desk versus comparison also changed the document scrollbar. The ticket width stayed 340px, but its x position changed from 909px to 924px: the surrounding layout shifted by the scrollbar width.

Fix direction: stabilize the page scrollbar gutter, give the desk a consistent available height, and choose a deliberate scrolling boundary. Keep action placement predictable when optional content expands. Avoid adding animated height to a layout whose overflow behavior is unresolved.

### 4. Selecting final-review days moves unrelated content

At 1440×900, switching from the traded first day to a no-trade second day reduced main content height from 853.75px to 788px. The scrollbar disappeared, page width changed from 1425px to 1440px, and scrollY changed from 58px to 0. The outcome heading moved vertically from 235.78px to 260.91px in the viewport.

Evidence: `src/screens/FinalScreen.tsx` vertically centers its desktop columns; `src/screens/ticket/DayReview.tsx` has substantially different heights for traded and no-trade states.

Fix direction: reserve a sensible review-detail area or top-align the stable summary, and retain a stable scrollbar gutter. Animate the selected day's content within that region instead of moving the whole composition.

### 5. Compact mobile chart labels collide

The compact chart reserves a 152px right rail inside a roughly 309px mobile content area. Opening bell and Closing bell labels overlapped. Bought and Cashed out annotations also crowded the current-price/target area.

Evidence: `src/screens/desk/PriceChart.tsx:100`, `:260`, `:267`.

Fix direction: use a mobile-specific chart annotation arrangement: smaller reserved rail or labels outside the plot, collision-aware time labels, and a compact legend for transaction events. Keep numeric labels readable rather than shrinking all chart text.

### 6. Motion language is functional but uneven

Shared buttons have 150ms color/filter/transform transitions and a one-pixel pressed translation. Direction/budget selections clearly change state. The native help dialog correctly focused Close and restored focus to How it works after Escape, but its computed transition duration was 0s and animation name was none.

Comparison changes the entire composition immediately; purchase/cash-out replace the ticket's contents; final review changes height. These moments deserve continuity once their geometry is stable. Existing confirmation text correctly follows authoritative trade state and must remain the basis of success feedback.

Fix direction: establish a small motion vocabulary: immediate tactile press feedback, short selection transitions, restrained dialog entrance/exit, and one clear confirmation moment for buying or cashing out. Keep digit updates stable. Avoid adding a bounce, hover lift, or repeated entrance to every element.

## Typography and spacing

The bundled Lexend body and Unbounded display pairing reads coherently in the rendered interface. At 1440×900, the panels have comfortable separation and a clear money hierarchy. Fixed-width numeric treatment is worth preserving.

The weaker areas are constrained containers: display typography makes the secondary comparison action too wide; the 340px ticket wraps the value-bar heading; mobile chart annotations consume too much width. Prefer explicit component size/type variants over accumulating conflicting per-call utility sizes.

The 32px comparison chips are visually denser than the 44px pace buttons and larger ticket choices. They need a deliberate compact-versus-touch sizing policy. Real/hope explanatory copy is removed at short viewport heights; a compact disclosure would preserve it without forcing every explanation into the panel.

## What passed

- Scenario slider responded to ArrowRight and updated its scenario value and profit.
- Chart responded to ArrowLeft with an observed-price readout.
- Help dialog focused Close, dismissed with Escape, and restored focus to its opener.
- Company selection followed through comparison and back to the normal desk.
- Purchase and cash-out produced the corresponding authoritative ticket states and chart annotations.
- Repeated day advancement reached the final screen; final day buttons changed the selected review.
- No warning or error entries were returned by the browser log tool for either test tab at the end of the run.

## Layout stability and workload observations

During normal trading, the displayed ticket value changed from $92,475 to $70,692. The amount container and cash-out button retained their widths and heights; the ticket and timer dimensions were also unchanged. A shared 52px viewport-y movement followed keyboard-induced page scrolling, so these readings are not a claim of zero layout shift. They show stable local numeric geometry in the sampled states.

One short 2,508-contract workload sample reported:

| Metric | Observed value |
|---|---:|
| Received records/s | 8,289.5 |
| Accepted changed records/s | 7,834.1 |
| Receipt-to-visible-cell delay p50 / p95 | 71.3 / 79.2ms |
| Animation-frame interval p50 / p95 | 16.7 / 16.8ms |
| Long tasks over 50ms | 1 |

These are the application's displayed measurements in a local development run, not a controlled production benchmark. Client delay excludes network latency and is not physical paint time. No CLS, forced-layout count, CPU profile, or physical-device frame rate was measured.

## Remaining verification limits

Reduced-motion behavior exists in source but was not live-emulated. Continuous animation timing and physical touch feel were not measured. Read-only browser evaluation did not expose `document.getAnimations`; no mutable detector overlay or performance observer was injected. Screenshots and DOM observations establish the layout findings, not a frame-by-frame animation profile.

## Recommended improvement order

1. `impeccable adapt` and `impeccable layout`: repair mobile grid sizing, comparison overflow, chart annotation collisions, and unstable scroll geometry.
2. `impeccable typeset`: normalize component type sizes and spacing at narrow and short containers while preserving the existing font identity.
3. `impeccable animate`: add continuity and tactile state feedback to the stabilized components, with reduced-motion alternatives and authoritative confirmation.
4. `impeccable polish`: verify the complete sequence across desktop/mobile layouts, keyboard use, repeated actions, and streaming updates.

This sequence follows the user's preference for interaction quality and visual craft. It does not require changing the game rules or undertaking the earlier educational-copy recommendations first.
