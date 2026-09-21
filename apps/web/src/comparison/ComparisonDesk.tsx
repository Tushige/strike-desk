import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import { contractId, decodeContractId, draftMessageSchema } from '@strike-desk/shared/protocol';
import { ContractBoard } from '../board/ContractBoard';
import { OrderTicket } from '../modules/order-ticket/index';
import type { SimpleChoice, TicketContract } from '../modules/order-ticket/index';
import type { GameStore } from '../store/gameStore';
import type { ComparisonOverview, ComparisonStore } from './comparisonStore';

interface DeskProps { comparison: ComparisonStore; game: GameStore }

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

function DayComparison({ comparison, game, overview }: DeskProps & { overview: ComparisonOverview }) {
  const subscribeRows = useCallback((listener: () => void) => game.boardRows.subscribe(listener), [game]);
  const readRows = useCallback(() => game.boardRows.get(), [game]);
  const rows = useSyncExternalStore(subscribeRows, readRows);
  const byId = useMemo(() => new Map(rows.map((row) => [row.contractId, row])), [rows]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [spendText, setSpendText] = useState('');
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
    if (selectedId === null || board === null) return [];
    const { companyId } = decodeContractId(board.targetsPerCompany, selectedId);
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
  }, [selectedId, overview.board]);
  const onPick = useCallback((id: number) => {
    if (!byId.has(id)) return;
    comparison.setRequestedDraft({ contractId: id, spendCents });
    setSelectedId(id);
  }, [byId, comparison, spendCents]);
  const onSelect = useCallback((id: string) => { onPick(Number(id)); }, [onPick]);
  const onSpendChange = (text: string): void => {
    comparison.setRequestedDraft({ contractId: selectedId, spendCents: spendFromText(text) });
    setSpendText(text);
  };

  return <div className="grid h-full min-h-0 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] gap-3 lg:grid-cols-[minmax(0,1fr)_22rem] lg:grid-rows-[minmax(0,1fr)]">
    <div className="board"><ContractBoard selectedId={selectedId === null ? null : String(selectedId)} onSelect={onSelect} /></div>
    <div className="min-h-0 overflow-y-auto">
      <OrderTicket mode="preview" day={overview.day} contract={contract} choices={choices} onPick={onPick}
        quote={comparison.quote} account={comparison.account} line={overview.status === 'live' ? 'live' : 'offline'}
        onDraftChange={comparison.sendDraft} spendEditor={{ value: spendText, spendCents,
          error: spendText === '' || spendCents !== null ? null : 'Enter an amount in dollars and cents.', onChange: onSpendChange }} />
    </div>
  </div>;
}

export function ComparisonDesk({ comparison, game }: DeskProps) {
  const overview = useSyncExternalStore(comparison.overview.subscribe, comparison.overview.get);
  return <DayComparison key={`${overview.session ?? ''}:${String(overview.day)}`} comparison={comparison} game={game} overview={overview} />;
}
