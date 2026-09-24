# Approved motion

The approved studies remain at `/scratch/stats-motion.html` and `/scratch/page-motion.html`. Live components retain their existing layout, data, and controls.

- Community statistics: GSAP digit-strip odometer, 1.5 seconds with `power2.out`. Currency signs, separators, units, labels, and ticket stay fixed. Profit starts first, then games at 200ms and best run at 400ms. No rebound or replacement of the strips after settling. Formatting still uses BigInt; initial values animate on visibility and refreshed totals settle directly.
- Landing companies: 28px travel, .94 starting scale, slight authored rotation, a reproducible shuffled stagger, and `back.out(1.4)`. Use the gentler approved preview; the stronger “Reference energy” treatment remains scratch-only.
- Desk panels: sidebar, market, then ticket, using 20px travel, .98 scale, and `power3.out`. Each panel enters once on visibility, including panels initially hidden by mobile navigation. Price ticks, company selection, and ticket edits do not replay the entrance. Existing loading skeletons stay in place; no artificial loading delay is introduced.
- Balance Journey: 1.5-second DrawSVG trace with one shared `power2.out` progression. Dots enter as the line reaches them. Paths use rendered-pixel coordinates to avoid nonuniform SVG scaling errors; missing records remain disconnected. Day selection does not replay the trace. Resizing finishes the entrance and recomputes geometry without a second animation.

The project keeps the user's explicit preference to animate independently of the operating system's reduced-motion setting. Animation teardown disconnects observers and releases GSAP effects on unmount. Sketch iteration needs only a quick sanity check; integration uses targeted code checks rather than extended browser sessions.
