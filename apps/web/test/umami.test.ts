// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  delete window.umami;
  document.head.replaceChildren();
  vi.resetModules();
});

async function enabledTracker() {
  vi.stubEnv('VITE_UMAMI_WEBSITE_ID', 'test-website');
  vi.stubEnv('VITE_UMAMI_DOMAINS', window.location.hostname);
  vi.stubEnv('VITE_UMAMI_ALLOW_DEV', 'true');
  const tracker = await import('../src/analytics/umami');
  tracker.initializeAnalytics();
  return tracker;
}

it('loads one async tracker, strips URL extras, and flushes events after script load', async () => {
  const tracker = await enabledTracker();
  tracker.initializeAnalytics();
  const scripts = document.head.querySelectorAll('script');
  expect(scripts).toHaveLength(1);
  const script = scripts[0]!;
  expect(script.async).toBe(true);
  expect(script.dataset.excludeSearch).toBe('true');
  expect(script.dataset.excludeHash).toBe('true');
  tracker.trackEvent('game_started', { pace: 3 });
  const track = vi.fn();
  window.umami = { track };
  script.dispatchEvent(new Event('load'));
  expect(track).toHaveBeenCalledExactlyOnceWith('game_started', { pace: 3 });
});

it('contains blocked scripts and tracking exceptions', async () => {
  const tracker = await enabledTracker();
  window.umami = { track: () => { throw new Error('blocked'); } };
  expect(() => tracker.trackEvent('game_started')).not.toThrow();
  const track = vi.fn(() => Promise.reject(new Error('network')));
  window.umami = { track };
  tracker.trackEvent('game_started');
  await Promise.resolve();
  document.head.querySelector('script')!.dispatchEvent(new Event('error'));
  tracker.trackEvent('game_completed');
  expect(track).toHaveBeenCalledTimes(1);
});
