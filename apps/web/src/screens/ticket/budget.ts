/** Editing dollars never silently rounds, clamps, or leaves a previous quote actionable. */
export function parseBudget(text: string, capCents: number): { cents: number | null; error: string | null } {
  if (text === '') return { cents: null, error: 'Enter a positive whole-dollar amount.' };
  if (!/^\d+$/.test(text)) return { cents: null, error: 'Use positive whole dollars, without decimals.' };
  const cents = Number(text) * 100;
  if (!Number.isSafeInteger(cents) || cents <= 0) return { cents: null, error: 'Enter a positive, safe whole-dollar amount.' };
  if (cents > capCents) return { cents: null, error: 'The daily limit is half your available cash.' };
  return { cents, error: null };
}
