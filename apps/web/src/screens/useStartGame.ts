import { useRef, useState } from 'react';
import type { Pace } from '@strike-desk/shared/time';
import { connection } from '../boot';
import { lineStateOf } from '../modules/connection/index';
import { useConnectionState } from '../store/hooks';
import { startGame } from './commands';
import { startWords } from './words';

export function useStartGame(connected: boolean) {
  const [pace, setPace] = useState<Pace>(1);
  const [opening, setOpening] = useState(false);
  const [failed, setFailed] = useState(false);
  const submitting = useRef(false);
  const state = useConnectionState();
  const live = connected && lineStateOf(state.phase) === 'live';

  async function open() {
    // Lock synchronously: two clicks can arrive before React renders disabled.
    if (!live || submitting.current) return;
    submitting.current = true;
    if (state.gameGone) connection.dismissGameGone();
    setOpening(true);
    setFailed(false);
    try {
      const result = await startGame(pace);
      // An accepted command stays locked until the server frame opens the desk.
      if (result.outcome === 'accepted') return;
    } catch {
      // Transport failures leave the player able to retry after reconnecting.
    }
    submitting.current = false;
    setOpening(false);
    setFailed(true);
  }

  const status = state.serverFull
    ? startWords.serverFull
    : state.gameGone
      ? startWords.gameGone
      : failed
        ? 'The desk did not open. Try again when connected.'
        : 'A trading game. No real money involved.';

  return {
    pace,
    setPace,
    opening,
    live,
    open,
    status,
    failed,
    serverFull: state.serverFull,
    gameGone: state.gameGone,
  };
}
