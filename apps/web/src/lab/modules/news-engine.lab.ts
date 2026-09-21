import type { LabEntry } from '../types';

const entry: LabEntry = {
  id: 'news-engine',
  order: 6,
  title: 'News engine',
  summary:
    'Headlines assembled from a starter pool by a seeded stream. The hidden outcome and the reveal moment never reach the wire.',
  builtAgainst: 'the labelled random streams in shared code',
  demo: () => import('./news-engine.demo'),
};

export default entry;
