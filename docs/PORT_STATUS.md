# Fable donor port

Branch: `feature/layout-improvements`. Base: `9a02418` (clean at start). Donor: `C:/Users/TushigOchirkhuyag/Documents/strike-desk-render (Astra MAX)/strike-desk`, a source export without `.git`. The handoff's `ac17676` reviewed archive is not this checkout's HEAD; existing merge/rebase cleanup and newer engine tests were retained. The donor's assembly and stylesheet were not copied.

Scope: incorporate P01–P11 while retaining Fable's architecture, game rules, glyphs, deliberate builder and teaching features. The third-party handoff supplied design requirements; it was not authorization to publish a deployment. Changes are left reviewable in this branch's working tree.

Visual thesis: a dark Fable desk with clear type and restrained action colors; comparison gains the news rail's space. Content: news for context, chart/grid for comparison, ticket for action, debrief/final for review. Interaction: local chart inspection, stable live rows and existing reduced-motion-aware feedback.

| ID | Implementation | Evidence / remaining work |
| --- | --- | --- |
| P01 | Wide comparison, compact chart, persistent ticket, company chips synchronized with the chart and builder, retained side/affordability filters and grid state; redundant dropdown removed | Company-selection and streaming continuity/custom-budget DOM tests cover the interaction. Viewport inspection pending. |
| P02 | Versioned exact-intent journal; register without sending; original-age policy; receipt-first recovery and same-ID retry | Focused fake-transport tests plus both real-server interrupted-buy tests pass. Actual browser reload QA pending. |
| P03 | Retain final session; Play again closes, clears relevant keys and reloads | Feed retention contract passes. Browser final-refresh/new-game journey pending. |
| P04 | Completed-day `wasTrue` in public projection; distinct event, payout and profit explanations | Live/reply confidentiality and outcome tests pass. |
| P05 | Stable derived subscriptions; separate clock consumers; deferred grid with loading/error/retry | Controlled clock-only notification counts and production static-import graph guard pass. |
| P06 | Under-the-hood help; separate `/?board=2500&dev` workload; automatic comparison view; complete-quote labels; no workload cost column | Real workload stream/restriction and measurement tests pass. Fresh browser observations pending. |
| P07 | Comparison chart at 224px (192px on short desktops), compact-specific plot padding, right-side prices with separated level labels, local pointer/arrow-key inspection, received points only | Chart geometry checks at three sizes and comparison interaction test pass. Build/typecheck/lint pass. Browser visual inspection pending. |
| P08 | Custom whole-dollar amounts through the existing machine/pacer; contextual native help dialog; optional custom entry and price scenario expand on request to preserve panel space | Invalid/unsafe/over-cap parser cases and invalid-edit DOM checks pass. Browser focus/Escape inspection pending. |
| P09 | Selectable diverging day bars; authoritative position/day details; no historical news misattribution | Day-review component/lesson tests pass. Full final-screen browser journey pending. |
| P10 | Full-width news/no-news cards in a scrollable list with conditional edge fades and hidden scrollbar; mobile section links; non-overlapping action dock; cash below worth only when the amounts differ; workload info icon; guarded storage; HMR cleanup; crypto fallback | Scroll-edge, company-selection, typecheck, lint and build checks pass. Requested desktop/phone screenshots pending. |
| P11 | Reproducible strategy audit, updated docs and retained Render contract | 1,000 seeds × four policies, zero rejects. Local release checks pass; no deployment performed. |

## Checkpoints

1. Baseline: confirmed source organization and clean branch. System Node 22 and the broken pnpm shim could not reproduce the pinned environment. Used official Node 24.21.0 (checksum verified) and pnpm 12.5.1 in temporary directories. Repository pins and lockfile were retained.
2. Recovery/projection: introduced explicit restoration and guarded journal; retained the 20-second retry policy; exposed completed-day news truth only. Focused connection/recovery/projection tests passed.
3. Store/layout: isolated clock subscriptions, deferred comparison, retained filters/ticket through toggles, extended chart and builder. Streaming continuity and invalid-edit DOM tests passed.
4. Review/evidence: historical-day review tests, corrected copy, four-policy audit, updated verification and Render handoff.
5. Release: 1,421 tests across 64 files passed with two workers; typecheck/lint/build/bundle/CSS/smoke passed. A final comparison-height adjustment was followed by the affected DOM test and release checks again. See [VERIFICATION.md](VERIFICATION.md).

## Resume here

No connected browser was available: discovery returned an empty list and an attempted in-app browser launch reported unavailable. Do not represent historical screenshots or benchmark numbers as current. The remaining steps are browser QA/captures at 1366×768, 1440×900 and 390×844; a visible-tab workload measurement with full conditions; and separately authorized deployment followed by public verification. The in-memory-session and accelerated-workload chart-history limitations remain explicit.
