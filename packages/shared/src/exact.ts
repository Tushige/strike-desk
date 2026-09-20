/**
 * Exact maths: exp, ln and the normal curve built from + - * / and square
 * root only. IEEE 754 requires those five to be correctly rounded, so every
 * result here is the same bit pattern on any machine. Math.exp and friends
 * carry no such promise, which is why the lint fence bans them in `shared`.
 */

const LN2 = 0.6931471805599453;
const SQRT2 = 1.4142135623730951;
const SQRT1_2 = 0.7071067811865476;
const INV_SQRT_2PI = 0.3989422804014327;

function scaleByPowerOfTwo(value: number, power: number): number {
  let result = value;
  for (let i = 0; i < power; i += 1) result *= 2;
  for (let i = 0; i > power; i -= 1) result *= 0.5;
  return result;
}

export function exactExp(x: number): number {
  if (x !== x) return NaN;
  if (x > 709) return Infinity;
  if (x < -745) return 0;
  // x = k ln2 + r with |r| <= ln2 / 2, so the series below converges fast.
  const k = Math.round(x / LN2);
  const r = x - k * LN2;
  let term = 1;
  let sum = 1;
  for (let i = 1; i <= 20; i += 1) {
    term = (term * r) / i;
    sum += term;
  }
  return scaleByPowerOfTwo(sum, k);
}

export function exactLn(x: number): number {
  if (x !== x || x < 0) return NaN;
  if (x === 0) return -Infinity;
  if (x === Infinity) return Infinity;
  // x = m 2^e with m in [sqrt(1/2), sqrt(2)); halving and doubling are exact.
  let m = x;
  let e = 0;
  while (m >= SQRT2) {
    m *= 0.5;
    e += 1;
  }
  while (m < SQRT1_2) {
    m *= 2;
    e -= 1;
  }
  // ln(m) = 2 atanh(z), z = (m - 1) / (m + 1), |z| < 0.172.
  const z = (m - 1) / (m + 1);
  const z2 = z * z;
  let power = z;
  let sum = z;
  for (let i = 1; i <= 14; i += 1) {
    power *= z2;
    sum += power / (2 * i + 1);
  }
  return 2 * sum + e * LN2;
}

export function normPdf(x: number): number {
  return INV_SQRT_2PI * exactExp(-0.5 * x * x);
}

/**
 * Standard normal cumulative distribution (Abramowitz and Stegun 26.2.17,
 * absolute error under 7.5e-8). Far below what a whole-dollar ticket price
 * can show.
 */
export function normCdf(x: number): number {
  if (x !== x) return NaN;
  if (x < 0) return 1 - normCdf(-x);
  if (x > 40) return 1;
  const t = 1 / (1 + 0.2316419 * x);
  const poly =
    t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return 1 - normPdf(x) * poly;
}
