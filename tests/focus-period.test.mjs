import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/focus-period.ts", import.meta.url), "utf8");
const javascript = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
}).outputText;
const moduleUrl = `data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`;
const { focusPeriod, selectedDayFromDate } = await import(moduleUrl);

test("Focus Daily uses only the selected date", () => {
  assert.deepEqual(focusPeriod("daily", "2026-08", "2026-08-25"), {
    start: "2026-08-25",
    end: "2026-08-25",
    days: 1,
  });
});

test("Focus MTD starts on the first day of the selected month", () => {
  assert.deepEqual(focusPeriod("mtd", "2026-08", "2026-08-25"), {
    start: "2026-08-01",
    end: "2026-08-25",
    days: 25,
  });
});

test("date selection ignores empty and out-of-range values", () => {
  assert.equal(selectedDayFromDate("", 3), null);
  assert.equal(selectedDayFromDate("2026-09-04", 3), null);
  assert.equal(selectedDayFromDate("2026-09-02", 3), 2);
});
