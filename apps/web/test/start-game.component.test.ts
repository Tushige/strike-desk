// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useStartGame } from '../src/screens/useStartGame';

const mocks = vi.hoisted(() => ({
  start: vi.fn(),
  dismiss: vi.fn(),
  state: { phase: 'live', serverFull: false, gameGone: false },
}));
vi.mock('../src/screens/commands', () => ({ startGame: mocks.start }));
vi.mock('../src/boot', () => ({ connection: { dismissGameGone: mocks.dismiss } }));
vi.mock('../src/store/hooks', () => ({ useConnectionState: () => mocks.state }));
beforeEach(() => {
  mocks.state.phase = 'live';
  mocks.state.gameGone = false;
  mocks.start.mockReset();
  mocks.dismiss.mockReset();
});
afterEach(cleanup);

it('blocks disconnected starts and keeps an accepted start locked until routing changes', async () => {
  mocks.start.mockResolvedValue({ outcome: 'accepted' });
  const view = renderHook(({ connected }) => useStartGame(connected), {
    initialProps: { connected: false },
  });
  await act(() => view.result.current.open());
  expect(mocks.start).not.toHaveBeenCalled();
  view.rerender({ connected: true });
  act(() => {
    view.result.current.setPace(3);
  });
  await act(async () => {
    await Promise.all([view.result.current.open(), view.result.current.open()]);
  });
  expect(mocks.start).toHaveBeenCalledExactlyOnceWith(3);
  expect(view.result.current.opening).toBe(true);
  await act(() => view.result.current.open());
  expect(mocks.start).toHaveBeenCalledTimes(1);
});

it.each(['rejected', 'transport'])(
  'unlocks after a %s failure and permits retry',
  async (failure) => {
    if (failure === 'transport') mocks.start.mockRejectedValueOnce(new Error('Offline'));
    else mocks.start.mockResolvedValueOnce({ outcome: 'rejected' });
    mocks.start.mockResolvedValueOnce({ outcome: 'accepted' });
    mocks.state.gameGone = true;
    const { result } = renderHook(() => useStartGame(true));
    await act(() => result.current.open());
    expect(mocks.dismiss).toHaveBeenCalledOnce();
    expect(result.current.opening).toBe(false);
    expect(result.current.failed).toBe(true);
    await act(() => result.current.open());
    expect(mocks.start).toHaveBeenCalledTimes(2);
    expect(result.current.failed).toBe(false);
    expect(result.current.opening).toBe(true);
  },
);
