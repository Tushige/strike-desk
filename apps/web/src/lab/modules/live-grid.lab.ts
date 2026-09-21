import type { LabEntry } from '../types';

const entry: LabEntry = {
  id: 'live-grid',
  order: 1,
  title: 'Live grid',
  summary:
    'A live table that takes batches of changed rows: flashing cells, dimmed rows, keyboard and focus, filters, a sort that holds still while you are in the table, selection that survives updates, a stale look and a speed readout.',
  builtAgainst: 'a row source (the whole set plus the rows that changed) and column definitions',
};

export default entry;
