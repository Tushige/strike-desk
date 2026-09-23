export type AnalyticsEvent = 'game_started' | 'purchase_accepted' | 'cash_out_accepted' |
  'comparison_opened' | 'game_completed' | 'game_ended_early' | 'replay_clicked';
export type AnalyticsData = Record<string, string | number>;
type Tracker = { track: (event: string, data: AnalyticsData) => void | Promise<unknown> };
declare global { interface Window { umami?: Tracker } }

export interface AnalyticsConfig {
  websiteId: string; scriptUrl: string; domains: string; production: boolean; allowDev: boolean;
}

/** Exact host allowlist; neither scratch pages nor workload/demo visits count. */
export function analyticsAllowed(config: AnalyticsConfig, location: Pick<Location, 'hostname' | 'pathname' | 'search'>): boolean {
  const query = new URLSearchParams(location.search);
  return Boolean(config.websiteId && (config.production || config.allowDev) &&
    config.domains.split(',').map(domain => domain.trim()).filter(Boolean).includes(location.hostname) &&
    location.pathname === '/' && !query.has('board') && !query.has('dev'));
}

let enabled = false;
let initialized = false;
let queue: { event: AnalyticsEvent; data: AnalyticsData }[] = [];

function send(event: AnalyticsEvent, data: AnalyticsData): void {
  try {
    const result = window.umami?.track(event, data);
    if (result instanceof Promise) void result.catch(() => undefined);
  } catch { /* Analytics must never interrupt gameplay. */ }
}

export function trackEvent(event: AnalyticsEvent, data: AnalyticsData = {}): void {
  if (!enabled) return;
  if (window.umami) send(event, data);
  else if (queue.length < 30) queue.push({ event, data });
}

export function initializeAnalytics(): void {
  if (initialized) return;
  initialized = true;
  const config: AnalyticsConfig = {
    websiteId: import.meta.env.VITE_UMAMI_WEBSITE_ID ?? '',
    scriptUrl: import.meta.env.VITE_UMAMI_SCRIPT_URL ?? 'https://cloud.umami.is/script.js',
    domains: import.meta.env.VITE_UMAMI_DOMAINS ?? '',
    production: import.meta.env.PROD,
    allowDev: import.meta.env.VITE_UMAMI_ALLOW_DEV === 'true',
  };
  if (!analyticsAllowed(config, window.location) || navigator.doNotTrack === '1') return;
  try { if (new URL(config.scriptUrl).protocol !== 'https:') return; } catch { return; }
  enabled = true;
  const script = document.createElement('script');
  script.src = config.scriptUrl;
  script.async = true;
  script.dataset.websiteId = config.websiteId;
  script.dataset.domains = config.domains;
  script.dataset.excludeSearch = 'true';
  script.dataset.excludeHash = 'true';
  script.dataset.doNotTrack = 'true';
  script.onload = () => {
    for (const item of queue) send(item.event, item.data);
    queue = [];
  };
  script.onerror = () => { enabled = false; queue = []; };
  document.head.append(script);
}
