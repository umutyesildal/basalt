# Compact asset catalog cards

Date: 2026-10-03

## Owner request

Remove inline charts from the Stocks and ETF catalogs and make their cards smaller. Keep the stock detail chart and its 7D/1M period controls.

## Changes

- `app/components/xstocks/xstock-catalog-grid.tsx` no longer imports or calls the history hook, history-return helper, or Bklit chart component. Browsing, searching, paginating and refreshing these lists no longer requests historical candles.
- Catalog cards show the issuer logo, token ticker, company name and existing real token quote. Inline 7D percentages were removed with their history dependency; unavailable prices still use the shared unavailable formatter.
- Reduced card padding to 16px, logo size to 36px, price type to 20px and grid spacing to 12px. The responsive grid uses one column on mobile, two from 640px, and four from 1024px. Long names and tickers truncate within their cards.
- Preserved catalog search, the 24-item page size, pagination focus, keyboard focus rings, trading-halt status and market-session quote polling rules.
- The stock detail page, its actual Bklit 7D/1M chart and daily history refresh remain unchanged.

## Verification

- Source audit confirms the shared catalog component has no history imports, calls or chart markup. Stocks and ETFs both use this component.
- `./node_modules/.bin/tsc --noEmit --incremental false -p app/tsconfig.json`: passed.
- `npm run build` in `app`: passed. The local production server was restarted with the rebuilt app.
- Browser check at 1280px: four compact columns, zero catalog charts, no horizontal overflow. ETF check at 375px: one column, zero charts, no horizontal overflow.
- Screenshots: [Stocks desktop](assets/compact-asset-cards-2026-10-03/stocks-desktop.png), [ETFs mobile](assets/compact-asset-cards-2026-10-03/etfs-mobile.png).
