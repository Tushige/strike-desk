import type { LabEntry } from '../types';

const entry: LabEntry = {
  id: 'price-chart',
  order: 2,
  title: 'Price chart',
  summary:
    "An SVG chart that measures itself: the day's price so far, target and break-even lines, markers.",
  builtAgainst: 'a series source outside React, plus lines and markers as plain data',
};

export default entry;
