# Ticket conveyor in the live summary

Replaced the lesson accordion in FinalScreen with the user-selected Ticket conveyor from the scratch studies. The first lesson is always visible. Existing lesson text appears in a perforated warm-toned ticket with a clipped next-ticket hint, lesson selection buttons, previous/next, pause/resume and a reading progress line. The scratch alternatives remain intact.

An eight-second timer preserves remaining time when hovering, focusing, leaving the viewport or hiding the document. Manual navigation restarts the reading interval. Automatic changes do not make live-region announcements; manual changes do. All slides share a grid cell for a stable height. Timers, observers and animations clean up on unmount. The existing user preference for OS-independent motion remains in effect.

Verification: eight conveyor/summary tests passed, including autoplay wraparound, preserved pause time, focus behavior, hidden tabs and cleanup. TypeScript, ESLint, production build and CSS checks passed. Browser verified the production component at desktop and 390px, including autoplay and identical footer position across lesson changes; checked 320px overflow. Existing comparison-chunk warning remains. No game mechanics or backend changes.
