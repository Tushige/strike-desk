import { useEffect, useState } from 'react';
import type { StatsState } from './CommunityStats';
import { parseLandingStats } from './publicStats';

/** One bounded request per landing visit; statistics never gate starting a game. */
export function usePublicStats() {
  const [state, setState] = useState<StatsState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let disposed = false;
    const timeout = setTimeout(() => { controller.abort(); }, 8000);
    void (async () => {
      try {
        const response = await fetch('/api/stats', { signal: controller.signal });
        if (!response.ok) throw new Error('Statistics unavailable');
        const data = parseLandingStats(await response.json());
        if (!disposed) setState({ status: 'ready', data });
      } catch {
        if (!disposed) setState({ status: 'error' });
      } finally {
        clearTimeout(timeout);
      }
    })();
    return () => { disposed = true; clearTimeout(timeout); controller.abort(); };
  }, [attempt]);
  const retry = () => { setState({ status: 'loading' }); setAttempt(value => value + 1); };
  return { state, retry };
}
