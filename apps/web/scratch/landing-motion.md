# Landing contrast sketch

Open [the local sketch](http://localhost:5173/scratch/landing-motion.html) with the web development server running.

This experiment explores the requested Motion.dev contrast aesthetic in Pupside’s color scheme: a bright, solid field around a dark hero card, strong type, crisp edges, and compact supporting sections. The user approved the Lilac version for the production landing on 2026-09-23, including its lesson accordion and example cards while retaining live community statistics. Production and scratch now share the artwork and landing styles; this page retains palette experiments and preview controls. The approved change is landing-specific, with whole-game design tokens unchanged. See `docs/LANDING-CONTRAST.md` for production scope.

The screenshot-inspired sharp field and dark card intentionally override generic rounded-shape guidance on this landing. Design dials: **variance 7 / motion intensity 4 / visual density 4**.

## Palettes and preview controls

| Palette parameter | Accent |
| --- | --- |
| `palette=sun` (default) | Ticket yellow, `#ffd447` |
| `palette=mint` | Mint, `#82ebbd` |
| `palette=lilac` | Soft violet, `#b6a0ff` |

The floating controls switch palettes, collapse the control panel, and open a 390px mobile preview. Palette selection updates the URL. Add `frame=1` to hide the sketch controls; for example, [mint without controls](http://localhost:5173/scratch/landing-motion.html?frame=1&palette=mint).

## Retained identity and behavior

The sketch retains the existing Lexend body font, Unbounded display font, and Bricolage Grotesque identity and supporting headings. It reuses Ticket S, the company marks, and the existing original RoboPup mascot artwork through `ArcadeMascot`, including its manual pause/resume control.

Game length buttons select 15, 5, or 2 minutes. The main action only confirms that choice in preview text; it does not start a live game. Navigation anchors, three lesson selectors with corresponding illustrations, and the expandable rules section are interactive. The footer links back to the current landing page.

The copy preserves fictional money and companies, the five-day premise, and the distinction between payout and profit after ticket cost. No adoption or learning-effectiveness claims are introduced.

## Source

- Entry: `apps/web/scratch/landing-motion.html`
- Component: `apps/web/src/scratch/LandingContrastStudy.tsx`
- Shared example cards: `apps/web/src/screens/landing/LessonVisual.tsx`
- Shared landing styling: `apps/web/src/screens/landing/landing-contrast.css`
- Sketch controls styling: `apps/web/src/scratch/landing-contrast-study.css`
- Product context: `apps/web/PRODUCT.md`
