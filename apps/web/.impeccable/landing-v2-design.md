# Landing V2 design brief

This records the initial alternative. The approved version is now the default; see [page-load-motion-2026-09-22.md](page-load-motion-2026-09-22.md) for promotion, original-page fallback and motion verification.

## Baseline audit

The incumbent StartScreen has a large text hero, three equal rounded rule cards, a start button and pace selector, and explanatory footnotes. It uses the same game TopBar and build footer as the trading desk. There is no hero artwork. Existing dials are approximately variance 3, motion 2, density 5.

Preserve the Strike Desk wordmark and mark, self-hosted Unbounded/Lexend type, midnight-purple palette, sunflower accent, original company marks, approachable copy, all game rules, and the server-authoritative start flow. Retire the equal-card feature row and pre-game balance/timer dashboard from this alternative only.

The root index is titled Strike Desk and explicitly noindex. No additional SEO metadata, analytics events, consent UI, or marketing routes exist in the inspected landing source. Keep the original route and page intact.

## Direction

Reading this as: an educational game landing page for beginners, with polished arcade language and a tactile product still life.

DESIGN_VARIANCE 8: split hero with bold type and dominant original artwork, followed by a compact company cast and a different editorial learning layout.
MOTION_INTENSITY 6: brief hero arrival, responsive button press, and a fixed-footprint lesson transition. No loops or scroll hijacking.
VISUAL_DENSITY 3: concise invitation, company identities, three teachable decisions, optional detailed rules.

Native CSS and the existing React/Tailwind foundation. No new component or animation libraries. Original SVG brand assets are retained by explicit user preference; no new icon family. Dark theme follows the approved night-arcade identity. OS reduced-motion suppression is omitted per the user's explicit instruction. Corners: 12px surfaces, 8px controls; dividers and space organize content.

## Isolation and behavior

- Default `/` retains StartScreen verbatim.
- `/?landing=v2` opts into a lazily loaded StartScreenV2 while in the lobby. Once the server advances, the existing game UI takes over.
- V2 uses the same connection, startGame command, PACES, and error states. No reset or separate game engine.
- New CSS is scoped to `.landing-v2`; new artwork belongs only to the lazy V2 chunk.
- Original rules and worked example stay available in a disclosure. No invented endorsements or outcome claims.

## Asset

Built-in image_gen generated an original 3D still life of RoboPup, a sunflower bell and directional paper tickets on midnight purple. Generated before implementation. Delivery image is a JPEG encoding at original dimensions (142,934 bytes), sourced from the generated PNG. Exact generation prompt is recorded alongside the asset.

## Pre-flight and verification

- Audited before implementation; declared the design read, all three dials, brand exceptions and isolation strategy above.
- One approved dark theme, existing font families, yellow action accent throughout. Company colors remain identity cues. No new typography, icon or animation dependencies.
- Two-line hero at desktop and 320px mobile; supporting copy is 18 words. Start action bottom was 432px at 390×844 and 446px at 320×740, above the fold in both cases. Navigation is 80px desktop / 72px mobile and stays on one line.
- Page copy reviewed, no em dashes or new testimonials, endorsements, numerical claims, fake product screenshots, overlaid labels, version footers, decorative dots or marquees. Game rules and original worked example are retained in a disclosure.
- Original generated visual is loaded with high priority, explicit dimensions and reserved aspect ratio. Production delivery is 143KB. V2 has a separate dynamic JS entry (6.16KB, 2.29KB gzip) and scoped CSS (9.57KB, 2.38KB gzip); its image is absent from the default entry's asset list.
- Motion is limited to finite hero entrance, press/hover feedback, pace selection and lesson changes. No scroll listeners, continuous React updates or animation loops.
- Keyboard End selected the last lesson and moved focus correctly. Lesson panel height stayed 332.75px before and after switching at 320px. Full rules disclosure and native help dialog/Escape worked.
- No horizontal overflow at 390px and 320px. At 320px the document clientWidth and scrollWidth both measured 305px, accounting for the browser gutter. Reviewed the full desktop and mobile page visually.
- A real five-minute start from V2 reached the existing desk with Day 1 and 5:00. A fresh root tab still showed the original start page. StartScreen.tsx has no diff.
- Integration test verifies the original default, V2 opt-in, disconnected start state, keyboard lessons, chosen pace, duplicate-click suppression, waiting for acceptance, and transition into the existing desk. TypeScript build, production build and CSS architecture check passed.
- Existing comparison chunk size warning remains. No Lighthouse tool was available in the permitted browser interface; no measured Core Web Vitals claim is made. A single hero illustration is intentional for this compact page; there are no filler image sections. Reduced-motion gating and automatic light mode were not introduced, preserving the user's motion preference and approved dark brand.
