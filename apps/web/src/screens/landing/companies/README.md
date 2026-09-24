# Company list

`CompanyRoster.tsx` owns the list and its loading placeholder. `useCompanyEntrance.ts` owns its animation. `CompanyRoster.test.ts` exercises visibility and playback; `companies.css` styles only its placeholder.

To tune motion, edit `MOTION` at the top of `useCompanyEntrance.ts`:

- `desktop`: the media query for whole-list playback (currently 48rem).
- `desktopVisibleHeight`: fraction of the list's height required before starting (1 = all of it).
- `mobileVisibleHeight`: fraction of each company's height required on mobile (1 = all of it). A list taller than the viewport also uses this policy.
- `viewportInset`: space reserved at the bottom of the viewport, in pixels.
- `stagger`, `logo`, `title`, `subtitle`: overlapping timings and movement for this list only.

Full visibility qualifies the first start. Playback does not pause merely because part of the list subsequently leaves the viewport. Each company finishes once; fully offscreen companies and hidden tabs pause.

There is no animation registration elsewhere. To remove this section, remove its import and JSX in `StartScreenV2.tsx`, then delete this folder. Its tests and placeholder styling leave with it. Shared company glyphs and game data belong to the trading app and remain available.
