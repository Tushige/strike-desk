import { expect, it } from 'vitest';
import { digitTravel, formatStudyNumber } from '../src/scratch/numberMotion';

it('carries digit wheels together at 999 → 1,000 in either direction', () => {
  for (const place of [1, 10, 100, 1000]) {
    expect(digitTravel(999, 1000, place)).toEqual(place === 1000 ? { start: 0, end: 1 } : { start: 9, end: 10 });
    expect(digitTravel(1000, 999, place)).toEqual(place === 1000 ? { start: 1, end: 0 } : { start: 10, end: 9 });
  }
  expect(digitTravel(100, 100, 1)).toEqual({ start: 0, end: 0 });
  expect(digitTravel(0, 100, 1)).toEqual({ start: 0, end: 10 });
});

it('keeps decimal places and units consistent as values change', () => {
  const spec = { value: 1000, decimals: 2, prefix: '+$', suffix: 'M' };
  expect(formatStudyNumber(999, spec)).toBe('+$9.99M');
  expect(formatStudyNumber(1000, spec)).toBe('+$10.00M');
  expect(formatStudyNumber(1000, { ...spec, decimals: 0, prefix: '', suffix: '' })).toBe('1,000');
});
