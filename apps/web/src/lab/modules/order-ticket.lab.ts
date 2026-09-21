import type { LabEntry } from '../types';

const entry: LabEntry = {
  id: 'order-ticket',
  order: 3,
  title: 'Order ticket',
  summary:
    'One form for buying and cashing out: draft, pending, accepted, rejected with a reason, disabled while prices are stale. It shows the cost and the most you can lose.',
  builtAgainst: "submit(command) -> outcome, the selected contract's quote, cash",
};

export default entry;
