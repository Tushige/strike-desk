# Lesson slider studies

The user requested three scratch alternatives for replacing the final-summary lesson accordion with an always-visible band that rotates through one lesson at a time.

`/scratch/lessons.html` contains News reel (vertical roll with a faded next headline), Ticket conveyor (horizontal perforated slips with a neighboring ticket visible), and Stacked slips (top slip exits to expose the next). All use the existing three lesson strings imported from `words.ts`, with contextual headings. The surrounding footer demonstrates placement in the summary. Live gameplay is unchanged.

Default reading interval is eight seconds, adjustable to four or twelve in the workbench. Each slider provides direct lesson selection, previous/next, and pause/resume. Hover, keyboard focus, offscreen position and hidden documents pause rotation. Time remaining and the transform-based progress indicator pause together. Screen readers receive manual-selection announcements, not repeated automatic announcements. All slide elements reserve the same grid cell to stabilize height. The first lesson is present in HTML even before the module initializes.

Motion uses a 240ms exit overlapping a 460ms decelerating entrance. Only transform and opacity animate within the local content region; old animations cancel on repeated navigation. It follows the user's preference to keep motion independent of OS settings. Page exit clears timers, observers and animations.

Verified desktop and mobile at 390px/320px, autoplay advancement, pause, lesson-three-to-one wraparound, and the longest lesson in each narrow band without horizontal overflow. JavaScript syntax check passed. No production files or backend behavior changed.
