import {
  CellStyleModule,
  ClientSideRowModelApiModule,
  ClientSideRowModelModule,
  ColumnApiModule,
  ExternalFilterModule,
  HighlightChangesModule,
  ModuleRegistry,
  RenderApiModule,
  RowApiModule,
  RowSelectionModule,
  RowStyleModule,
  enableDevValidations,
  themeQuartz,
} from 'ag-grid-community';

/**
 * Everything the table needs from the grid library, set up once per page
 * load: the modules it uses and the theme it wears.
 *
 * Only the modules in use are registered, by name, so the rest of the library
 * stays out of the bundle. A grid option whose module is missing does nothing
 * at all, silently; the development-only validations turn that silence into
 * a console message that names the option and the module.
 */
ModuleRegistry.registerModules([
  ClientSideRowModelModule, // rows held in the browser, and sorting them
  ClientSideRowModelApiModule, // applyTransactionAsync, refreshClientSideRowModel
  HighlightChangesModule, // the flash on a changed cell
  CellStyleModule, // cellClass and cellClassRules
  RowStyleModule, // rowClassRules
  ExternalFilterModule, // the caller's filter
  RowSelectionModule, // the selected row, and its selected state for assistive technology
  RowApiModule, // getRowNode, redrawRows
  ColumnApiModule, // getColumnState: is any column sorted
  RenderApiModule, // setGridAriaProperty: the table's accessible name
]);

if (import.meta.env.DEV) enableDevValidations();

/**
 * The grid's look. Every colour is a reference to a token in `styles.css`,
 * so the stylesheet stays the one place a colour is written down.
 */
export const strikeTheme = themeQuartz.withParams({
  backgroundColor: 'var(--card)',
  foregroundColor: 'var(--foreground)',
  borderColor: 'var(--border)',
  headerBackgroundColor: 'var(--muted)',
  headerTextColor: 'var(--muted-foreground)',
  rowHoverColor: 'var(--accent)',
  oddRowBackgroundColor: 'transparent',
  rowBorder: { color: 'var(--border)' },
  accentColor: 'var(--gold)',
  // Keyboard focus is lilac everywhere in the table; gold is kept for what
  // the player has chosen. The grid rings a focused header with
  // `focusShadow` and outlines a focused cell in its range-selection border
  // colour, which would otherwise follow the accent.
  focusShadow: { radius: 2, spread: 2, color: 'var(--ring)' },
  rangeSelectionBorderColor: 'var(--ring)',
  fontFamily: 'system-ui, sans-serif',
  fontSize: 13,
  // A hair lighter than regular, where the font allows it: a dense dark table reads less heavy.
  fontWeight: 350,
  headerFontSize: 11,
  headerFontWeight: 500,
  rowHeight: 34,
  headerHeight: 34,
  cellHorizontalPadding: 14,
  spacing: 6,
  // The panel around the table carries the border and the rounded corners.
  wrapperBorder: false,
  wrapperBorderRadius: 0,
  borderRadius: 0,
  // Dark scrollbars: the only scrollbar on the page is the one inside the table.
  browserColorScheme: 'dark',
  // A changed cell shows no colour unless the stylesheet names one for it:
  // the UP colour for a rise, the DOWN colour for a fall, nothing otherwise.
  valueChangeValueHighlightBackgroundColor: 'transparent',
});
