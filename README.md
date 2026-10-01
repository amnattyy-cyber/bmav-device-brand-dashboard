# BMAV Device by Brand Dashboard

Public interactive dashboard for BMA V - Central device performance, with monthly selection including October 2026.

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
- Live `Daily_Sales_Model` analysis with one shared Brand, multi-model, and multi-shop filter set across every Model Performance table, including aggregated Daily/MTD totals, equal-day QTY/Net WoW, daily trend, branch ranking, and shop-level sales
- Live BMA V Stock snapshot for the seven Focus models, aggregated by shop and model with balance, stock value, MTD days cover, 15-shop filtering, and a full-table capture mode
- The seven Focus sales monitor has a synchronized date picker plus Daily/MTD switch; summaries and all 15 shop rows update to the selected period while Stock days cover remains MTD-based
- Every Model Performance table includes a one-screen `Capture Table` mode for Desktop and Mobile, with larger normal-view text and tighter balanced columns
- Shop × Model analysis supports selecting multiple dates inside the active Week and calculates QTY/Net WoW against the matching weekdays seven days earlier
- Brand x Shop ranking matrix with the top 12 brands, Daily/MTD/Run Rate values, projected run-rate achievement, per-brand shop ranks, an unranked ALL Shop total, and a compact Capture View
- Brand x Shop uses Brand-colored column headers and highlights the percentage in red when a shop has Target but no MTD sales
- Shop Performance and Model x Area tables include shops with sales even when Target is zero, while shops with neither Target nor sales remain hidden
- Live Shop-Brand rows are built from the union of Target_Brand and current-month Daily_Sales, so sales-only combinations are not dropped
- Google Sheet JSONP live status with an automatic refresh every five minutes

## Week-on-week comparison

The active period is compared on an equal-day basis with the immediately preceding calendar week. For 3–9 August, the comparison starts on 27 July and continues through 2 August when all seven days are available. An in-progress period only includes dates available through the latest live sales date, so a partial week is never compared with more elapsed days than it contains. Week 36 spans 31 August–6 September and continues to work across the month boundary because the dashboard retains date-keyed live sales rows. A missing comparison base is shown as a neutral gray badge instead of a growth percentage.

## October 2026 targets

- `src/october-targets.json` contains the October workbook targets from `TG Device By Brand Oct B5 GPT.xlsx`: `TG device` columns O/P (QTY/Net amount), and `TG By brand` columns T/V (OPERATION_TARGET_QTY/OPERATION_TARGET_NET_AMOUNT). Brand rows are aggregated by Shop Code and Brand; WW shop codes match the live sales keys.
- Device totals and the 120 shop/brand target rows reconcile to **4,237.671719056332 QTY** and **139,215,088.76 Net Amount**, across 15 shops with targets and 10 brands. The Device source also retains three zero-target shops. Fractional targets are preserved without rounding during calculation.
- October targets are selected by `2026-10`, independently of the latest sales month. October remains selectable before sales arrive; the page identifies the missing sales period and displays the full-month target. Other months retain their existing target routing, and sales-only shop/brand rows remain included.
- ALL-brand KPIs, Shop Performance and the ALL column in Brand × Shop use Device targets; brand columns use the corresponding Brand targets. Source totals also reconcile per shop. No target scaling or redistribution is applied.
- Sales, model sales, stock, JSONP, LIVE status, latest-sales default and the five-minute refresh remain connected to the existing feeds. The workbook target snapshot is versioned in this repository; the Google Sheet itself is unchanged.
- Existing calendar weeks cover October (Week 40–44), including the September/October boundary. Changing Month resets the selected week to that month's latest available date.

## GitHub Pages publishing

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
