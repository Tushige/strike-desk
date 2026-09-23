# RoboPup in gameplay

Promoted the three user-approved scratch poses into live gameplay. The original transparent artwork and prompt provenance live in `src/assets/mascot/`; the scratch page remains available.

- LiveTicket shows the clerk pose and animates its stamp only for an accepted buy notice alongside a server-owned position. Restored positions without that notice remain still.
- ResultPanel shows the bell keeper and reacts when the recorded daily result is available, using the same pose for every outcome.
- Balance Journey displays the receipt pose beside the rank. Other retained summary compositions remain unchanged.

RoboPup is a shared decorative component. Images preload during gameplay; reactions wait for the image load, do not repeat on identical state updates, skip hidden-document animation and cancel on unmount or changed dependencies. Fixed art dimensions preserve layout. The desk header pose is 54px so its antennae fit inside the existing panel band; summary art is 104px desktop / 76px compact. No loops, trade logic changes, or OS motion suppression were introduced.

Validation: 10 targeted tests passed for mascot lifecycle, summary behavior and day review. TypeScript, targeted ESLint, production build and CSS checks passed. A real local short game confirmed accepted-trade art, closing-bell art and final-summary art. Summary visually verified at 390px and checked for horizontal overflow at 320px. The unchanged source PNG is 1.33 MB, downloaded once and reused across poses; the existing comparison-chunk build warning remains.
