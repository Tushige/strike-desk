import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import { contractId, decodeContractId, draftMessageSchema } from '@strike-desk/shared/protocol';
import { ContractBoard } from '../board/ContractBoard';
import { OrderTicket } from '../modules/order-ticket/index';
import type { ReadSlice, SimpleChoice, TicketContract } from '../modules/order-ticket/index';
import type { BuyAvailability, BuyFlow } from '../gameplay/buyFlow';
import type { GameStore } from '../store/gameStore';
import type { ContractRow } from '../store/contractRows';
import type { ComparisonOverview, ComparisonStore } from './comparisonStore';
import { deskFreshness } from '../boot';
import type { DeskFreshness } from './freshness';

interface DeskProps {
  comparison: ComparisonStore;
  game: GameStore;
  freshness?: DeskFreshness;
  /** A new request filters the table without replacing the pinned ticket. */
  companyFocus?: { readonly companyId: number } | null;
  onContractCompany?: (companyId: number) => void;
  viewedCompanyId?: number;
  comparisonExpanded?: boolean;
  comparisonId?: string;
  buy?: BuyFlow;
}

/** Representation conversion only. All ticket amounts remain the server's. */
function spendFromText(text: string): number | null {
  const match = /^(?:\d+(?:\.\d{0,2})?|\.\d{1,2})$/.exec(text);
  if (match?.[0] !== text || text === '') return null;
  const [whole = '', fraction = ''] = text.split('.');
  const cents = Number(`${whole}${fraction.padEnd(2, '0')}`);
  if (!Number.isSafeInteger(cents)) return null;
  const result = draftMessageSchema.safeParse({ t: 'draft', contractId: null, spendCents: cents });
  return result.success ? result.data.spendCents : null;
}

const CHOICES = ['close', 'far', 'moonshot'] as const;
const SELECT = 'min-w-0 rounded-sm border border-border bg-card px-2 py-1 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-ring';
const NO_BUY: ReadSlice<BuyAvailability | null> = { get: () => null, subscribe: () => () => {} };
const newCommandId = (): string => crypto.randomUUID();

function FreshnessNotice({ freshness }: { freshness: DeskFreshness }) {
  const { waiting, ageSeconds } = useSyncExternalStore(freshness.subscribe, freshness.get);
  return <div id="comparison-freshness" className="shrink-0 text-sm text-muted-foreground">
    <span role="status" aria-live="polite">{waiting ? 'Waiting for new prices' : ''}</span>
    {waiting && ageSeconds !== null ? <span className="ml-2">Last update: {ageSeconds} seconds ago</span> : null}
  </div>;
}

function DayComparison({ comparison, game, overview, companyFocus, onContractCompany, freshness = deskFreshness,
  viewedCompanyId, comparisonExpanded = true, comparisonId, buy }: DeskProps & { overview: ComparisonOverview }) {
  const readLine = useCallback(() => freshness.get().line, [freshness]);
  const line = useSyncExternalStore(freshness.subscribe, readLine);
  const availabilitySlice = buy?.availability ?? NO_BUY;
  const availability = useSyncExternalStore(availabilitySlice.subscribe, availabilitySlice.get);
  const buyActions = useMemo(() => buy === undefined ? null : { submit: buy.submit.bind(buy), retry: buy.retry.bind(buy),
    cashOut: { position: buy.cashOutPosition, submit: buy.submitCashOut.bind(buy) } }, [buy]);
  const subscribeRows = useCallback((listener: () => void) => game.boardRows.subscribe(listener), [game]);
  const readRows = useCallback(() => game.boardRows.get(), [game]);
  const rows = useSyncExternalStore(subscribeRows, readRows);
  const byId = useMemo(() => new Map(rows.map((row) => [row.contractId, row])), [rows]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [spendText, setSpendText] = useState('');
  const [companyFilter, setCompanyFilter] = useState('');
  const [heldFocus, setHeldFocus] = useState(companyFocus);
  if (heldFocus !== companyFocus) {
    setHeldFocus(companyFocus);
    if (companyFocus != null) setCompanyFilter(String(companyFocus.companyId));
  }
  const [sideFilter, setSideFilter] = useState('');
  const [affordable, setAffordable] = useState(false);
  const { cashCents, capCents, minTicketCents } = useSyncExternalStore(comparison.account.subscribe, comparison.account.get);
  const filter = useMemo(() => {
    if (companyFilter === '' && sideFilter === '' && !affordable) return null;
    return (row: ContractRow): boolean => {
      if (companyFilter !== '' && row.companyId !== Number(companyFilter)) return false;
      if (sideFilter !== '' && row.side !== sideFilter) return false;
      if (!affordable) return true;
      const board = overview.board;
      if (board === null || (overview.phase !== 'preBell' && overview.phase !== 'open')) return false;
      const ref = decodeContractId(board.targetsPerCompany, row.contractId);
      const company = board.companies[row.companyId];
      if (company === undefined) return false;
      const offered = row.side === 'up' ? ref.targetIndex >= company.lowestUpIndex : ref.targetIndex <= company.highestDownIndex;
      return offered && row.priceCents >= minTicketCents && row.priceCents <= cashCents && row.priceCents <= capCents;
    };
  }, [companyFilter, sideFilter, affordable, overview.board, overview.phase, cashCents, capCents, minTicketCents]);
  const spendCents = spendFromText(spendText);
  const contract = useMemo<TicketContract | null>(() => {
    const row = selectedId === null ? undefined : byId.get(selectedId);
    const board = overview.board;
    if (row === undefined || board === null) return null;
    const ref = decodeContractId(board.targetsPerCompany, row.contractId);
    const company = board.companies[ref.companyId];
    if (company === undefined) return null;
    return { contractId: row.contractId, companyName: row.company, ticker: row.ticker, side: row.side, targetCents: row.targetCents,
      offered: ref.side === 'up' ? ref.targetIndex >= company.lowestUpIndex : ref.targetIndex <= company.highestDownIndex };
  }, [selectedId, byId, overview.board]);
  const choices = useMemo<readonly SimpleChoice[]>(() => {
    const board = overview.board;
    if (board === null || (viewedCompanyId === undefined && selectedId === null)) return [];
    const companyId = viewedCompanyId ?? decodeContractId(board.targetsPerCompany, selectedId!).companyId;
    const company = board.companies[companyId];
    if (company === undefined) return [];
    const result: SimpleChoice[] = [];
    for (const side of ['up', 'down'] as const) {
      const indices = side === 'up' ? company.simpleUp : company.simpleDown;
      CHOICES.forEach((choice, index) => {
        const targetIndex = indices[index];
        const targetCents = targetIndex === undefined ? undefined : company.targets[targetIndex];
        if (targetIndex !== undefined && targetCents !== undefined) result.push({ choice, side, targetCents, contractId: contractId(board.targetsPerCompany, { companyId, targetIndex, side }) });
      });
    }
    return result;
  }, [selectedId, overview.board, viewedCompanyId]);
  const isHighlighted = useMemo(() => {
    const side = contract?.side;
    const ids = new Set(choices.filter((choice) => choice.side === side).map((choice) => choice.contractId));
    return (row: ContractRow): boolean => ids.has(row.contractId);
  }, [choices, contract?.side]);
  const onPick = useCallback((id: number) => {
    if (!byId.has(id)) return;
    comparison.setRequestedDraft({ contractId: id, spendCents });
    setSelectedId(id);
    onContractCompany?.(byId.get(id)!.companyId);
  }, [byId, comparison, spendCents, onContractCompany]);
  const onSelect = useCallback((id: string) => { onPick(Number(id)); }, [onPick]);
  const onSpendChange = (text: string): void => {
    comparison.setRequestedDraft({ contractId: selectedId, spendCents: spendFromText(text) });
    setSpendText(text);
  };

  const ticketProps = { day: overview.day, contract, choices, onPick, staleNoticeId: 'comparison-freshness',
    quote: comparison.quote, account: comparison.account, line,
    onDraftChange: comparison.sendDraft, spendEditor: { value: spendText, spendCents,
      error: spendText === '' || spendCents !== null ? null : 'Enter an amount in dollars and cents.', onChange: onSpendChange } };
  return <div className="flex h-full min-h-0 flex-col gap-2">
    <FreshnessNotice freshness={freshness} />
    <div className={`grid min-h-0 flex-1 gap-3 overflow-y-auto overscroll-contain ${comparisonExpanded
      ? 'grid-rows-[minmax(12rem,1fr)_minmax(12rem,1fr)] sm:grid-cols-[minmax(0,1fr)_20rem] sm:grid-rows-[minmax(0,1fr)] sm:overflow-visible lg:grid-cols-[minmax(0,1fr)_22rem]'
      : 'grid-cols-1 grid-rows-[minmax(0,1fr)] sm:grid-cols-[minmax(0,1fr)_20rem] lg:grid-cols-[minmax(0,1fr)_22rem]'}`}>
    <div id={comparisonId} hidden={!comparisonExpanded} className={comparisonExpanded ? 'flex min-h-0 min-w-0 flex-col gap-2' : 'hidden'}>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">Company
          <select name="company" className={SELECT} value={companyFilter} onChange={(event) => { setCompanyFilter(event.target.value); }}>
            <option value="">All companies</option>
            {overview.companies.map((company, id) => <option key={company.ticker} value={String(id)}>{company.name}</option>)}
          </select>
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">Ticket
          <select name="ticket" className={SELECT} value={sideFilter} onChange={(event) => { setSideFilter(event.target.value); }}>
            <option value="">UP and DOWN</option><option value="up">UP</option><option value="down">DOWN</option>
          </select>
        </label>
        <label className="flex items-center gap-2 py-1 text-sm text-foreground">
          <input name="affordable" type="checkbox" checked={affordable} onChange={(event) => { setAffordable(event.target.checked); }}
            className="accent-primary focus-visible:outline-2 focus-visible:outline-ring" />Affordable for me
        </label>
      </div>
      <div className="board min-h-0 flex-1"><ContractBoard selectedId={selectedId === null ? null : String(selectedId)} onSelect={onSelect} filter={filter} isHighlighted={isHighlighted}
        stale={line !== 'live'} staleNoticeId="comparison-freshness" /></div>
    </div>
    <div className="min-h-0 overflow-y-auto sm:col-start-2">
      {buy === undefined ? <OrderTicket mode="preview" {...ticketProps} />
        : <OrderTicket mode="buy" {...ticketProps} submit={buyActions!.submit} newCommandId={newCommandId}
          cashOut={buyActions!.cashOut}
          transaction={buy.transaction} purchase={buy.purchase} retryOffered={availability?.retryAllowed ?? false} onRetry={buyActions!.retry} />}
    </div>
    </div>
  </div>;
}

export function ComparisonDesk({ comparison, game, ...props }: DeskProps) {
  const overview = useSyncExternalStore(comparison.overview.subscribe, comparison.overview.get);
  return <DayComparison key={`${overview.session ?? ''}:${String(overview.day)}`} comparison={comparison} game={game} overview={overview}
    {...props} />;
}
