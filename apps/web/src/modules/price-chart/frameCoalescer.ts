/**
 * Many notifications, one draw per animation frame.
 *
 * Prices may arrive faster than the screen is painted. Drawing for each one
 * would do work nobody can see, so the first notification asks for a frame,
 * the ones after it are swallowed until that frame has run, and the draw then
 * shows whatever is newest.
 */

/**
 * Asks for `run` to be called on the next frame, and gives back the call that
 * takes the request back. It is a parameter so that a test can drive frames by
 * hand; the chart passes the browser's own.
 */
export type RequestFrame = (run: () => void) => () => void;

/** Plain functions, not methods: each may be handed on by itself. */
export interface FrameCoalescer {
  /** Something changed. Asks for a frame unless one is already asked for. */
  readonly notify: () => void;
  /** Takes back a frame that was asked for and has not run. A later `notify` asks again. */
  readonly cancel: () => void;
}

export function createFrameCoalescer(requestFrame: RequestFrame, draw: () => void): FrameCoalescer {
  let takeBack: (() => void) | null = null;

  return {
    notify() {
      if (takeBack !== null) return;
      takeBack = requestFrame(() => {
        takeBack = null;
        draw();
      });
    },
    cancel() {
      takeBack?.();
      takeBack = null;
    },
  };
}

/** The browser's animation frame, in the shape above. */
export const browserFrame: RequestFrame = (run) => {
  const handle = requestAnimationFrame(run);
  return () => {
    cancelAnimationFrame(handle);
  };
};
