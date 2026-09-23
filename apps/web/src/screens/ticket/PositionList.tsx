import type { Frame, PositionView } from '@strike-desk/shared/protocol';
import { money, price, signedMoney } from '../format';

export function PositionList({ frame, positions, selectedId, onSelect, disabled = false }: {
  frame: Frame;
  positions: readonly PositionView[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  disabled?: boolean;
}) {
  return <div className="purchase-list" role="group" aria-label="Purchases">
    {positions.map((position, index) => {
      const company = frame.companies[position.companyId];
      const status = position.status === 'open' ? 'Open' : position.status === 'cashedOut' ? 'Cashed out' : 'Settled';
      return <button key={position.id} type="button" className="purchase-row" disabled={disabled}
        aria-pressed={selectedId === position.id}
        aria-label={`Inspect purchase ${String(index + 1)}, ${company?.name ?? ''} ${position.side.toUpperCase()}, ${status.toLowerCase()}`}
        onClick={() => { onSelect(position.id); }}>
        <strong>{company?.ticker} <span className={position.side === 'up' ? 'text-mint' : 'text-coral'}>{position.side.toUpperCase()}</span> · {price(position.targetCents)}</strong>
        <strong className="purchase-number">{money(position.exit?.proceedsCents ?? position.valueCents)}</strong>
        <span>Purchase {index + 1} · {status}</span>
        <span className={`purchase-number ${position.profitCents < 0 ? 'text-coral' : position.profitCents > 0 ? 'text-mint' : ''}`}>{signedMoney(position.profitCents)}</span>
      </button>;
    })}
  </div>;
}
