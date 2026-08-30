# BMAV Device by Brand Dashboard

Public interactive dashboard for BMA V - Central device performance in August 2026.

## Features

- Net Amount as the default view, with a Qty toggle
- Brand and Target-or-sales-eligible shop filters
- Selectable sales date
- Daily and month-to-date (MTD) views
- KPI, brand performance, shop ranking, and daily trend updates from the same filters
- Week-on-week analysis across Week 32–36 (3 August–6 September), defaulting to the period that contains the latest live date
- Net Amount and QTY deltas, WoW percentages, brand/shop drivers, average selling value, shop contribution signals, and a targeted action summary
- Per-brand WoW badges alongside the existing MoM badges, responsive to the selected week, metric, and shop filter
- Compact All Brand WoW table with equal-day QTY and Net Amount base/current values, differences, percentage changes, sorting, and a Grand Total row
- Brand-colored Shop WoW table with one-brand selection, equal-day week labels, prorated QTY/Net targets, differences, WoW percentages, achievement colors, and every shop including No Target rows
- Live `Daily_Sales_Model` analysis with Brand/model filters, Daily and MTD totals, equal-day QTY/Net WoW by Area, a selected-model daily trend, and a 15-shop WoW table that keeps No Sales branches visible
- Branch Performance supports selecting and aggregating multiple models within one Brand, larger balanced table text, and a one-screen Capture Table mode
- Brand x Shop ranking matrix with the top 12 brands, Daily/MTD/Run Rate values, projected run-rate achievement, per-brand shop ranks, an unranked ALL Shop total, and a compact Capture View
- Brand x Shop uses Brand-colored column headers and highlights the percentage in red when a shop has Target but no MTD sales
- Shop Performance and Model x Area tables include shops with sales even when Target is zero, while shops with neither Target nor sales remain hidden
- Live Shop-Brand rows are built from the union of Target_Brand and current-month Daily_Sales, so sales-only combinations are not dropped
- Google Sheet JSONP live status with an automatic refresh every five minutes

## Week-on-week comparison

The active period is compared on an equal-day basis with the immediately preceding calendar week. For 3–9 August, the comparison starts on 27 July and continues through 2 August when all seven days are available. An in-progress period only includes dates available through the latest live sales date, so a partial week is never compared with more elapsed days than it contains. Week 36 spans 31 August–6 September and continues to work across the month boundary because the dashboard retains date-keyed live sales rows. A missing comparison base is shown as a neutral gray badge instead of a growth percentage.

## GitHub Pages

The production dashboard is published from the `docs` folder on `main`.

## Local development

```text
npm install
npm run dev
```

## Validation

```text
npm run build
npm test
```

