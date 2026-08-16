# BMAV Device by Brand Dashboard

Public interactive dashboard for BMA V - Central device performance in August 2026.

## Features

- Net Amount as the default view, with a Qty toggle
- Brand and target-eligible shop filters
- Selectable sales date
- Daily and month-to-date (MTD) views
- KPI, brand performance, shop ranking, and daily trend updates from the same filters
- Week-on-week analysis across the fixed August periods (1–7, 8–14, 15–21, 22–28, and 29–31), defaulting to the period that contains the latest live date
- Net Amount and QTY deltas, WoW percentages, brand/shop drivers, average selling value, shop contribution signals, and a targeted action summary
- Google Sheet JSONP live status with an automatic refresh every five minutes

## Week-on-week comparison

The active period is compared on an equal-day basis with the immediately preceding period. For 1–7 August, the comparison uses the matching number of final days from July. An in-progress period only includes dates available through the latest live sales date, so a partial week is never compared with more elapsed days than it contains.

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
```
