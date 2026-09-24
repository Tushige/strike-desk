export interface LandingStats {
  completedGames: string;
  pretendProfitsEarnedCents: string;
  bestNetProfitCents: string | null;
}

export function parseLandingStats(value: unknown): LandingStats {
  if (!value || typeof value !== 'object') throw new Error('Invalid statistics');
  const row = value as Record<string, unknown>;
  const unsigned = (input: unknown): input is string =>
    typeof input === 'string' && /^\d{1,40}$/.test(input);
  const signed = (input: unknown): input is string =>
    typeof input === 'string' && /^-?\d{1,40}$/.test(input);
  if (
    row.currency !== 'pretend-USD' ||
    !unsigned(row.completedGames) ||
    !unsigned(row.pretendProfitsEarnedCents) ||
    !(row.bestNetProfitCents === null || signed(row.bestNetProfitCents))
  )
    throw new Error('Invalid statistics');
  return {
    completedGames: row.completedGames,
    pretendProfitsEarnedCents: row.pretendProfitsEarnedCents,
    bestNetProfitCents: row.bestNetProfitCents,
  };
}

const grouped = new Intl.NumberFormat('en-US');
const UNITS = [
  [1_000_000_000_000_000n, 'Q'],
  [1_000_000_000_000n, 'T'],
  [1_000_000_000n, 'B'],
  [1_000_000n, 'M'],
  [1_000n, 'K'],
] as const;

/** BigInt all the way: neither a five-trillion total nor cents can silently round. */
export function statNumber(value: string, money = false): { compact: string; exact: string } {
  const amount = BigInt(value);
  const absolute = amount < 0n ? -amount : amount;
  const scale = money ? 100n : 1n;
  const prefix = `${amount < 0n ? '−' : money && amount > 0n ? '+' : ''}${money ? '$' : ''}`;
  const cents = absolute % scale;
  const exact = `${prefix}${grouped.format(absolute / scale)}${money ? `.${cents.toString().padStart(2, '0')}` : ''}`;
  // Keep ordinary game counts fully written; compact only at a million games.
  for (const [unit, suffix] of UNITS) {
    if (!money && unit < 1_000_000n) continue;
    if (absolute < unit * scale) continue;
    const decimals = absolute >= unit * scale * 10n ? 10n : 100n;
    const rounded = (absolute * decimals + (unit * scale) / 2n) / (unit * scale);
    const fraction = (rounded % decimals)
      .toString()
      .padStart(decimals === 10n ? 1 : 2, '0')
      .replace(/0+$/, '');
    return {
      compact: `${prefix}${rounded / decimals}${fraction ? `.${fraction}` : ''}${suffix}`,
      exact,
    };
  }
  return {
    compact: `${prefix}${grouped.format(absolute / scale)}${cents ? `.${cents.toString().padStart(2, '0')}` : ''}`,
    exact,
  };
}
