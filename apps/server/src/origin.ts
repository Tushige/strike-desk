/**
 * Which pages may open a socket to this service.
 *
 * The same-origin policy does not cover WebSockets: any page on any site can
 * make a visitor's browser open one here, and the browser will send the
 * visitor's cookies with it. This game has no cookies and no login, so the
 * prize is smaller than usual, but a stranger's page could still spend the
 * service's memory and processor on sessions nobody is playing. The rule is
 * applied in the upgrade handler, before the handshake, so a refused socket
 * never becomes a connection at all.
 */

/**
 * Where the development server runs. These are allowed on the public host
 * too. That is deliberate and harmless: with no cookies and no login, a page
 * on somebody's own machine gains nothing a plain script could not already
 * do, and the alternative is a setting that can be wrong in production.
 */
export const DEV_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173'] as const;

/** The three request headers the rule reads, and nothing else. */
export interface UpgradeOrigin {
  /** The `Origin` header. Absent from every client that is not a browser. */
  origin: string | undefined;
  /** The `Host` header: the address the client asked for. */
  host: string | undefined;
  /** The `X-Forwarded-Host` header: the address the browser asked for, when a proxy stands in front. */
  forwardedHost: string | undefined;
}

/** An Origin is an address, so only the two schemes a page can be served over count. */
const PAGE_SCHEMES = ['http:', 'https:'];

/** The first entry of a proxy's comma-separated list: the address the browser asked for. */
function askedFor(header: string | undefined): string | undefined {
  if (header === undefined) return undefined;
  const first = header.split(',')[0]?.trim();
  return first === undefined || first === '' ? undefined : first;
}

/**
 * True when this upgrade may proceed. Pure: it reads no clock, no
 * environment and no configuration, so both answers are ordinary tests.
 */
export function originAllowed({ origin, host, forwardedHost }: UpgradeOrigin): boolean {
  // No Origin at all means no browser. The end-to-end check, the measurement
  // scripts and any other client speak the protocol without one, so refusing
  // this case would turn the deploy gate red while proving nothing.
  if (origin === undefined || origin === '') return true;

  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    // `null` — the literal word a sandboxed page sends — lands here with
    // everything else that is not an address.
    return false;
  }
  // Whole origins only, scheme and host and port together. An Origin header
  // carries no path, so a value that does not survive being read back as one
  // is not an Origin, and no comparison here is ever a prefix of a name.
  if (parsed.origin !== origin) return false;
  if (!PAGE_SCHEMES.includes(parsed.protocol)) return false;

  if ((DEV_ORIGINS as readonly string[]).includes(origin)) return true;

  return parsed.host === askedFor(host) || parsed.host === askedFor(forwardedHost);
}
