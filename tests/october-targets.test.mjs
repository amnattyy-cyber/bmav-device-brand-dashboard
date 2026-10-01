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
const targets = JSON.parse(await readFile(new URL("../src/october-targets.json", import.meta.url), "utf8"));
const close = (a, b) => assert.ok(Math.abs(a - b) < 0.00001, `${a} != ${b}`);

test("October workbook reconciles independently at total and shop level", () => {
  assert.equal(targets.device.length, 18);
  assert.equal(targets.brands.length, 120);
  assert.equal(new Set(targets.brands.map(row => row.brand)).size, 10);
  for (const group of [targets.device, targets.brands]) {
    close(group.reduce((sum, row) => sum + row.targetQty, 0), 4237.671719056332);
    close(group.reduce((sum, row) => sum + row.targetNet, 0), 139215088.76);
  }
  for (const shop of targets.device) {
    const brands = targets.brands.filter(row => row.code === shop.code);
    close(brands.reduce((sum, row) => sum + row.targetQty, 0), shop.targetQty);
    close(brands.reduce((sum, row) => sum + row.targetNet, 0), shop.targetNet);
  }
});

test("October can be selected with targets before any October sales arrive", () => {
  assert.ok(dashboardMonths(fallbackData).includes("2026-10"));
  const oct = dashboardForMonth(fallbackData, "2026-10");
  assert.equal(oct.hasMonthSales, false);
  assert.equal(oct.month, "October 2026");
  assert.equal(oct.totals.dailyNet.length, 31);
  close(oct.totals.targetNet, 139215088.76);
  assert.equal(oct.totals.dailyNet.reduce((a,b) => a+b, 0), 0);
  assert.equal(oct.deviceTargets.length, 18);
  assert.equal(sheetRefreshInterval, 300000);
});

test("October targets win over undated feed targets, while sales-only brands survive", () => {
  const sale = {date:"2026-10-01",code:"80100478",shop:"True Shop Terminal 21",brand:"NOTHING",qty:2,net:5000};
  const source = {...fallbackData, latest:"2026-10-01", sales:[...fallbackData.sales, sale,
    {...sale,date:"2026-09-01",qty:1,net:2400}]};
  const oct = dashboardForMonth(source, "2026-10");
  const row = oct.shops.find(row => row.code === sale.code && row.brand === sale.brand);
  assert.equal(row.targetNet, 0);
  assert.equal(row.dailyNet[0], 5000);
  assert.equal(row.previousDailyNet[0], 2400);
  assert.equal(oct.hasMonthSales, true);
  close(oct.totals.targetNet, 139215088.76);
  close(oct.totals.dailyNet[0], 5000);
});

test("October target snapshot never leaks into another month", () => {
  const august = dashboardForMonth(fallbackData, fallbackData.latest.slice(0, 7));
  close(august.totals.targetNet, fallbackData.shops.reduce((s,row) => s+row.targetNet,0));
  assert.equal(august.deviceTargets, undefined);
  assert.equal(dashboardForMonth(fallbackData, "2026-11").totals.targetNet, 0);
});

test("October weeks and September boundary keep equal-day comparisons", () => {
  const weeks = weekRanges.filter(row => row.start.startsWith("2026-10") || row.end.startsWith("2026-10"));
  assert.deepEqual(weeks.map(row => row.id), ["Week 40","Week 41","Week 42","Week 43","Week 44"]);
  const week = weekRanges[weekIndexForDate("2026-10-01")];
  const period = comparableWeekPeriod(week, "2026-10-01");
  assert.equal(period.currentStart, "2026-09-28");
  assert.equal(period.currentDays, 4);
  assert.equal(period.baseEnd, "2026-09-24");
});
