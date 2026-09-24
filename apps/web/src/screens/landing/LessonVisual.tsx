import { ArrowUp, CompanyTile, LogoMark } from '../ui';

export function LessonVisual({ step }: { step: number }) {
  return (
    <div
      className="contrast-example flex min-h-112 flex-col self-stretch bg-landing-accent p-6 text-landing-bg animate-example-arrive md:min-h-120 md:p-6.5 wide:px-9 wide:py-7.5"
      key={step}
    >
      <div className="contrast-example-top mb-12 flex items-center justify-between gap-3 text-2xs [&_.brand-mark]:size-7.5 [&_.brand-mark]:rounded [&_.brand-mark]:bg-landing-bg [&_.brand-mark]:p-0.75">
        <LogoMark />
      </div>
      {step === 0 ? (
        <>
          <div className="contrast-news-company mb-5.5 flex items-center gap-2.5 text-xs [&>span:first-child]:size-7.5 [&>span:first-child]:rounded [&_svg]:size-5.5">
            <CompanyTile companyId={0} size="md" />
            <span>RoboPup / Robot pets</span>
          </div>
          <h3 className="mb-6 font-brand text-example-heading leading-[1.15] font-bold tracking-tight">
            A new trick.
            <br />A big reaction?
          </h3>
          <p className="mb-7 max-w-prose-short text-sm leading-relaxed">
            Rumor has it RoboPup’s next robot can fetch your slippers.
          </p>
          <div className="contrast-example-bottom mt-auto flex flex-wrap justify-between gap-3 border-t border-dashed border-landing-bg/45 pt-6 text-xs [&>strong]:font-semibold">
            <span>Wild rumor</span>
            <strong>Believe it?</strong>
          </div>
        </>
      ) : step === 1 ? (
        <>
          <h3 className="mb-6 font-brand text-example-heading leading-[1.15] font-bold tracking-tight">
            Pick a direction.
            <br />
            Set your target.
          </h3>
          <div className="contrast-directions mt-1.5 mb-5.5 flex gap-3 [&>span]:flex [&>span]:items-center [&>span]:gap-6 [&>span]:border [&>span]:border-landing-bg [&>span]:p-3.5 [&>span]:text-sm [&_svg]:size-6 [&>span:last-child_svg]:rotate-90">
            <span>
              UP <ArrowUp />
            </span>
            <span>
              DOWN <ArrowUp />
            </span>
          </div>
          <p className="mb-7 max-w-prose-short text-sm leading-relaxed">
            You’re choosing where the price needs to finish. The ticket costs money either way.
          </p>
          <div className="contrast-example-bottom mt-auto flex flex-wrap justify-between gap-3 border-t border-dashed border-landing-bg/45 pt-6 text-xs [&>strong]:font-semibold">
            <span>Your other option</span>
            <strong>Sit this one out.</strong>
          </div>
        </>
      ) : (
        <>
          <h3 className="mb-6 font-brand text-example-heading leading-[1.15] font-bold tracking-tight">
            A payout isn’t
            <br />
            always a profit.
          </h3>
          <dl className="contrast-math mb-7.5 [&>div]:flex [&>div]:justify-between [&>div]:py-2 [&>div]:text-sm [&_dd]:tabular-nums [&>div:last-child]:mt-2 [&>div:last-child]:border-t [&>div:last-child]:border-landing-bg [&>div:last-child]:pt-3.5 [&>div:last-child]:font-semibold">
            <div>
              <dt>Ticket payout</dt>
              <dd>$200</dd>
            </div>
            <div>
              <dt>Ticket cost</dt>
              <dd>−$300</dd>
            </div>
            <div>
              <dt>Your result</dt>
              <dd>−$100</dd>
            </div>
          </dl>
          <div className="contrast-example-bottom mt-auto flex flex-wrap justify-between gap-3 border-t border-dashed border-landing-bg/45 pt-6 text-xs [&>strong]:font-semibold">
            <span>The lesson</span>
            <strong>Count the cost.</strong>
          </div>
        </>
      )}
    </div>
  );
}
