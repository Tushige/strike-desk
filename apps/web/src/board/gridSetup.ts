import {
  CellStyleModule,
  ClientSideRowModelApiModule,
  ClientSideRowModelModule,
  HighlightChangesModule,
  ModuleRegistry,
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
  ClientSideRowModelModule, // rows held in the browser
  ClientSideRowModelApiModule, // applyTransactionAsync
  HighlightChangesModule, // the flash on a changed cell
  CellStyleModule, // cellClass and cellClassRules
  RowStyleModule, // rowClassRules
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
  focusShadow: { radius: 2, spread: 2, color: 'var(--ring)' },
  fontFamily: 'system-ui, sans-serif',
  fontSize: 13,
  headerFontSize: 11,
  headerFontWeight: 500,
  rowHeight: 34,
  headerHeight: 34,
  cellHorizontalPadding: 14,
  spacing: 6,
  // The panel around the table carries the border and the rounded corners.
  wrapperBorder: false,
  borderRadius: 0,
  // Dark scrollbars: the only scrollbar on the page is the one inside the table.
  browserColorScheme: 'dark',
});
