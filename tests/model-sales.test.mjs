import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/model-sales.ts", import.meta.url), "utf8");
const javascript = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
}).outputText;
const moduleUrl = `data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`;
const { modelSaleKey, modelShopInsight, parseCsv, parseModelSalesTable, summarizeModelSales, topModelsByBrand } = await import(moduleUrl);

test("summarizes daily model sales and selects the top model for each brand", () => {
  const sales = [
    { date: "2026-08-27", code: "S001", shop: "Shop A", brand: "HONOR", model: "MODEL A", qty: 1, net: 3000 },
    { date: "2026-08-27", code: "S001", shop: "Shop A", brand: "HONOR", model: "MODEL A", qty: 2, net: 6000 },
    { date: "2026-08-27", code: "S001", shop: "Shop A", brand: "HONOR", model: "MODEL B", qty: 2, net: 12000 },
    { date: "2026-08-27", code: "S001", shop: "Shop A", brand: "SAMSUNG", model: "MODEL C", qty: 1, net: 5000 },
  ];
  assert.deepEqual(summarizeModelSales(sales).find((row) => row.model === "MODEL A"), { key: "HONOR|MODEL A", brand: "HONOR", model: "MODEL A", qty: 3, net: 9000 });
  assert.equal(topModelsByBrand(sales, "qty")[0].model, "MODEL A");
  assert.equal(topModelsByBrand(sales, "net").find((row) => row.brand === "HONOR").model, "MODEL B");
});

test("classifies each shop into an actionable model-sales status", () => {
  assert.deepEqual(modelShopInsight(0, 0, 0), { label: "No Sales MTD", action: "เร่งเปิดยอดรุ่นนี้", tone: "flat" });
  assert.deepEqual(modelShopInsight(0, 2, 5), { label: "No Sales Week", action: "เร่งกลับมาทำยอด", tone: "decline" });
  assert.equal(modelShopInsight(2, 0, 2).label, "New Sales");
  assert.equal(modelShopInsight(3, 2, 4).label, "Growth");
  assert.equal(modelShopInsight(1, 2, 4).label, "Decline");
  assert.equal(modelShopInsight(2, 2, 4).label, "Stable");
});

test("parses CSV fields containing commas, quotes, and line breaks", () => {
  assert.deepEqual(parseCsv('A,B,C\r\n1,"Shop, Central","MODEL ""PLUS"""\r\n2,"Two\nLines",Done\r\n'), [
    ["A", "B", "C"],
    ["1", "Shop, Central", 'MODEL "PLUS"'],
    ["2", "Two\nLines", "Done"],
  ]);
});

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
