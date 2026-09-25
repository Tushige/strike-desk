# Approved landing contrast

Approved 2026-09-23: promote the Motion.dev-inspired contrast sketch to the live Pupside landing using **Lilac (`#b6a0ff`)**, retain the new lesson accordion and its example cards, and preserve the previous community statistics.

## Scope and layout

The landing uses a solid lilac header and hero surround, a sharp dark hero card, the existing RoboPup artwork, a four-part game-facts row, a community-statistics ticket, the fictional-company roster, lessons, expandable rules, and footer help. It stacks for mobile. Ticket S, Lexend body copy, Unbounded display type, Bricolage Grotesque identity and supporting headings, and the existing company marks remain.

Sharp corners and the lilac accent are landing-specific exceptions to the broader panel guidance. Whole-game tokens, trading screens, server rules, and the final-summary lesson presentation are unchanged by this direction. Design dials remain variance 7 / motion intensity 4 / visual density 4.

## Live behavior

`StartScreenV2.tsx` keeps the real game-start command and 15-, 5-, and 2-minute choices. Starting requires a live connection, prevents duplicate submission, disables pace changes while opening, and reports failure so the player can retry. Connecting, server-capacity, and lost-game messages remain visible. This action starts a real pretend-money game; the scratch action remains preview-only.

The existing `CommunityStats` ticket receives live data from `usePublicStats`. It shows games completed, pretend profits earned, and the best completed run. Loading placeholders and a loading status, unavailable values and a retry button after errors, and the empty-history state are preserved. Statistics failure does not block play. The ticket explains that starting capital is excluded, total profits count winning runs only, and all money is pretend.

`LandingLessons.tsx` expands one of three explanations at a time and pairs it with an illustrative example: news uncertainty, choosing a direction and target, or payout versus profit. The third example keeps the $200 payout minus $300 cost equals −$100 result. Lesson controls expose expanded state and support arrow, Home, and End focus navigation. Existing mascot pause/resume, roster loading, game help, and separate engineering help remain available.

## Shared implementation and scratch

Production and the sketch share `apps/web/src/screens/landing/LessonVisual.tsx`, the existing `ArcadeMascot`, and `apps/web/src/screens/landing/landing-contrast.css`. The production entry is `apps/web/src/screens/landing/StartScreenV2.tsx`; the lesson interaction lives in `LandingLessons.tsx` in the same directory.

The experiment remains at `/scratch/landing-motion.html` with Sun, Mint, and Lilac palettes, `palette=...`, and `frame=1`. Its palette selector, mobile-preview frame, and floating controls are excluded from the live landing. `apps/web/src/scratch/landing-contrast-study.css` imports the shared landing styles and adds only the sketch presentation controls.
