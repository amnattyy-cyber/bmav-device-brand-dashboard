export type StockRow = {
  code: string;
  shop: string;
  productCode: string;
  productName: string;
  brand: string;
  model: string;
  balance: number;
  amount: number;
};

export const focusModels = [
  { key: "samsung-a06-5g-4-64", label: "Samsung A06 5G 4/64GB", brand: "SAMSUNG", salesNames: ["GALAXY A06 5G 4/64GB"], stockPrefixes: ["H/S,SS,GALAXY A06,5G,4/64GB"] },
  { key: "vivo-y05-4-64", label: "vivo Y05 4/64GB", brand: "VIVO", salesNames: ["VIVO Y05 4G 4/64GB"], stockPrefixes: ["H/S,VIVO,Y05,4G,4/64"] },
  { key: "xiaomi-redmi-a7-pro-4-128", label: "Xiaomi Redmi A7 Pro 4/128GB", brand: "XIAOMI", salesNames: ["REDMI A7 PRO 4G 4/128GB"], stockPrefixes: ["H/S,XIAOMI,REDMI A7 PRO,4G,4/128GB"] },
  { key: "honor-x5c-plus-4-128", label: "Honor X5c Plus 4/128GB", brand: "HONOR", salesNames: ["HONOR X5C PLUS 4G 4/128GB"], stockPrefixes: ["H/S,HONOR,X5C PLUS,4G,4/128GB"] },
  { key: "infinix-smart20-4-64", label: "Infinix Smart 20 4/64GB", brand: "INFINIX", salesNames: ["INFINIX SMART 20 4G 4/64GB"], stockPrefixes: ["H/S,INFINIX,SMART 20,4G,4/64GB"] },
  { key: "vivo-y31d-6-256", label: "vivo Y31D 6/256GB", brand: "VIVO", salesNames: ["VIVO Y31D 4G 6/256GB"], stockPrefixes: ["H/S,VIVO,Y31D,4G,6/256"] },
  { key: "vivo-y11d-4-128", label: "vivo Y11D 4/128GB", brand: "VIVO", salesNames: ["VIVO Y11D 4G 4/128GB"], stockPrefixes: ["H/S,VIVO,Y11D,4G,4/128"] },
  { key: "oppo-a6c-4-64", label: "OPPO A6C 4/64GB", brand: "OPPO", salesNames: ["OPPO A6C 4G 4/64GB"], stockPrefixes: ["H/S,OPPO,A6C,4G,4/64"] },
  { key: "oppo-a6c-4-128", label: "OPPO A6C 4/128GB", brand: "OPPO", salesNames: ["OPPO A6C 4G 4/128GB"], stockPrefixes: ["H/S,OPPO,A6C,4G,4/128"] },
  { key: "samsung-a07s-4-64", label: "Samsung A07s 4/64GB", brand: "SAMSUNG", salesNames: ["GALAXY A07S 4G 4/64GB"], stockPrefixes: ["H/S,SS,GALAXY A07S,4G,4/64GB"] },
  { key: "infinix-smart20-4-128", label: "Infinix Smart 20 4/128GB", brand: "INFINIX", salesNames: ["INFINIX SMART 20 4G 4/128GB"], stockPrefixes: ["H/S,INFINIX,SMART 20,4G,4/128GB"] },
  { key: "xiaomi-redmi-a7-pro-4-64", label: "Xiaomi Redmi A7 Pro 4/64GB", brand: "XIAOMI", salesNames: ["REDMI A7 PRO 4G 4/64GB"], stockPrefixes: ["H/S,XIAOMI,REDMI A7 PRO,4G,4/64GB"] },
  { key: "realme-c100i-4-128", label: "Realme C100i 4/128GB", brand: "REALME", salesNames: ["REALME C100I 4G 4/128GB"], stockPrefixes: ["H/S,REALME,C100I,4G,4/128GB"] },
  { key: "samsung-a08-4-64", label: "Samsung A08 4/64GB", brand: "SAMSUNG", salesNames: ["GALAXY A08 4G 4/64GB"], stockPrefixes: ["H/S,SS,GALAXY A08,4G,4/64GB"] },
  { key: "realme-note80-4-64", label: "Realme Note 80 4/64GB", brand: "REALME", salesNames: ["REALME NOTE 80 4G 4/64GB"], stockPrefixes: ["H/S,REALME NOTE 80,4G,4/64"] },
] as const;

export type FocusStockKey = typeof focusModels[number]["key"];

function findHeader(headers: string[], aliases: string[]) {
  const normalized = headers.map((header) => header.trim().toUpperCase());
  return aliases.map((alias) => normalized.indexOf(alias.toUpperCase())).find((index) => index >= 0) ?? -1;
}

function numeric(value: string | undefined) {
  const cleaned = String(value ?? "").replace(/[^0-9.-]/g, "");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizedName(value: string) {
  return value.trim().toUpperCase().replace(/\s*,\s*/g, ",").replace(/\s+/g, " ");
}

export function focusSalesKey(model: string): FocusStockKey | null {
  const normalized = normalizedName(model);
  return focusModels.find((definition) => definition.salesNames.some((name) => normalized === name))?.key ?? null;
}

export function focusStockKey(productName: string): FocusStockKey | null {
  const normalized = normalizedName(productName);
  if (!normalized.startsWith("H/S,")) return null;
  return focusModels.find((definition) => definition.stockPrefixes.some((prefix) => normalized === prefix || normalized.startsWith(`${prefix},`)))?.key ?? null;
}

export function parseStockTable(table: string[][]): StockRow[] {
  if (table.length < 2) return [];
  const headers = table[0];
  const columns = {
    code: findHeader(headers, ["SHOP_CODE", "SHOP CODE"]),
    shop: findHeader(headers, ["SHOP", "SHOP_NAME", "SHOP NAME"]),
    productCode: findHeader(headers, ["PRODUCT_CODE", "PRODUCT CODE"]),
    productName: findHeader(headers, ["PRODUCT_NAME", "PRODUCT NAME"]),
    brand: findHeader(headers, ["BRAND"]),
    model: findHeader(headers, ["CUSTOM_MODEL", "MODEL"]),
    balance: findHeader(headers, ["BALANCE", "STOCK", "STOCK QTY"]),
    amount: findHeader(headers, ["AMOUNT", "STOCK AMOUNT"]),
  };
  const missing = Object.entries(columns).filter(([, index]) => index < 0).map(([name]) => name);
  if (missing.length) throw new Error(`Missing Data Stock column: ${missing.join(", ")}`);

  return table.slice(1).map((row) => ({
    code: String(row[columns.code] ?? "").trim(),
    shop: String(row[columns.shop] ?? "").trim(),
    productCode: String(row[columns.productCode] ?? "").trim(),
    productName: String(row[columns.productName] ?? "").trim(),
    brand: String(row[columns.brand] ?? "").trim().toUpperCase(),
    model: String(row[columns.model] ?? "").trim(),
    balance: numeric(row[columns.balance]),
    amount: numeric(row[columns.amount]),
  })).filter((row) => row.code && row.shop && row.model && focusStockKey(row.productName) && row.balance > 0);
}
