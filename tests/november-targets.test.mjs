import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function moduleUrl(name) {
  let source = await readFile(new URL(`../src/${name}.ts`, import.meta.url), "utf8");
  for (const match of [...source.matchAll(/import (\w+) from "\.\/(.+\.json)";/g)]) {
    const json = await readFile(new URL(`../src/${match[2]}`, import.meta.url), "utf8");
    source = source.replace(match[0], `const ${match[1]} = ${json};`);
  }
  let js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
  for (const match of [...js.matchAll(/from "\.\/(.*?)"/g)]) {
    js = js.replace(match[0], `from "${await moduleUrl(match[1])}"`);
  }
  return `data:text/javascript;base64,${Buffer.from(js).toString("base64")}`;
}

const { dashboardMonths, dashboardForMonth, fallbackData, sheetRefreshInterval } = await import(await moduleUrl("google-sheet-data"));
const { weekRanges, weekIndexForDate, comparableWeekPeriod } = await import(await moduleUrl("wow-periods"));
const targets = JSON.parse(await readFile(new URL("../src/november-targets.json", import.meta.url), "utf8"));
const close = (a, b) => assert.ok(Math.abs(a - b) < 0.00001, `${a} != ${b}`);

test("November workbook reconciles at area, shop, and brand level", () => {
  assert.equal(targets.month, "2026-11");
  assert.equal(targets.device.length, 15);
  assert.equal(targets.brands.length, 124);
  assert.equal(new Set(targets.brands.map((row) => row.brand)).size, 12);
  for (const group of [targets.device, targets.brands]) {
    close(group.reduce((sum, row) => sum + row.targetQty, 0), 4032.5318500924654);
    close(group.reduce((sum, row) => sum + row.targetNet, 0), 99956261.94069129);
  }
  for (const shop of targets.device) {
    const brands = targets.brands.filter((row) => row.code === shop.code);
    close(brands.reduce((sum, row) => sum + row.targetQty, 0), shop.targetQty);
    close(brands.reduce((sum, row) => sum + row.targetNet, 0), shop.targetNet);
  }
});

test("November can be selected before sales arrive", () => {
  assert.ok(dashboardMonths(fallbackData).includes("2026-11"));
  const november = dashboardForMonth(fallbackData, "2026-11");
  assert.equal(november.hasMonthSales, false);
  assert.equal(november.month, "November 2026");
  assert.equal(november.totals.dailyNet.length, 30);
  close(november.totals.targetNet, 99956261.94069129);
  close(november.totals.targetQty, 4032.5318500924654);
  assert.equal(november.deviceTargets.length, 15);
  assert.equal(november.targetSource, "202611_Target by Brand Nov'26 V.1 B5.xlsx");
  assert.equal(sheetRefreshInterval, 300000);
});

test("November targets override feed targets and preserve October comparison sales", () => {
  const novemberSale = { date: "2026-11-01", code: "80100478", shop: "True Shop Terminal 21", brand: "TECNO", qty: 2, net: 5000 };
  const octoberSale = { ...novemberSale, date: "2026-10-01", qty: 1, net: 2400 };
  const source = { ...fallbackData, latest: "2026-11-01", sales: [...fallbackData.sales, novemberSale, octoberSale] };
  const november = dashboardForMonth(source, "2026-11");
  const row = november.shops.find((item) => item.code === novemberSale.code && item.brand === novemberSale.brand);
  const target = targets.brands.find((item) => item.code === novemberSale.code && item.brand === novemberSale.brand);
  close(row.targetQty, target.targetQty);
  close(row.targetNet, target.targetNet);
  assert.equal(row.dailyNet[0], 5000);
  assert.equal(row.previousDailyNet[0], 2400);
  assert.equal(november.hasMonthSales, true);
  close(november.totals.targetNet, 99956261.94069129);
});

test("November target snapshot never leaks into another month", () => {
  const october = dashboardForMonth(fallbackData, "2026-10");
  close(october.totals.targetNet, 139215088.76);
  assert.notEqual(october.targetSource, targets.source);
  const december = dashboardForMonth(fallbackData, "2026-12");
  assert.equal(december.totals.targetNet, 0);
  assert.equal(december.deviceTargets, undefined);
});

test("November weeks include both month boundaries", () => {
  const weeks = weekRanges.filter((row) => row.start.startsWith("2026-11") || row.end.startsWith("2026-11"));
  assert.deepEqual(weeks.map((row) => row.id), ["Week 44", "Week 45", "Week 46", "Week 47", "Week 48", "Week 49"]);
  const week = weekRanges[weekIndexForDate("2026-11-01")];
  const period = comparableWeekPeriod(week, "2026-11-01");
  assert.equal(period.currentStart, "2026-10-26");
  assert.equal(period.currentDays, 7);
  assert.equal(period.baseEnd, "2026-10-25");
});
