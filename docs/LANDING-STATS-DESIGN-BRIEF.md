# Landing statistics studies

Mode: Persuade. Local extension of the existing landing page, not a redesign of its hero or game flow. Review route: `/scratch/stats.html`. The user selected Community ticket; it is mounted between the primary landing hero and company roster, with real `/api/stats` data.

## Inherited visual world

Keep Ticket S and Bricolage Grotesque for the wordmark, Lexend body copy, the established purple ground (`#14112a`), panel (`#1d1938`), lavender secondary text (`#b3add9`), thin rule (`#352f63`), yellow action (`#ffd447`) and mint gains (`#3ee0a5`). Losses remain coral (`#ff7d6e`). Preserve the current landing illustration and Arcade eyes. Existing 12px panel corners and 8px controls apply.

Visual thesis: an open, readable community record with the material character of the trading desk, using typography and spacing before extra boxes. Design variance 6, motion intensity 5, visual density 3. One compact section between the hero and company roster, leaving game setup and mascot as the dominant opening.

The image-first comparison comp was generated in this session before UI implementation. All three candidates preserve that comp's structure while using the app's actual colors and self-hosted fonts.

## Options

- Market ribbon: open ruled band, three metrics across desktop; profits above two smaller metrics on mobile. Masked number entrances resolve left to right in under 650ms.
- Community ticket (selected): one notched slip, profits leading beside a perforated stub. Mobile stacks profits over two smaller records. The ticket frame and labels remain still; profit glyphs arrive through a short mask with a 45ms stagger and 780ms easing. Games completed follows at 580ms, best run at 900ms; the sequence settles at 1.6s.
- Closing ledger: editorial heading beside three labeled rows, right-aligned numbers. Mobile moves the heading above the rows. Numbers arrive once as entries, with unchanged row footprints.

Replay entrance, mobile width, simulated states, and contextual landing previews are scratch controls only. The API selector reads actual `/api/stats`; failures never silently substitute sample figures. No scratch route loads the Umami tracker or opens a game socket.

## Metric contract

- Games completed: finished five-day games, not unique people.
- Pretend profits earned: `sum(max(final_cash_cents - starting_cash_cents, 0))`. The starting $1,000,000 is never included. Losses do not reduce this positive-profit total.
- Best completed run: `max(final_cash_cents - starting_cash_cents)`, returned by the server as `bestNetProfitCents`. This is separate from the previously available ending-balance metric. It may be negative if every completed game lost money. No completed games means null, displayed as “Not yet.”

The SQL read adds this net-profit aggregate without a schema migration or stored-data change. Formatting stays in BigInt, including trillion-dollar values and exact cent tooltips. Loading reserves number space; errors use “Unavailable” with retry, never fabricated zeroes. Sample values are visibly identified as design-review fixtures.

## Motion and scope

Finite Web Animations API entrances animate transforms and opacity with gentle deceleration; final content is visible without animation support. The first frame is prepared in a layout effect before paint, preventing the previous visible-to-hidden jump. IntersectionObserver starts the paused sequence when visible and disconnects; cleanup cancels active animations. The sequence runs once per mount, and data updates do not replay it. No animated counting or recurring profit ticker. The user's standing preference to keep motion independent of OS reduced-motion settings is preserved.

StartScreenV2 loads real statistics in a bounded eight-second request, with retry and unmount cancellation. Failure never blocks opening the game and never substitutes sample values. Other visual treatments remain in the scratch study.
