import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/stock-data.ts", import.meta.url), "utf8");
const javascript = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
}).outputText;
const moduleUrl = `data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`;
const { focusSalesKey, focusStockKey } = await import(moduleUrl);

test("maps only the requested Realme Note 80 device and capacity", () => {
  assert.equal(focusSalesKey("REALME NOTE 80 4G 4/64GB"), "realme-note80-4-64");
  assert.equal(focusStockKey("H/S,REALME NOTE 80,4G,4/64,BLACK,KNOX"), "realme-note80-4-64");
  assert.equal(focusStockKey("ACC,REALME NOTE 80,SPECIAL BAG,FOC"), null);
});
