import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/brand-executive-insights.ts", import.meta.url), "utf8");
const javascript = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
}).outputText;
const moduleUrl = `data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`;
const { analyzeBrandExecutive } = await import(moduleUrl);

const brands = [
  { brand: "A", target: 100, actual: 120, achievement: 120, wow: 20, activeShops: 3, totalShops: 4, hasTarget: true },
  { brand: "B", target: 100, actual: 90, achievement: 90, wow: -10, activeShops: 2, totalShops: 4, hasTarget: true },
  { brand: "C", target: 100, actual: 40, achievement: 40, wow: -35, activeShops: 1, totalShops: 4, hasTarget: true },
  { brand: "D", target: 0, actual: 0, achievement: null, wow: null, activeShops: 0, totalShops: 4, hasTarget: false },
];

const shops = [
  { code: "S1", shop: "Top Shop", target: 100, actual: 110, achievement: 110, noSalesBrands: 1, totalBrands: 4 },
  { code: "S2", shop: "Risk Shop", target: 100, actual: 30, achievement: 30, noSalesBrands: 3, totalBrands: 4 },
];

test("achievement bands exclude brands without a target", () => {
  const result = analyzeBrandExecutive(brands, shops);
  assert.equal(result.targetBrands, 3);
  assert.deepEqual(result.achieved.map((row) => row.brand), ["A"]);
  assert.deepEqual(result.nearTarget.map((row) => row.brand), ["B"]);
  assert.deepEqual(result.underFifty.map((row) => row.brand), ["C"]);
  assert.deepEqual(result.noSales.map((row) => row.brand), ["D"]);
});

test("top and risk signals select the correct brand and shop", () => {
  const result = analyzeBrandExecutive(brands, shops);
  assert.equal(result.topActual.brand, "A");
  assert.equal(result.topAchievement.brand, "A");
  assert.equal(result.topGrowth.brand, "A");
  assert.equal(result.biggestDecline.brand, "C");
  assert.equal(result.topShop.shop, "Top Shop");
  assert.equal(result.riskShop.shop, "Risk Shop");
});

test("best and risk shop are not the same when alternatives exist", () => {
  const result = analyzeBrandExecutive(brands, [
    { code: "S1", shop: "Top Shop", target: 100, actual: 140, achievement: 140, noSalesBrands: 4, totalBrands: 4 },
    { code: "S2", shop: "Alternative Risk", target: 100, actual: 35, achievement: 35, noSalesBrands: 3, totalBrands: 4 },
  ]);
  assert.equal(result.topShop.shop, "Top Shop");
  assert.equal(result.riskShop.shop, "Alternative Risk");
});
