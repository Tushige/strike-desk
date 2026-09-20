import { formatCents } from '@strike-desk/shared/money';
import type { CompanyView } from '@strike-desk/shared/protocol';
import { ContractBoard } from './board/ContractBoard';
import { VERSION } from './generated/version';
import { useCompanies, usePrice } from './store/hooks';

/**
 * One row per company, each subscribed to its own price, and the contract
 * table below them. The root subscribes to the names, which arrive once and
 * then stay still, so a new share price redraws one cell and nothing else.
 * The table takes its moving prices straight from the store. No frame ever
 * enters React state.
 */

/** Shown until the first frame arrives. */
const NO_PRICE = '—';

function PriceRow({ companyId, company }: { companyId: number; company: CompanyView }) {
  const price = usePrice(companyId);
  return (
    <tr>
      <th scope="row">
        {company.name} <span className="ticker">{company.ticker}</span>
      </th>
      <td className="price">{price === null ? NO_PRICE : formatCents(price)}</td>
    </tr>
  );
}

export default function App() {
  const companies = useCompanies();
  return (
    <main>
      <h1>Strike Desk</h1>
      <table>
        <tbody>
          {companies.map((company, companyId) => (
            <PriceRow key={companyId} companyId={companyId} company={company} />
          ))}
        </tbody>
      </table>
      <div className="board">
        <ContractBoard />
      </div>
      <p className="build-stamp">
        build {VERSION.commit} · {VERSION.buildTime}
      </p>
    </main>
  );
}
