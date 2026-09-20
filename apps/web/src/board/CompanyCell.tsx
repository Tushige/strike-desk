import { memo } from 'react';
import type { CustomCellRendererProps } from 'ag-grid-react';
import type { ContractRow } from '../store/contractRows';

/** The company's name, then its ticker in the quieter text colour. */
export const CompanyCell = memo(function CompanyCell({ data }: CustomCellRendererProps<ContractRow, string>) {
  if (data === undefined) return null;
  return (
    <>
      {data.company} <span className="sd-ticker">{data.ticker}</span>
    </>
  );
});
