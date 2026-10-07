import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/stock-data.ts", import.meta.url), "utf8");
const javascript = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
}).outputText;
const moduleUrl = `data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`;
const { focusModels, focusSalesKey, focusStockKey, parseStockTable } = await import(moduleUrl);

test("defines the requested 15 exact Model Focus devices", () => {
  assert.equal(focusModels.length, 15);
  assert.deepEqual(focusModels.map((model) => model.label), [
    "Samsung A06 5G 4/64GB",
    "vivo Y05 4/64GB",
    "Xiaomi Redmi A7 Pro 4/128GB",
    "Honor X5c Plus 4/128GB",
    "Infinix Smart 20 4/64GB",
    "vivo Y31D 6/256GB",
    "vivo Y11D 4/128GB",
    "OPPO A6C 4/64GB",
    "OPPO A6C 4/128GB",
    "Samsung A07s 4/64GB",
    "Infinix Smart 20 4/128GB",
    "Xiaomi Redmi A7 Pro 4/64GB",
    "Realme C100i 4/128GB",
    "Samsung A08 4/64GB",
    "Realme Note 80 4/64GB",
  ]);
});

test("maps Daily Sales only when model and capacity match exactly", () => {
  assert.equal(focusSalesKey("GALAXY A06 5G 4/64GB"), "samsung-a06-5g-4-64");
  assert.equal(focusSalesKey("VIVO Y31D 4G 6/256GB"), "vivo-y31d-6-256");
  assert.equal(focusSalesKey("OPPO A6C 4G 4/64GB"), "oppo-a6c-4-64");
  assert.equal(focusSalesKey("OPPO A6C 4G 4/128GB"), "oppo-a6c-4-128");
  assert.equal(focusSalesKey("INFINIX SMART 20 4G 4/128GB"), "infinix-smart20-4-128");
  assert.equal(focusSalesKey("GALAXY A08 4G 4/128GB"), null);
  assert.equal(focusSalesKey("VIVO Y05 4G 4/128GB"), null);
});

test("maps Stock only from exact H/S device product names", () => {
  assert.equal(focusStockKey("H/S,SS,GALAXY A06,5G,4/64GB,BLACK"), "samsung-a06-5g-4-64");
  assert.equal(focusStockKey("H/S,XIAOMI,REDMI A7 PRO,4G,4/128GB,BLUE"), "xiaomi-redmi-a7-pro-4-128");
  assert.equal(focusStockKey("H/S,INFINIX,SMART 20,4G,4/64GB,BLACK"), "infinix-smart20-4-64");
  assert.equal(focusStockKey("H/S,INFINIX,SMART 20,4G,4/128GB,BLACK"), "infinix-smart20-4-128");
  assert.equal(focusStockKey("H/S,REALME,C100i,4G,4/128GB,DUSK GREY"), "realme-c100i-4-128");
  assert.equal(focusStockKey("ACC,HONOR,X5C PLUS,COFFEE CUP,FOC"), null);
  assert.equal(focusStockKey("H/S,VIVO,Y05,4G,4/128,BLACK"), null);
});

test("parses Stock rows and keeps only positive Focus stock", () => {
  const rows = parseStockTable([
    ["SHOP_CODE", "PRODUCT_CODE", "PRODUCT_NAME", "BALANCE", "AMOUNT", "SHOP", "CUSTOM_MODEL", "BRAND"],
    ["80100622", "3001", "H/S,SS,GALAXY A06,5G,4/64GB,BLACK", "2", "11,980", "True Shop Central Rama 9 4Fl.", "GALAXY A06 5G", "samsung"],
    ["80100622", "3002", "H/S,HONOR,X5C PLUS,4G,4/128GB,SILVER", "0", "0", "True Shop Central Rama 9 4Fl.", "HONOR X5C PLUS 4G", "honor"],
    ["80100622", "3003", "ACC,HONOR,X5C PLUS,COFFEE CUP,FOC", "5", "500", "True Shop Central Rama 9 4Fl.", "HONOR X5C PLUS 4G", "honor"],
    ["80100622", "3004", "H/S,VIVO,Y05,4G,4/128,BLACK", "3", "14,970", "True Shop Central Rama 9 4Fl.", "VIVO Y05 4G", "vivo"],
  ]);
  assert.deepEqual(rows, [{
    code: "80100622",
    shop: "True Shop Central Rama 9 4Fl.",
    productCode: "3001",
    productName: "H/S,SS,GALAXY A06,5G,4/64GB,BLACK",
    brand: "SAMSUNG",
    model: "GALAXY A06 5G",
    balance: 2,
    amount: 11980,
  }]);
});
