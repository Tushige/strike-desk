import { describe, expect, it } from 'vitest';
import { parseLandingStats, statNumber } from '../src/screens/landing/publicStats';

describe('landing statistics', () => {
  it('formats profit cents without including an opening balance or losing integer precision', () => {
    expect(statNumber('140000000', true)).toEqual({ compact: '+$1.4M', exact: '+$1,400,000.00' });
    expect(statNumber('501728953729911', true)).toEqual({ compact: '+$5.02T', exact: '+$5,017,289,537,299.11' });
    expect(statNumber('999999999999999999', true).exact).toBe('+$9,999,999,999,999,999.99');
    expect(statNumber('-1857500', true).compact).toBe('−$18.6K');
    expect(statNumber('0', true).compact).toBe('$0');
    expect(statNumber('24186').compact).toBe('24,186');
  });
  it('requires the server net-profit field instead of treating a final balance as profit', () => {
    const stats = { currency: 'pretend-USD', completedGames: '1', pretendProfitsEarnedCents: '140000000', bestNetProfitCents: '140000000', bestFinalBalanceCents: '240000000' };
    expect(parseLandingStats(stats).bestNetProfitCents).toBe('140000000');
    expect(() => parseLandingStats({ ...stats, bestNetProfitCents: undefined })).toThrow();
    expect(() => parseLandingStats({ ...stats, pretendProfitsEarnedCents: 'NaN' })).toThrow();
    expect(parseLandingStats({ ...stats, bestNetProfitCents: null }).bestNetProfitCents).toBeNull();
  });
});
