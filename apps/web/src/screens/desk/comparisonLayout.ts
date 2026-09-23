/** Shared metrics/copy keep the pending and loaded table footprints aligned. */
export const COMPARISON_CHIP = 'flex h-8 items-center gap-1.5 rounded-lg border-2 px-2 text-[12px] font-semibold';
export function comparisonIntro(stress: boolean) {
  return `Price, real and hope value are per ticket.${stress ? ' Read-only workload; complete scenarios refresh about every 1.5 seconds.' : ' Cost / max loss uses your current budget.'} Scroll inside the table for more columns.`;
}
