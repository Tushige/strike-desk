import { describe, expect, it, vi } from 'vitest';
import { createGameAnalytics } from '../src/analytics/gameAnalytics';
import { analyticsAllowed } from '../src/analytics/umami';
import { recordedGame } from '../src/fixtures/recordedGame';

describe('analytics', () => {
  it('requires configuration and keeps local, scratch and engineering visits out', () => {
    const config = { websiteId: 'public-id', scriptUrl: 'https://cloud.umami.is/script.js',
      domains: 'game.example.com', production: true, allowDev: false };
    const location = { hostname: 'game.example.com', pathname: '/', search: '' };
    expect(analyticsAllowed(config, location)).toBe(true);
    expect(analyticsAllowed({ ...config, websiteId: '' }, location)).toBe(false);
    expect(analyticsAllowed(config, { ...location, hostname: 'localhost' })).toBe(false);
    expect(analyticsAllowed(config, { ...location, search: '?board=2500' })).toBe(false);
    expect(analyticsAllowed(config, { ...location, search: '?dev' })).toBe(false);
    expect(analyticsAllowed(config, { ...location, pathname: '/scratch/lessons.html' })).toBe(false);
    expect(analyticsAllowed({ ...config, production: false }, location)).toBe(false);
  });

  it('counts accepted positions once across repeated frames, reconnects and reloads', () => {
    let saved: string | null = null;
    const storage = { getItem: () => saved, setItem: (_key: string, value: string) => { saved = value; } };
    const send = vi.fn();
    const analytics = createGameAnalytics(send, storage);
    for (const { frame } of recordedGame().frames) { analytics.observe(frame); analytics.observe(frame); }
    const final = recordedGame().frames.at(-1)!.frame;
    expect(send.mock.calls.filter(([name]) => name === 'game_started')).toHaveLength(1);
    expect(send.mock.calls.filter(([name]) => name === 'game_completed')).toHaveLength(1);
    expect(send.mock.calls.filter(([name]) => name === 'purchase_accepted')).toHaveLength(final.positions.length);
    const count = send.mock.calls.length;
    createGameAnalytics(send, storage).observe(final);
    expect(send).toHaveBeenCalledTimes(count);
    const payload = JSON.stringify(send.mock.calls);
    expect(payload).not.toContain(final.session);
    expect(payload).not.toContain('commandId');
    expect(payload).not.toContain('marketCode');
  });

  it('excludes workload frames and still works with unavailable storage', () => {
    const send = vi.fn();
    const analytics = createGameAnalytics(send, { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } });
    const final = recordedGame().frames.at(-1)!.frame;
    analytics.observe({ ...final, stress: true });
    expect(send).not.toHaveBeenCalled();
    analytics.observe(final);
    analytics.observe(final);
    expect(send.mock.calls.filter(([name]) => name === 'game_completed')).toHaveLength(1);
  });
});
