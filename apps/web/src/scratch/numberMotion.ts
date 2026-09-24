export interface NumberSpec { value: number; decimals: number; prefix: string; suffix: string }

export function formatStudyNumber(value: number, spec: NumberSpec): string {
  return spec.prefix + (Math.round(value) / 10 ** spec.decimals).toLocaleString('en-US', {
    minimumFractionDigits: spec.decimals, maximumFractionDigits: spec.decimals,
  }) + spec.suffix;
}

/** Pick continuous strip positions, including 9→0 carries and reverse rolls. */
export function digitTravel(from: number, to: number, place: number): { start: number; end: number } {
  const fromPlace = Math.floor(from / place);
  const toPlace = Math.floor(to / place);
  let start = fromPlace % 10;
  let end = toPlace % 10;
  if (toPlace > fromPlace && end <= start) end += 10;
  if (toPlace < fromPlace && end >= start) start += 10;
  return { start, end };
}
