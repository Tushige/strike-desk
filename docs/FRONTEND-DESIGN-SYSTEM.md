# Frontend design system

`apps/web/src/theme.css` is the Tailwind v4 theme: brand and semantic colors, fonts, fluid type scales, content widths, breakpoints, and shared animation tokens. `styles.css` imports it after Tailwind and preserves the cascade order `theme, base, ag-grid, components, utilities`.

## Styling

- Use semantic utilities (`bg-panel`, `text-muted`, `border-line`, `text-mint`, `text-coral`) and the Tailwind spacing scale for production layout. Mint means profit/up, coral means loss/down; company colors identify companies.
- Landing surfaces use the `landing-*` tokens. The page accent also supplies browser theme metadata. Receipt illustrations use `receipt-*` tokens. Add reusable values to the theme rather than copying color literals into components.
- Use `page-width` for aligned landing sections. Responsive typography and container breakpoints are named in the theme. Arbitrary values are reserved for intrinsic geometry such as SVG coordinates, proportional grid tracks, and clipping masks.
- `components/Button.tsx` owns button variants, focus and disabled behavior; the screen-level primary, ghost and choice buttons compose it. `components/Dialog.tsx` provides the native modal surface and passes through React 19 refs and native dialog attributes. Callers own dialog contents and restore focus on close.
- Custom CSS remains appropriate for chart/grid integration, sprite artwork, coordinated motion, and the existing desk/summary layouts. Keep those rules scoped to their feature and use theme variables. Put new component CSS in the `components` layer so utilities can override it.

## React boundaries

- `StartScreenV2` composes landing sections. `useStartGame` owns connection eligibility, pace, submission locking and failure recovery for both start screens. Only a server frame changes the game route.
- `CommunityStats` owns accessible presentation; `usePublicStats` owns requests and retry. Its variant map contains complete Tailwind class strings, so CSS generation does not depend on runtime string interpolation.
- `LandingLessons` owns accordion selection and keyboard navigation. `LessonVisual` owns the illustrated explanation.
- `DayResults` owns day selection and stable review panels. `useLessonRotation` owns visibility, interaction pauses, elapsed reading time and animation cleanup; `LessonConveyor` renders it.
- Keep connection, order-ticket and store modules authoritative. Styling changes must not move money calculations, routing decisions or retry semantics into presentation components.

## Maintenance

Run `pnpm format:web` for production React formatting and `pnpm format:web:check` to verify it. Sketch source and its retained styles are excluded. Preserve public exports consumed by those pages, but never import sketch modules into production.

Comments explain behavior, invariants or non-obvious constraints. They should not record conversation history, approvals, task instructions, or who requested a change. Routine implementation should be readable from names and structure.

Check type safety, lint, component tests, production build, CSS layers and bundle boundaries. Browser checks cover landing at mobile and desktop widths, keyboard accordion navigation, stats states, opening a game, modal focus, and summary rotation.
