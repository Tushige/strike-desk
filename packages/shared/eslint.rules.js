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

export const sharedFenceRules = {
  '@typescript-eslint/no-explicit-any': 'error',
  'no-restricted-properties': [
    'error',
    ...restrictedMathProperties,
    {
      object: 'Date',
      property: 'now',
      message: 'Date.now() differs between machines and between runs, which breaks exact replay. Pass "now" in as an argument instead.',
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
  ],
};
