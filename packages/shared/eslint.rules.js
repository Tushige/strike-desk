// The fence rule block applied only to packages/shared/src/**/*.ts, and the
// banned Math member list it is built from. Kept in one file so the list of
// banned members has exactly one home (packages/shared/test/lint-fences.test.ts
// imports bannedMathMembers directly to build its probes).

/**
 * Math members whose results are implementation-approximated (ECMA-262 does
 * not require a single correctly-rounded answer across engines/machines),
 * plus Math.random, which is non-deterministic by design. Any of these
 * inside packages/shared would break bit-for-bit replay.
 */
export const bannedMathMembers = [
  'exp', 'expm1', 'log', 'log2', 'log10', 'log1p', 'pow',
  'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2',
  'sinh', 'cosh', 'tanh', 'asinh', 'acosh', 'atanh',
  'cbrt', 'hypot', 'random',
];

const restrictedMathProperties = bannedMathMembers.map((property) => ({
  object: 'Math',
  property,
  message: `Math.${property} is implementation-approximated: its result can differ between machines, which breaks exact replay. Pass the exact value in, or use an exact alternative.`,
}));

/**
 * A clock, a locale and a random source all answer differently depending on
 * when and where they are asked, so none of them may be read inside shared:
 * the same market identity has to give the same numbers on every machine and
 * on every run. Every one of them has the same remedy — take the value as an
 * argument — so the messages say so in the same words.
 */
const PASS_IT_IN = 'differs between machines and between runs, which breaks exact replay. Pass the value in as an argument instead.';

export const sharedFenceRules = {
  '@typescript-eslint/no-explicit-any': 'error',
  'no-restricted-globals': [
    'error',
    { name: 'performance', message: `performance ${PASS_IT_IN}` },
    {
      name: 'crypto',
      message: `crypto ${PASS_IT_IN} A seed is drawn once, on the server, and reaches shared as a number.`,
    },
  ],
  'no-restricted-properties': [
    'error',
    ...restrictedMathProperties,
    {
      object: 'Date',
      property: 'now',
      message: `Date.now() ${PASS_IT_IN}`,
    },
    {
      object: 'Date',
      property: 'parse',
      message: `Date.parse() reads a clock-shaped value whose meaning ${PASS_IT_IN}`,
    },
  ],
  'no-restricted-syntax': [
    'error',
    {
      selector: "BinaryExpression[operator='**']",
      message: 'The ** operator is implementation-approximated: its result can differ between machines, which breaks exact replay. Use an exact alternative.',
    },
    {
      selector: "AssignmentExpression[operator='**=']",
      message: 'The **= operator is implementation-approximated: its result can differ between machines, which breaks exact replay. Use an exact alternative.',
    },
    {
      selector: "NewExpression[callee.name='Date']",
      message: `A constructed Date carries the moment it was made, which ${PASS_IT_IN}`,
    },
    {
      selector: "CallExpression[callee.type='MemberExpression'][callee.property.name='toLocaleString']",
      message: `toLocaleString() formats by the machine's locale and time zone, which ${PASS_IT_IN}`,
    },
  ],
};
