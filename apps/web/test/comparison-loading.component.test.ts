// @vitest-environment jsdom
import { createElement } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { LazyComparison } from '../src/screens/desk/LazyComparison';

const download = vi.hoisted(() => {
  let finish: () => void = () => {};
  const promise = new Promise<void>(resolve => { finish = resolve; });
  return { promise, finish };
});
vi.mock('../src/store/hooks', () => ({
  views: { comparison: {} },
  useView: () => ({ stress: false, companies: [{ ticker: 'PUP' }, { ticker: 'FIZ' }] }),
}));
vi.mock('../src/screens/desk/CompareOptions', async () => {
  await download.promise;
  return { CompareOptions: () => createElement('div', { role: 'grid', 'aria-label': 'Contracts' }) };
});
afterEach(cleanup);

it('reserves a table while its chunk loads and removes the skeleton immediately when ready', async () => {
  const { container } = render(createElement(LazyComparison, {
    companyId: 0, selectedContractId: null, onPick: () => {}, onChooseCompany: () => {}, companyLocked: false, stale: false,
  }));
  expect(screen.getByRole('status', { name: 'Loading live contracts' })).toBeTruthy();
  expect(container.querySelector('.comparison-grid')).toBeTruthy();
  expect(screen.queryAllByRole('button')).toHaveLength(0);
  expect(screen.queryByRole('grid')).toBeNull();
  await act(async () => { download.finish(); await download.promise; });
  expect(await screen.findByRole('grid', { name: 'Contracts' })).toBeTruthy();
  expect(screen.queryByRole('status', { name: 'Loading live contracts' })).toBeNull();
});
