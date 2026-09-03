import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/stock-data.ts", import.meta.url), "utf8");
const javascript = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
}).outputText;
const moduleUrl = `data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`;
const { focusStockKey } = await import(moduleUrl);

test("maps the live Realme Note80 label to the seventh Focus key", () => {
  assert.equal(focusStockKey("REALME NOTE 80 4G"), "realme-note80");
  assert.equal(focusStockKey("REALME NOTE80 4G"), "realme-note80");
});
