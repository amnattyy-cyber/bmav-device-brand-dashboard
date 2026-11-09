import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/stock-data.ts", import.meta.url), "utf8");
const javascript = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
}).outputText;
const moduleUrl = `data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`;
const { focusModels, focusSalesKey, focusStockKey, parseStockTable, sortFocusBySales } = await import(moduleUrl);

test("defines the remaining 13 exact Model Focus devices", () => {
  assert.equal(focusModels.length, 13);
  assert.deepEqual(focusModels.map((model) => model.label), [
    "OPPO A6C 4/128GB",
    "Infinix Smart 20 4/64GB",
    "Honor X5c Plus 4/128GB",
    "Samsung A07s 4/64GB",
    "vivo Y05 4/64GB",
    "OPPO A6C 4/64GB",
    "vivo Y11D 4/128GB",
    "Realme Note 80 4/64GB",
    "Infinix Smart 20 4/128GB",
    "Xiaomi Redmi A7 Pro 4/64GB",
    "Samsung A08 4/64GB",
    "Realme C100 4G 4/128GB",
    "TECNO POP 20 (Focus)"
]);
});

test("maps Daily Sales only when model and capacity match exactly", () => {
  assert.equal(focusSalesKey("GALAXY A06 5G 4/64GB"), null);
  assert.equal(focusSalesKey("REALME C100I 4G 4/128GB"), null);
  assert.equal(focusSalesKey("VIVO Y31D 4G 6/256GB"), null);
  assert.equal(focusSalesKey("OPPO A6C 4G 4/64GB"), "oppo-a6c-4-64");
  assert.equal(focusSalesKey("OPPO A6C 4G 4/128GB"), "oppo-a6c-4-128");
  assert.equal(focusSalesKey("INFINIX SMART 20 4G 4/128GB"), "infinix-smart20-4-128");
  assert.equal(focusSalesKey("GALAXY A08 4G 4/128GB"), null);
  assert.equal(focusSalesKey("VIVO Y05 4G 4/128GB"), null);
});

test("maps Stock only from exact H/S device product names", () => {
  assert.equal(focusStockKey("H/S,SS,GALAXY A06,5G,4/64GB,BLACK"), null);
  assert.equal(focusStockKey("H/S,XIAOMI,REDMI A7 PRO,4G,4/128GB,BLUE"), null);
  assert.equal(focusStockKey("H/S,INFINIX,SMART 20,4G,4/64GB,BLACK"), "infinix-smart20-4-64");
  assert.equal(focusStockKey("H/S,INFINIX,SMART 20,4G,4/128GB,BLACK"), "infinix-smart20-4-128");
  assert.equal(focusStockKey("H/S,REALME,C100i,4G,4/128GB,DUSK GREY"), null);
  assert.equal(focusStockKey("ACC,HONOR,X5C PLUS,COFFEE CUP,FOC"), null);
  assert.equal(focusStockKey("H/S,VIVO,Y05,4G,4/128,BLACK"), null);
});

test("parses Stock rows and keeps only positive Focus stock", () => {
  const rows = parseStockTable([
    ["SHOP_CODE", "PRODUCT_CODE", "PRODUCT_NAME", "BALANCE", "AMOUNT", "SHOP", "CUSTOM_MODEL", "BRAND"],
    ["80100622", "3001", "H/S,SS,GALAXY A07S,4G,4/64GB,BLACK", "2", "11,980", "True Shop Central Rama 9 4Fl.", "GALAXY A07S 4G", "samsung"],
    ["80100622", "3002", "H/S,HONOR,X5C PLUS,4G,4/128GB,SILVER", "0", "0", "True Shop Central Rama 9 4Fl.", "HONOR X5C PLUS 4G", "honor"],
    ["80100622", "3003", "ACC,HONOR,X5C PLUS,COFFEE CUP,FOC", "5", "500", "True Shop Central Rama 9 4Fl.", "HONOR X5C PLUS 4G", "honor"],
    ["80100622", "3004", "H/S,VIVO,Y05,4G,4/128,BLACK", "3", "14,970", "True Shop Central Rama 9 4Fl.", "VIVO Y05 4G", "vivo"],
  ]);
  assert.deepEqual(rows, [{
    code: "80100622",
    shop: "True Shop Central Rama 9 4Fl.",
    productCode: "3001",
    productName: "H/S,SS,GALAXY A07S,4G,4/64GB,BLACK",
    brand: "SAMSUNG",
    model: "GALAXY A07S 4G",
    balance: 2,
    amount: 11980,
  }]);
});

 test("new entry focus matches C100 4G only and POP 20 devices", () => {
  assert.equal(focusSalesKey("REALME C100 4G 4/128GB"), "realme-c100-4g-4-128");
  assert.equal(focusSalesKey("REALME C100 5G 4/128GB"), null);
  assert.equal(focusStockKey("H/S,REALME,C100,4G,4/128GB,BLACK"), "realme-c100-4g-4-128");
  assert.equal(focusStockKey("H/S,REALME,C100,5G,4/128GB,BLOOM PURPLE"), null);
  assert.equal(focusSalesKey("TECNO POP 20 4G 4/128GB"), "tecno-pop20");
  assert.equal(focusSalesKey("TECNO POP 20"), "tecno-pop20");
  assert.equal(focusSalesKey("TECNO POP 20 PRO 4G 4/128GB"), null);
  assert.equal(focusStockKey("H/S,TECNO,POP 20,4G,4/128GB,BLACK"), "tecno-pop20");
  assert.equal(focusStockKey("H/S,TECNO,POP 20 PRO,4G,4/128GB,BLACK"), null);
  assert.equal(focusStockKey("ACC,TECNO,POP 20,CASE"), null);
});

test("focus order pins Samsung, groups brands by sales, and responds to the metric", () => {
  const rows = [
    {brand:"OPPO",id:1,total:{qty:3,net:900}},
    {brand:"VIVO",id:2,total:{qty:5,net:100}},
    {brand:"SAMSUNG",id:3,total:{qty:0,net:0}},
    {brand:"OPPO",id:4,total:{qty:3,net:800}},
    {brand:"VIVO",id:5,total:{qty:2,net:100}},
    {brand:"SAMSUNG",id:6,total:{qty:1,net:10}},
    {brand:"TECNO",id:7,total:{qty:0,net:0}},
  ];
  assert.deepEqual(sortFocusBySales(rows,"qty").map(r=>r.id),[6,3,2,5,1,4,7]);
  assert.deepEqual(sortFocusBySales(rows,"net").map(r=>r.id),[6,3,1,4,2,5,7]);
  assert.deepEqual(rows.map(r=>r.id),[1,2,3,4,5,6,7]);
});
