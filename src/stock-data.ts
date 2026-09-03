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

export type FocusStockKey =
  | "samsung-a06-5g"
  | "oppo-a6c"
  | "vivo-y05"
  | "xiaomi-redmi-a7-pro"
  | "honor-x5c"
  | "infinix-smart20"
  | "realme-note80";

function findHeader(headers: string[], aliases: string[]) {
  const normalized = headers.map((header) => header.trim().toUpperCase());
  return aliases.map((alias) => normalized.indexOf(alias.toUpperCase())).find((index) => index >= 0) ?? -1;
}

function numeric(value: string | undefined) {
  const cleaned = String(value ?? "").replace(/[^0-9.-]/g, "");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function focusStockKey(model: string): FocusStockKey | null {
  const normalized = model.trim().toUpperCase().replace(/\s+/g, " ");
  if (normalized.includes("GALAXY A06 5G")) return "samsung-a06-5g";
  if (normalized.includes("OPPO A6C")) return "oppo-a6c";
  if (normalized.includes("VIVO Y05")) return "vivo-y05";
  if (normalized.includes("REDMI A7 PRO")) return "xiaomi-redmi-a7-pro";
  if (normalized.includes("HONOR X5C")) return "honor-x5c";
  if (/INFINIX SMART\s*20/.test(normalized)) return "infinix-smart20";
  if (/REALME NOTE\s*80/.test(normalized)) return "realme-note80";
  return null;
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
  })).filter((row) => row.code && row.shop && row.model && focusStockKey(row.model) && row.balance > 0);
}
