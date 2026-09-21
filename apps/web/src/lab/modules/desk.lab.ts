import type { LabEntry } from '../types';

const entry: LabEntry = {
  id: 'desk',
  order: 7,
  title: 'Desk pieces',
  summary: 'Top bar (total worth, cash, day and clock), news card, reveal banner, company strip, screens by game phase.',
  builtAgainst: 'plain props',
  demo: () => import('./desk.demo'),
};

export default entry;
