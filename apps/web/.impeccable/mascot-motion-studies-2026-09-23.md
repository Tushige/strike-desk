# Landing mascot motion studies

The user requested a working scratch preview of continuous, predictable LED-eye animation. Preserve the current landing and let the user choose before integration.

`/scratch/mascot-motion.html` contains LED ticker (12 seconds), Arcade eyes (10 seconds), and Curious companion (14 seconds). Each repeats smile, dollar signs, rising mint arrows, and rest. The companion adds a glance, wink, and soft antenna light. A head bob is deliberately omitted because the existing illustration is flattened; moving its head cleanly would need an isolated head and background repair.

Focal moment: expressions embedded in the robot's glossy visor. Continuity: eye positions, perspective, fixed image dimensions and familiar composition remain stable. Feedback: explicit expression selection, pause/resume, replay, and mobile preview controls. Budget: shared raster base with small SVG overlays; CSS transforms/opacity; no rendering loop in JavaScript or added animation dependency. Pause offscreen/hidden. Follow the user's prior preference to keep motion independent of OS motion settings.

Generated the blank visor with the built-in image tool, preserving the source artwork in production. Asset and exact prompt: `scratch/assets/robopup-blank-display.png` and `scratch/assets/ROBO-PUP-MOTION-PROMPT.md`.

Verified desktop dollar/arrow alignment, mobile composition without document overflow, expression controls, auto reset, pause/resume, offscreen suspension and JavaScript syntax. Preview-only changes; production landing remains unchanged. No device frame-rate benchmark claimed.

## Selected: Arcade eyes

Promoted the exact ten-second Arcade eyes choreography to `src/screens/landing/ArcadeMascot.tsx` with scoped CSS and a 134 KB JPEG base. Preserved all scratch studies and original still artwork. The loop waits for image load, pauses offscreen/hidden, preserves its position through manual pause/resume, and cleans up observers/listeners when leaving the landing. No runtime animation dependency or per-frame JavaScript work.

Verified desktop/mobile eye placement and equal illustration/overlay bounds, no horizontal overflow, pause/resume behavior, lifecycle and landing integration tests (2 passing), TypeScript, ESLint, production build and CSS layer check. Existing comparison chunk size warning remains unrelated.
