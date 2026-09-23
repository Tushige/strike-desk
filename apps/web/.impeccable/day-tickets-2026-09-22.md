# Trading ticket progress strip

The user selected Trading ticket strip from `scratch/day-progress.html`. Replaced the header's day capsules with five numbered ticket stubs. Today is yellow and lifted; settled days show + profit, − loss or 0 no change using server day results. Accessible list-item names include each day's status and signed result; `aria-current` marks only the active unsettled day.

Desktop keeps the 76px header. Tickets use a compact 33×48px treatment below 1200px. Below 1024px the strip occupies a separate header row, keeping the timer and worth readable. The mobile strip is 189px wide.

Current-ticket changes transition for 280ms. Newly received settlements stamp for 320ms, once. Historical results on initial connection or a restored session do not animate. Hidden documents do not stamp. There are no loops or animation dependencies, and OS motion gating remains omitted per the user's preference.

Verified the live game at 1440, 1024, 640, 390 and 320px, including actual completed days and the next yellow ticket. No document overflow at the narrow sizes. Five focused tests pass (ticket states, once-only settlement, restore/hidden behavior, final state and landing/start integration). TypeScript, scoped ESLint, production build and CSS architecture checks pass. The existing comparison chunk-size warning remains.
