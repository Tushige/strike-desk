import { describe, expect, it } from 'vitest';
import { exactExp, exactLn, normCdf, normPdf } from '../src/exact';

function relativeError(actual: number, expected: number): number {
  return Math.abs(actual - expected) / Math.abs(expected);
}

describe('exactExp', () => {
  const known: [number, number][] = [
    [1, 2.718281828459045],
    [-1, 0.36787944117144233],
    [0.5, 1.6487212707001282],
    [10, 22026.465794806718],
    [-10, 0.00004539992976248485],
    [0.001, 1.0010005001667084],
    [100, 2.6881171418161356e43],
  ];

  it.each(known)('exp(%f) matches the known value', (x, expected) => {
    expect(relativeError(exactExp(x), expected)).toBeLessThan(1e-12);
  });

  it('is exactly 1 at zero', () => {
    expect(exactExp(0)).toBe(1);
  });

  it('handles the edges', () => {
    expect(exactExp(NaN)).toBeNaN();
    expect(exactExp(710)).toBe(Infinity);
    expect(exactExp(Infinity)).toBe(Infinity);
    expect(exactExp(-746)).toBe(0);
    expect(exactExp(-Infinity)).toBe(0);
    expect(exactExp(700)).toBeGreaterThan(1e303);
    expect(Number.isFinite(exactExp(709))).toBe(true);
    expect(exactExp(-700)).toBeGreaterThan(0);
  });
});

describe('exactLn', () => {
  const known: [number, number][] = [
    [2, 0.6931471805599453],
    [10, 2.302585092994046],
    [0.5, -0.6931471805599453],
    [2.718281828459045, 1],
    [1e-10, -23.025850929940457],
    [1e100, 230.25850929940458],
    [1.0001, 0.00009999500033330834],
  ];

  it.each(known)('ln(%f) matches the known value', (x, expected) => {
    expect(relativeError(exactLn(x), expected)).toBeLessThan(1e-12);
  });

  it('is exactly 0 at one', () => {
    expect(exactLn(1)).toBe(0);
  });

  it('handles the edges', () => {
    expect(exactLn(0)).toBe(-Infinity);
    expect(exactLn(-1)).toBeNaN();
    expect(exactLn(NaN)).toBeNaN();
    expect(exactLn(Infinity)).toBe(Infinity);
    expect(relativeError(exactLn(Number.MAX_VALUE), 709.782712893384)).toBeLessThan(1e-12);
    expect(relativeError(exactLn(Number.MIN_VALUE), -744.4400719213812)).toBeLessThan(1e-12);
  });

  it('round-trips through exp', () => {
    for (const x of [1e-6, 0.03, 0.9, 1, 1.5, 28, 150, 12345.678, 1e9]) {
      expect(relativeError(exactExp(exactLn(x)), x)).toBeLessThan(1e-12);
    }
    for (const x of [-20, -1.5, -0.001, 0.25, 3, 40]) {
      expect(Math.abs(exactLn(exactExp(x)) - x)).toBeLessThan(1e-12);
    }
  });
});

describe('normCdf', () => {
  const known: [number, number][] = [
    [0, 0.5],
    [1, 0.8413447460685429],
    [-1, 0.15865525393145707],
    [1.96, 0.9750021048517795],
    [-1.96, 0.024997895148220435],
    [2.5, 0.9937903346742238],
    [0.3, 0.6179114221889526],
    [-3, 0.0013498980316300946],
    [5, 0.9999997133484281],
  ];

  it.each(known)('cdf(%f) matches the known value', (x, expected) => {
    expect(Math.abs(normCdf(x) - expected)).toBeLessThan(1e-7);
  });

  it('is symmetric, monotonic and stays inside [0, 1]', () => {
    let previous = 0;
    for (let x = -8; x <= 8; x += 0.25) {
      const value = normCdf(x);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
      expect(value).toBeGreaterThanOrEqual(previous);
      expect(normCdf(x) + normCdf(-x)).toBeCloseTo(1, 8);
      previous = value;
    }
  });

  it('handles the edges', () => {
    expect(normCdf(NaN)).toBeNaN();
    expect(normCdf(1000)).toBe(1);
    expect(normCdf(-1000)).toBe(0);
    expect(normCdf(Infinity)).toBe(1);
    expect(normCdf(-Infinity)).toBe(0);
  });
});

describe('normPdf', () => {
  it('matches the known peak and one-sigma values', () => {
    expect(normPdf(0)).toBeCloseTo(0.3989422804014327, 15);
    expect(normPdf(1)).toBeCloseTo(0.24197072451914337, 12);
    expect(normPdf(-1)).toBe(normPdf(1));
  });
});
