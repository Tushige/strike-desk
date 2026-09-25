# Pupside

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

General beginners learning about options are the primary audience. Explain choices and outcomes without assuming trading knowledge.

Engineering reviewers are a secondary audience served by the separate, read-only engineering demonstration.

## Product Purpose

Help beginners explore options, news uncertainty, and risk through a five-day game with six fictional companies and $1,000,000 of pretend money.

Learning means understanding how direction, target price, premium, expiry, and exit timing affect an outcome. A correct price prediction or a paying ticket can still lose money after its premium. Finishing with a profit is not the only useful outcome; reviewing a loss or choosing to sit out can teach the same concepts.

## Operating Context

The browser app has a start screen, a trading desk, and a final review. Players choose a 15-, 5-, or 2-minute game, read source-rated headlines, select a company, choose UP or DOWN, set a target and budget, and inspect a quote before buying. During trading they can cash out or hold until the bell. Daily and final reviews explain the recorded outcomes.

Comparison provides more detailed contract exploration while preserving access to the chart and ticket. The engineering workload opens separately through Under the hood and cannot place trades.

## Capabilities and Constraints

The following baseline was confirmed during initialization:

- Preserve the five-day game, fictional companies and money, plain-language explanations, server-authoritative trades, and separate read-only engineering demo.
- Keep the primary experience understandable to general beginners.

Existing implementation facts, grounded in the repository:

- Players may make up to three purchases per day, sharing a spending allowance of half their start-of-day cash, and buy whole tickets. Actual purchase costs reduce the allowance. Cash-outs neither refill it nor restore purchase slots. Each purchase is managed independently, including repeat contracts and opposite directions. Sitting out is valid.
- UP means call, DOWN means put, target means strike, ticket price means premium, and the closing bell means expiry. Explain the familiar term alongside its financial equivalent.
- Real value means intrinsic value; hope value means time value. Distinguish payout from profit after premium.
- What-if results are server-provided scenarios, not forecasts. A headline's follow-up and event prices become public when that event lands; future events stay hidden. Completed days retain the traded company's story for review.
- The server owns time, money, pricing, quantities, and settlement. The browser presents authoritative values and submits intent. Feedback must distinguish pending, confirmed, rejected, stale, and disconnected states without implying a trade succeeded before confirmation.
- Prices stream while players inspect and compare contracts. Preserve readable values, stable controls, and the current selection during updates.
- The normal board has 252 contracts; the optional engineering workload has 2,508. Workload trading is blocked by both client and server.
- Games are stored in server memory, with a 30-minute disconnected lifetime. Restart, redeployment, and expiry lose sessions. Browser storage is optional; refresh recovery depends on available storage and a retained server session.
- Completed game results are recorded in Neon PostgreSQL when configured, with separate development and production totals. Public statistics describe completed games and pretend profits after excluding starting capital; active game sessions remain in memory. Umami provides website analytics separately.
- The current product has no authentication, multiplayer, live-news dependency, or LLM dependency.

## Brand Commitments

Explain news events quietly at the chart and in News, keeping the original report and existing confidence labels. Do not add repetitive uncertainty disclaimers, flashing twist banners, or interrupting prompts. Daily and final reviews connect the player's direction and entry/exit timing to the event, then distinguish payout from profit. Requested 2026-09-23.

The product name is Pupside. Keep explanations plain and approachable, introduce financial terminology in context, and consistently identify the companies and money as fictional.

Keep the existing playful company icons, color accents, and approachable typography. The user's Option Arcade prototype is a reference for restrained spacing and separate company navigation and news presentation, not for backend behavior or game rules.

Use the prototype's restrained panel treatment: a single thin outer border, 12px panel corners, 8px control corners, divided header bands, and consistent 20px content insets. Prefer spacing and dividers to nested filled boxes; countdowns are quiet status text. This refinement was requested with comparison screenshots on 2026-09-22.

On mobile, lead with company selection and the selected chart. News is a separate reading view. Market, News, and Your ticket preserve the selected company and current draft across navigation. This direction was confirmed by the user on 2026-09-22.

Keep motion enabled independently of the operating system's reduced-motion preference, as explicitly requested by the user on 2026-09-22. Use brief, finite feedback and preserve immediate controls and truthful trade status.

Use Balance Journey as the live game-over summary, with a finite chart-drawing entrance and staggered supporting content. Retain Closing receipt, Trading journal, and Arcade scorecard in code and in their scratch studies only; do not expose a style selector in the live game. Reviewing a different day must preserve the chart and page footprint rather than replay the entrance. This direction was selected by the user on 2026-09-22.

RoboPup appears as the ticket clerk after a confirmed purchase, the bell keeper with recorded daily results, and the receipt-bearing companion beside the final rank. Use the approved landing-matched pose sheet, fixed image space and brief finite reactions. Keep monetary outcomes and trade status in accessible text; reactions are decorative and supportive across wins and losses.

The landing mascot uses the selected Arcade eyes treatment: a ten-second repeating smile, rolling dollar signs, rising mint arrows, and rest. Keep its body still and the illustration footprint fixed. Expressions are decorative, never live market signals. Provide manual pause/resume and pause automatically offscreen or in a hidden tab, preserving the loop position. Retain all three motion studies in scratch. Selected 2026-09-23.

Use the approved Motion.dev-inspired contrast landing with a lilac (`#b6a0ff`) field, dark hero card, and sharp panel corners. Keep the new lesson accordion and its matching example cards, the existing live community-statistics ticket with loading/error/retry states, and the real game-start flow. Retain Ticket S, the existing fonts, company marks, and Arcade eyes mascot. This landing-specific palette and corner treatment is an exception to the general panel guidance; whole-game design tokens stay unchanged. Palette experiments and mobile-preview controls remain in scratch. Approved 2026-09-23; implementation context is in `../../docs/LANDING-CONTRAST.md`.

The final-summary lessons use the selected Ticket conveyor: one always-visible lesson on a perforated slip, a peek at the next ticket, and an eight-second reading interval. Include direct lesson selection, previous/next and pause/resume. Pause while hovered, focused, offscreen or in a hidden tab, preserving remaining time. Keep the content height stable and use the existing lesson copy without an accordion.

## Evidence on Hand

Paths below are relative to this app unless stated otherwise:

- `src/screens/words.ts` and `src/screens/GameHelp.tsx`: current game instructions, terminology, and worked examples.
- `src/screens/ticket/` and `src/screens/desk/`: implemented trading, comparison, chart inspection, and review workflows.
- `../../README.md`: architecture, game rules, recovery behavior, and runtime constraints.
- `../../docs/DECISIONS.md`: implementation decisions; later donor-port entries supersede conflicting historical entries.
- `../../docs/MODEL.md` and `../../docs/model-audit.json`: evidence about the fictional model, not real-market returns or proof of educational effectiveness.
- `../../docs/VERIFICATION.md`: recorded verification and its limits. Historical screenshots are not evidence of the current interface's visual quality.

No user research or measured learning outcomes were established during initialization. Do not invent testimonials, adoption figures, or effectiveness claims.

## Product Principles

1. Explain the consequence of a choice at the point where a beginner makes it.
2. Make premium, payout, and profit distinct so a correct prediction does not imply a profitable trade.
3. Preserve truthful state: authoritative quotes, explicit trade confirmation, and honest recovery feedback.
4. Keep the game approachable while letting interested users explore detailed comparisons and the separate engineering demo.
5. Use reviews to explain uncertainty and tradeoffs, including the value of sitting out.

## Open Decisions

The selected app identity is Ticket S: a yellow notched ticket with an S cutout, paired with title-case “Pupside” in Bricolage Grotesque 800. Use it consistently in landing and gameplay headers and the browser icon. Keep Lexend for body copy and Unbounded for existing display typography. Alternate identity studies remain on `/scratch/brand.html`.

Specific age ranges, classroom requirements, supported device commitments, and a formal accessibility conformance target have not been established. Existing keyboard and focus support are implementation evidence to preserve during refinements, not a claim of full conformance.
