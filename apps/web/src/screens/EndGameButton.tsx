import { useId, useRef } from 'react';
import { Button } from '../components/Button';
import { Dialog } from '../components/Dialog';
import './end-game.css';

function StopIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M8 3h8l5 5v8l-5 5H8l-5-5V8Z" />
      <rect x="9" y="9" width="6" height="6" rx=".5" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function EndGameButton({ onEnd }: { onEnd: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const title = useId();
  const description = useId();
  return (
    <>
      <Button
        ref={opener}
        type="button"
        variant="danger-outline"
        className="end-game-trigger inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-2.5 py-2.5 text-sm font-semibold whitespace-nowrap sm:px-3.5 [&>svg]:size-4.5"
        aria-haspopup="dialog"
        onClick={() => {
          dialog.current?.showModal();
        }}
      >
        <StopIcon />
        End game
      </Button>
      <Dialog
        size="confirmation"
        ref={dialog}
        className="end-game-dialog"
        aria-labelledby={title}
        aria-describedby={description}
        onClose={() => {
          opener.current?.focus();
        }}
      >
        <div className="flex items-center gap-3.5 [&>svg]:size-7.5 [&>svg]:text-coral [&>h2]:text-xl [&>h2]:font-semibold">
          <StopIcon />
          <h2 id={title}>End this game?</h2>
        </div>
        <div id={description} className="mt-5 space-y-2 text-sm leading-relaxed [&>p+p]:text-muted">
          <p>You won’t be able to resume this run.</p>
          <p>
            Any open ticket stays unfinished. You’ll see an early-exit summary, then you can start a
            new game.
          </p>
        </div>
        <div className="mt-7 grid grid-cols-2 gap-2.5 border-t border-line pt-5 sm:flex sm:justify-end sm:gap-3">
          <Button
            type="button"
            autoFocus
            variant="secondary"
            className="min-h-11 rounded-lg px-3.5 py-2.5 text-sm font-semibold"
            onClick={() => {
              dialog.current?.close();
            }}
          >
            Keep playing
          </Button>
          <Button
            type="button"
            variant="danger"
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-3.5 py-2.5 text-sm font-semibold [&>svg]:size-4.5"
            onClick={onEnd}
          >
            <StopIcon />
            End game
          </Button>
        </div>
      </Dialog>
    </>
  );
}
