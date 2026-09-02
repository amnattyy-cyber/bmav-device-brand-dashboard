import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/stock-data.ts", import.meta.url), "utf8");
const javascript = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
}).outputText;
const moduleUrl = `data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`;
const { focusStockKey, parseStockTable } = await import(moduleUrl);

test("maps all six live Stock model labels to the Model Focus keys", () => {
  assert.equal(focusStockKey("GALAXY A06 5G"), "samsung-a06-5g");
  assert.equal(focusStockKey("OPPO A6C 4G"), "oppo-a6c");
  assert.equal(focusStockKey("VIVO Y05 4G"), "vivo-y05");
  assert.equal(focusStockKey("REDMI A7 PRO 4G"), "xiaomi-redmi-a7-pro");
  assert.equal(focusStockKey("HONOR X5C PLUS 4G"), "honor-x5c");
  assert.equal(focusStockKey("INFINIX SMART 20 4G"), "infinix-smart20");
  assert.equal(focusStockKey("IPHONE 16"), null);
});

test("parses Stock rows and keeps only positive Focus stock", () => {
  const rows = parseStockTable([
    ["SHOP_CODE", "PRODUCT_CODE", "PRODUCT_NAME", "BALANCE", "AMOUNT", "SHOP", "CUSTOM_MODEL", "BRAND"],
    ["80100622", "3001", "H/S,SS,A06", "2", "11,980", "True Shop Central Rama 9 4Fl.", "GALAXY A06 5G", "samsung"],
    ["80100622", "3002", "H/S,HONOR,X5C", "0", "0", "True Shop Central Rama 9 4Fl.", "HONOR X5C PLUS 4G", "honor"],
    ["80100622", "3003", "ACC,CASE", "5", "500", "True Shop Central Rama 9 4Fl.", "PHONE CASE", "other"],
  ]);
  assert.deepEqual(rows, [{
    code: "80100622",
    shop: "True Shop Central Rama 9 4Fl.",
    productCode: "3001",
    productName: "H/S,SS,A06",
    brand: "SAMSUNG",
    model: "GALAXY A06 5G",
    balance: 2,
    amount: 11980,
  }]);
});
