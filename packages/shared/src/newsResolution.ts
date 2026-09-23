import type { Headline } from './market';

/** Curated follow-ups to the existing fictional events. No new random draws. */
export const EVENT_FOLLOW_UPS: Record<string, readonly [string, string, string, string]> = {
  'bulk-order': ['Order goes ahead', 'The buyer confirms the order, adding sales.', 'Order falls through', 'The buyer cancels the order, taking the expected sales off the table.'],
  'long-term-deal': ['Deal signed', 'The customer signs the deal, securing regular income.', 'Deal falls through', 'The customer walks away before signing, so the expected income disappears.'],
  'better-fit': ['New design wins orders', 'Customers choose the improved design and orders rise.', 'Design disappoints', 'Customer trials find the new design no easier to use. Shops pull back their extra orders.'],
  'new-release': ['Launch brings buyers', 'The new release reaches customers and brings in sales.', 'Launch stalls', 'The release is pulled back for more work, delaying the sales buyers expected.'],
  'sell-out': ['Restock orders arrive', 'Shops confirm the sell-out and place more orders.', 'Sell-out report corrected', 'Stock counts show unsold products remain. The expected restock orders do not arrive.'],
  'product-award': ['Award brings orders', 'The award is confirmed and new orders follow.', 'Award report corrected', 'The final results name another winner, removing the expected sales boost.'],
  'faster-production': ['Output rises', 'Production figures confirm more products are leaving the factory.', 'Production gains disappear', 'Quality checks send the extra output back for rework, wiping out the expected gain.'],
  'new-retail-outlet': ['New shelves open', 'The new outlet starts selling the products, adding another source of sales.', 'Retail rollout cancelled', 'The outlet cancels its rollout, removing the expected new sales.'],
  'less-waste': ['Savings show up', 'The new process reduces waste and cuts costs.', 'Savings fail to materialize', 'Replacement costs outweigh the expected savings from the new process.'],
  'returning-customers': ['Repeat sales grow', 'Sales records confirm more customers are buying again.', 'Repeat-sales figures revised', 'Corrected records show fewer repeat purchases than reported, cutting the expected sales boost.'],
  'paid-repair-service': ['Service brings income', 'Customers book the new paid service, adding income.', 'Service bookings disappoint', 'Too few customers book the new service to cover its launch costs.'],
  'popular-demonstration': ['Attention turns into sales', 'The popular demonstration brings paying customers.', 'Attention fades', 'The demonstration attracts views but few purchases. The expected sales lift disappears.'],
  'specialist-team': ['Extra team delivers', 'The specialist team clears work faster and helps fill orders.', 'Team expansion stalls', 'Hiring takes longer than planned, leaving the extra work unfinished and adding costs.'],
  'control-error': ['Fault disrupts sales', 'Checks confirm the control fault. Fixes hold up sales.', 'Fault fixed', 'A fix clears the control problem sooner than expected, removing the feared sales disruption.'],
  'supply-shortage': ['Shortage slows output', 'The missing supplies do not arrive, holding back production.', 'Replacement supplies arrive', 'A replacement shipment lets production continue, easing the shortage concerns.'],
  'repair-bill': ['Repair costs confirmed', 'The company must pay the repair bill, leaving less money from sales.', 'Repair bill covered', 'The supplier agrees to cover the repairs, removing the expected cost to the company.'],
  'delivery-disruption': ['Deliveries remain delayed', 'Orders miss their delivery window and sales are pushed back.', 'Deliveries catch up', 'A replacement delivery route gets orders to shops in time, avoiding the expected lost sales.'],
  'failed-batch-check': ['Batch needs rework', 'Follow-up checks confirm the batch must be remade before orders can ship.', 'Replacement batch clears checks', 'A replacement batch passes inspection in time to fill orders, easing delay concerns.'],
  'lost-contract': ['Customer leaves', 'The customer confirms it is ending the contract, cutting regular income.', 'Customer stays', 'The customer renews after fresh talks, preserving the income the market expected to lose.'],
  'rival-launch': ['Rival takes sales', 'Sales figures show customers moving to the rival, reducing orders.', 'Customers stick with the brand', 'New orders hold up despite the rival launch, easing fears of lost business.'],
  'machine-breakdown': ['Factory remains slowed', 'Repairs take longer than expected, leaving fewer products ready to sell.', 'Machine back online', 'An early repair gets production running again, easing concerns about missed orders.'],
  'poor-reviews': ['Reviews hurt orders', 'New orders fall after the poor reviews.', 'Sales withstand the reviews', 'New orders remain strong despite the criticism, reversing fears of a sales slump.'],
  'rising-input-cost': ['Higher costs take effect', 'The supplier charges more, reducing the money left from each sale.', 'Supply costs contained', 'A new supply agreement avoids the price increase, preserving the expected margin.'],
  'cancelled-sales-event': ['Sales event stays cancelled', 'The cancellation stands and the company loses the planned sales opportunity.', 'Replacement event arranged', 'A replacement event restores the sales opportunity the company was expected to lose.'],
  'returns': ['Returns increase costs', 'The reported returns arrive, adding refunds and replacement costs.', 'Return figures corrected', 'A records error overstated returns. The expected wave of refunds does not happen.'],
  'training-delay': ['Training holds up work', 'The training delay continues, leaving fewer orders ready.', 'Team catches up', 'The team completes training sooner than feared and catches up with orders.'],
  'packing-mix-up': ['Packing delays shipments', 'The mix-up takes longer to correct, holding up deliveries.', 'Packing corrected in time', 'The team sorts the packing error before dispatch, avoiding the feared delays.'],
};

export function newsResolution(headline: Headline, wasTrue: boolean): { updateTitle: string; updateBody: string } {
  const copy = headline.eventId === undefined ? undefined : EVENT_FOLLOW_UPS[headline.eventId];
  if (!copy) return { updateTitle: wasTrue ? 'Report holds up' : 'Report overturned',
    updateBody: wasTrue ? 'The event supports the original report.' : 'The event goes against the original report.' };
  return { updateTitle: copy[wasTrue ? 0 : 2], updateBody: copy[wasTrue ? 1 : 3] };
}
