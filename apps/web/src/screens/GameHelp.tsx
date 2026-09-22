import { useId, useRef } from 'react';

/** Native modal handles focus trapping, Escape and return to the opener. */
export function GameHelp({ engineering = false, ticket = false }: { engineering?: boolean; ticket?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const title = useId();
  return <>
    <button ref={opener} type="button" className="text-left text-sm text-muted underline decoration-line underline-offset-4 hover:text-cloud"
      onClick={() => { dialog.current?.showModal(); }}>{engineering ? 'Under the hood' : ticket ? 'How it works' : 'How to play'}</button>
    <dialog ref={dialog} aria-labelledby={title} onClose={() => { opener.current?.focus(); }} className="help-dialog">
      <div className="flex items-center justify-between gap-4"><h2 id={title} className="font-display text-xl font-bold">{engineering ? 'Under the hood' : 'How to play'}</h2>
        <button type="button" autoFocus className="rounded-lg border border-line px-3 py-2" onClick={() => { dialog.current?.close(); }}>Close</button></div>
      {engineering ? <div className="space-y-4 text-sm leading-relaxed">
        <p>Node owns the clock, quotes, whole-ticket quantities and integer-cent money. React submits intent through shared TypeScript schemas. Receipts make retries use the same command ID, so they cannot debit twice.</p>
        <p>A seed replays the same fictional market. New games get new seeds. The browser receives observed prices and public news; future paths and hidden news outcomes stay on the server until their day is complete.</p>
        <p>External stores isolate subscriptions. The comparison board loads on demand and uses virtualized rows with batched quote updates and stable sorting during interaction.</p>
        <p>Optional tab storage recovers unanswered trades after refresh. Only recent eligible requests retry automatically; older requests wait for a safe retry. Games live in server memory for up to 30 minutes disconnected. Restarting or redeploying loses them.</p>
        <a className="inline-block rounded-xl bg-sun px-4 py-3 font-semibold text-ink" href="/?board=2500&dev" target="_blank" rel="noopener noreferrer">Open the 2,508-contract workload ↗</a>
        <p>This separate tab is read-only. Streaming prices remain live; complete quote scenarios normally refresh about every 1.5 seconds. The grid hides budget-dependent costs. Its delay metric is receipt-to-visible-cell observation, excluding network latency; it is not physical paint time.</p>
      </div> : <div className="space-y-4 text-sm leading-relaxed">
        <p>Start with $1,000,000 of pretend money. Play five days. Buy at most once a day, spend at most half your cash, and buy only whole tickets. Sitting out is a valid choice.</p>
        <p><strong>UP (call)</strong> pays at the bell above your <strong>target (strike)</strong>. DOWN (put) pays below it. Profit starts past <strong>break-even</strong>, after covering the <strong>price (premium)</strong> you paid.</p>
        <p><strong>Real (intrinsic) value</strong> is what the ticket pays if it expires at the current share price. <strong>Hope (time) value</strong> is the rest of its price. Hope expires at the bell; it can rise or fall before then.</p>
        <p><strong>Illustrative example:</strong> one UP ticket represents 100 shares. A $100 target and $300 ticket cost give a $103 break-even. A $102 close pays $200: a $100 loss. A $104 close pays $400: a $100 gain.</p>
        <p>Cash out during trading or hold until the bell. A true headline can still lose money: target distance, premium and exit timing all matter. The what-if slider is a scenario, not a forecast.</p>
      </div>}
    </dialog>
  </>;
}
