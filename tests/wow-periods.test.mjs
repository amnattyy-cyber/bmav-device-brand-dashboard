import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/wow-periods.ts", import.meta.url), "utf8");
const javascript = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
}).outputText;
const moduleUrl = `data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`;
const { comparableWeekPeriod, previousWeekId, shortDateRange, weekRanges, wowChangeRate } = await import(moduleUrl);

test("partial Week 35 compares one day with one base day", () => {
  const period = comparableWeekPeriod(weekRanges[3], "2026-08-24");
  assert.equal(period.currentEnd, "2026-08-24");
  assert.equal(period.baseStart, "2026-08-17");
  assert.equal(period.baseEnd, "2026-08-17");
  assert.equal(period.currentDays, 1);
  assert.equal(period.complete, false);
});

test("an in-progress week always uses the same number of comparison days", () => {
  const period = comparableWeekPeriod(weekRanges[3], "2026-08-27");
  assert.equal(period.currentEnd, "2026-08-27");
  assert.equal(period.baseEnd, "2026-08-20");
  assert.equal(period.currentDays, 4);
});

test("Week 36 crosses August and September correctly", () => {
  const period = comparableWeekPeriod(weekRanges[4], "2026-09-02");
  assert.equal(period.currentEnd, "2026-09-02");
  assert.equal(period.baseStart, "2026-08-24");
  assert.equal(period.baseEnd, "2026-08-26");
  assert.equal(period.currentDays, 3);
  assert.equal(shortDateRange(period.currentStart, period.currentEnd), "31 Aug–2 Sep");
});

test("a complete Week 36 uses all seven days", () => {
  const period = comparableWeekPeriod(weekRanges[4], "2026-09-06");
  assert.equal(period.currentDays, 7);
  assert.equal(period.baseEnd, "2026-08-30");
  assert.equal(period.complete, true);
});

test("September continues with Week 37 and equal comparison days", () => {
  assert.deepEqual(weekRanges[5], { id: "Week 37", start: "2026-09-07", end: "2026-09-13", label: "7–13 Sep" });
  const period = comparableWeekPeriod(weekRanges[5], "2026-09-09");
  assert.equal(period.currentDays, 3);
  assert.equal(period.baseStart, "2026-08-31");
  assert.equal(period.baseEnd, "2026-09-02");
});

test("a future week is unavailable", () => {
  const period = comparableWeekPeriod(weekRanges[4], "2026-08-24");
  assert.equal(period.currentEnd, null);
  assert.equal(period.baseEnd, null);
  assert.equal(period.currentDays, 0);
});

test("WoW returns no percentage when the comparison base is zero", () => {
  assert.equal(wowChangeRate(120, 100), 20);
  assert.equal(wowChangeRate(10, 0), null);
});

test("table labels the comparison base with the previous week number", () => {
  assert.equal(previousWeekId("Week 34"), "Week 33");
  assert.equal(previousWeekId("Week 32"), "Week 31");
});
