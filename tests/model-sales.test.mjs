import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/model-sales.ts", import.meta.url), "utf8");
const javascript = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
}).outputText;
const moduleUrl = `data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`;
const { modelSaleKey, parseModelSalesTable } = await import(moduleUrl);

test("parses the live Daily_Sales_Model header where Qty contains the model", () => {
  const rows = parseModelSalesTable([
    ["Sales Date", "Shop Code", "Shop Name", "Brand", "Qty", "Sum of QTY", "Sum of NET_AMOUNT"],
    ["27/08/2026", "S001", "Example Shop A", "honor", "HONOR MODEL A", "2", "5000"],
  ]);
  assert.deepEqual(rows, [{
    date: "2026-08-27",
    code: "S001",
    shop: "Example Shop A",
    brand: "HONOR",
    model: "HONOR MODEL A",
    qty: 2,
    net: 5000,
  }]);
});

test("supports a corrected Model header and GViz Date value", () => {
  const rows = parseModelSalesTable([
    ["Sales Date", "Shop Code", "Shop Name", "Brand", "Model", "Qty", "Net Amount"],
    ["Date(2026,7,3)", "S002", "Example Shop B", "SAMSUNG", "SAMSUNG MODEL B", "1", "4,000"],
  ]);
  assert.equal(rows[0].date, "2026-08-03");
  assert.equal(rows[0].net, 4000);
  assert.equal(modelSaleKey(rows[0]), "SAMSUNG|SAMSUNG MODEL B");
});

test("drops empty or invalid model rows", () => {
  const rows = parseModelSalesTable([
    ["Sales Date", "Shop Code", "Shop Name", "Brand", "Qty", "Sum of QTY", "Sum of NET_AMOUNT"],
    ["27/08/2026", "S001", "Example Shop", "HONOR", "", "2", "5000"],
    ["27/08/2026", "S001", "Example Shop", "HONOR", "HONOR MODEL A", "0", "0"],
  ]);
  assert.equal(rows.length, 0);
});
