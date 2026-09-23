import { useId, useRef } from 'react';
import './end-game.css';

function StopIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true">
    <path d="M8 3h8l5 5v8l-5 5H8l-5-5V8Z" />
    <rect x="9" y="9" width="6" height="6" rx=".5" fill="currentColor" stroke="none" />
  </svg>;
}

export function EndGameButton({ onEnd }: { onEnd: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const title = useId();
  const description = useId();
  return <>
    <button ref={opener} type="button" className="end-game-trigger" aria-haspopup="dialog"
      onClick={() => { dialog.current?.showModal(); }}><StopIcon />End game</button>
    <dialog ref={dialog} className="help-dialog end-game-dialog" aria-labelledby={title} aria-describedby={description}
      onClose={() => { opener.current?.focus(); }}>
      <div className="end-game-heading"><StopIcon /><h2 id={title}>End this game?</h2></div>
      <div id={description} className="end-game-consequences">
        <p>You won’t be able to resume this run.</p>
        <p>Any open ticket stays unfinished. You’ll see an early-exit summary, then you can start a new game.</p>
      </div>
      <div className="end-game-actions">
        <button type="button" autoFocus className="end-game-cancel" onClick={() => { dialog.current?.close(); }}>Keep playing</button>
        <button type="button" className="end-game-confirm" onClick={onEnd}><StopIcon />End game</button>
      </div>
    </dialog>
  </>;
}
