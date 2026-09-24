const FACTS = [
  ['Pretend starting cash', '$1M'],
  ['Trading days', '05'],
  ['Fictional companies', '06'],
  ['Minutes to play', '2–15'],
] as const;

export function GameFacts() {
  return (
    <div className="border-t border-landing-bg/30">
      <dl className="page-width grid grid-cols-2 gap-y-6 py-6 md:grid-cols-4">
        {FACTS.map(([label, value], index) => (
          <div
            key={label}
            className={`flex flex-col-reverse gap-1 border-landing-bg/30 ${index === 0 ? '' : index === 2 ? 'md:border-l md:pl-8' : 'border-l pl-5 md:pl-8'}`}
          >
            <dt className="text-2xs md:text-xs">{label}</dt>
            <dd className="font-brand text-3xl font-semibold tracking-tight tabular-nums">
              {value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
