import { formatCents } from '@strike-desk/shared/money';
import { VERSION } from './generated/version';
import { usePrice } from './store/hooks';

/**
 * Six rows, each one subscribed to its own price. The root subscribes to
 * nothing that changes as the market moves, so a new price redraws one
 * cell and nothing else. No frame ever enters React state.
 */

interface Listing {
  id: number;
  name: string;
  ticker: string;
}

/** Stand-in names, in company id order. */
const LISTINGS: readonly Listing[] = [
  { id: 0, name: 'RoboPup', ticker: 'RPUP' },
  { id: 1, name: 'Fizzly', ticker: 'FIZZ' },
  { id: 2, name: 'JetKicks', ticker: 'JETK' },
  { id: 3, name: 'MoonMunch', ticker: 'MUNC' },
  { id: 4, name: 'PixelPals', ticker: 'PIXL' },
  { id: 5, name: 'ZapCharge', ticker: 'ZAPP' },
];

/** Shown until the first frame arrives. */
const NO_PRICE = '—';

function PriceRow({ listing }: { listing: Listing }) {
  const price = usePrice(listing.id);
  return (
    <tr>
      <th scope="row">
        {listing.name} <span className="ticker">{listing.ticker}</span>
      </th>
      <td className="price">{price === null ? NO_PRICE : formatCents(price)}</td>
    </tr>
  );
}

export default function App() {
  return (
    <main>
      <h1>Strike Desk</h1>
      <table>
        <tbody>
          {LISTINGS.map((listing) => (
            <PriceRow key={listing.id} listing={listing} />
          ))}
        </tbody>
      </table>
      <p className="build-stamp">
        build {VERSION.commit} · {VERSION.buildTime}
      </p>
    </main>
  );
}
