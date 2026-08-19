import fallbackJson from "./dashboard-data.json";

export type DataRow = {
  brand?: string;
  code?: string;
  shop?: string;
  targetQty: number;
  targetNet: number;
  dailyQty: number[];
  dailyNet: number[];
  previousDailyQty?: number[];
  previousDailyNet?: number[];
};

export type BrandRow = DataRow & { brand: string };
export type ShopRow = DataRow & { brand: string; code: string; shop: string };
export type DashboardData = {
  area: string;
  month: string;
  latest: string;
  totals: DataRow;
  brands: BrandRow[];
  shops: ShopRow[];
  comparison?: unknown;
};

export const fallbackData = fallbackJson as DashboardData;

const GOOGLE_SHEET_ID = "1qsVJk2DbXW8EInVK7gFIOtCB9-5GdVp5vJhU4hPK29k";
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

export const sheetRefreshInterval = REFRESH_INTERVAL_MS;

type GvizCell = { v?: string | number | null; f?: string | null } | null;
type GvizResponse = {
  status: string;
  errors?: Array<{ message?: string; detailed_message?: string }>;
  table?: {
    cols: Array<{ label?: string }>;
    rows: Array<{ c: GvizCell[] }>;
  };
};

export function gvizToRows(response: GvizResponse): string[][] {
  if (response.status !== "ok" || !response.table) {
    const detail = response.errors?.[0]?.detailed_message || response.errors?.[0]?.message || "Unknown Google Sheet error";
    throw new Error(detail);
  }
  const headers = response.table.cols.map((column) => column.label ?? "");
  const rows = response.table.rows.map((row) => headers.map((_, index) => {
    const cell = row.c[index];
    return String(cell?.f ?? cell?.v ?? "");
  }));
  return [headers, ...rows];
}

function numeric(value: string | undefined) {
  const cleaned = String(value ?? "").replace(/[^0-9.-]/g, "");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function dateIso(value: string | undefined) {
  const input = String(value ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) return input;
  const thaiMatch = input.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (thaiMatch) {
    const [, day, month, year] = thaiMatch;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }
  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) return "";
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}`;
}

function headerIndex(headers: string[], name: string) {
  const index = headers.findIndex((header) => header.trim().toLowerCase() === name.toLowerCase());
  if (index < 0) throw new Error(`Missing Google Sheet column: ${name}`);
  return index;
}

function emptyRow(days: number): DataRow {
  return {
    targetQty: 0,
    targetNet: 0,
    dailyQty: Array(days).fill(0),
    dailyNet: Array(days).fill(0),
    previousDailyQty: Array(days).fill(0),
    previousDailyNet: Array(days).fill(0),
  };
}

function combineRows(rows: DataRow[], days: number): DataRow {
  return rows.reduce((total, row) => ({
    targetQty: total.targetQty + row.targetQty,
    targetNet: total.targetNet + row.targetNet,
    dailyQty: total.dailyQty.map((value, index) => value + (row.dailyQty[index] || 0)),
    dailyNet: total.dailyNet.map((value, index) => value + (row.dailyNet[index] || 0)),
    previousDailyQty: total.previousDailyQty?.map((value, index) => value + (row.previousDailyQty?.[index] || 0)),
    previousDailyNet: total.previousDailyNet?.map((value, index) => value + (row.previousDailyNet?.[index] || 0)),
  }), emptyRow(days));
}

async function fetchSheet(sheetName: string): Promise<string[][]> {
  const callbackName = `bmavSheet_${sheetName}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const query = new URLSearchParams({
    tqx: `out:json;responseHandler:${callbackName}`,
    sheet: sheetName,
    _: String(Date.now()),
  });
  const callbackHost = window as unknown as Record<string, ((response: GvizResponse) => void) | undefined>;

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    const cleanup = () => {
      window.clearTimeout(timeout);
      delete callbackHost[callbackName];
      script.remove();
    };
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error(`Google Sheet ${sheetName} timed out`));
    }, 20_000);

    callbackHost[callbackName] = (response) => {
      try {
        resolve(gvizToRows(response));
      } catch (error) {
        reject(error);
      } finally {
        cleanup();
      }
    };
    script.onerror = () => {
      cleanup();
      reject(new Error(`Google Sheet ${sheetName} could not be loaded`));
    };
    script.src = `https://docs.google.com/spreadsheets/d/${GOOGLE_SHEET_ID}/gviz/tq?${query}`;
    script.async = true;
    document.head.appendChild(script);
  });
}

export async function loadGoogleSheetData(): Promise<DashboardData> {
  const [salesTable, targetTable] = await Promise.all([fetchSheet("Daily_Sales"), fetchSheet("Target_Brand")]);
  if (salesTable.length < 2 || targetTable.length < 2) throw new Error("Google Sheet has no data rows");

  const salesHeader = salesTable[0];
  const salesColumns = {
    date: headerIndex(salesHeader, "Sales Date"),
    code: headerIndex(salesHeader, "Shop Code"),
    shop: headerIndex(salesHeader, "Shop Name"),
    brand: headerIndex(salesHeader, "Brand"),
    qty: headerIndex(salesHeader, "Qty"),
    net: headerIndex(salesHeader, "Net Amount"),
  };
  const targetHeader = targetTable[0];
  const targetColumns = {
    code: headerIndex(targetHeader, "Shop Code"),
    shop: headerIndex(targetHeader, "Shop Name"),
    brand: headerIndex(targetHeader, "Brand"),
    qty: headerIndex(targetHeader, "Target Qty"),
    net: headerIndex(targetHeader, "Target Net Amount"),
  };

  const salesRows = salesTable.slice(1).map((row) => ({
    date: dateIso(row[salesColumns.date]),
    code: String(row[salesColumns.code] ?? "").trim(),
    shop: String(row[salesColumns.shop] ?? "").trim(),
    brand: String(row[salesColumns.brand] ?? "").trim().toUpperCase(),
    qty: numeric(row[salesColumns.qty]),
    net: numeric(row[salesColumns.net]),
  })).filter((row) => row.date && row.code && row.brand);
  if (!salesRows.length) throw new Error("Google Sheet has no valid Daily_Sales rows");

  const latest = salesRows.map((row) => row.date).sort().at(-1)!;
  const [year, month] = latest.split("-").map(Number);
  const monthPrefix = latest.slice(0, 7);
  const days = new Date(year, month, 0).getDate();
  const monthName = new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "Asia/Bangkok" }).format(new Date(`${monthPrefix}-01T00:00:00+07:00`));

  const baselineByShop = new Map(fallbackData.shops.map((row) => [`${row.code}|${row.brand}`, row]));
  const targetRows = targetTable.slice(1).map((row) => ({
    code: String(row[targetColumns.code] ?? "").trim(),
    shop: String(row[targetColumns.shop] ?? "").trim(),
    brand: String(row[targetColumns.brand] ?? "").trim().toUpperCase(),
    targetQty: numeric(row[targetColumns.qty]),
    targetNet: numeric(row[targetColumns.net]),
  })).filter((row) => row.code && row.shop && row.brand);
  if (!targetRows.length) throw new Error("Google Sheet has no valid Target_Brand rows");

  const shops: ShopRow[] = targetRows.map((target) => {
    const key = `${target.code}|${target.brand}`;
    const baseline = baselineByShop.get(key);
    const row: ShopRow = {
      ...emptyRow(days),
      ...target,
      previousDailyQty: baseline?.previousDailyQty?.slice(0, days) ?? Array(days).fill(0),
      previousDailyNet: baseline?.previousDailyNet?.slice(0, days) ?? Array(days).fill(0),
    };
    for (const sale of salesRows) {
      if (sale.date.slice(0, 7) !== monthPrefix || sale.code !== row.code || sale.brand !== row.brand) continue;
      const day = Number(sale.date.slice(-2));
      row.dailyQty[day - 1] += sale.qty;
      row.dailyNet[day - 1] += sale.net;
    }
    return row;
  });

  const preferredOrder = fallbackData.brands.map((row) => row.brand);
  const brandNames = [...new Set(shops.map((row) => row.brand))].sort((a, b) => {
    const aIndex = preferredOrder.indexOf(a);
    const bIndex = preferredOrder.indexOf(b);
    return (aIndex < 0 ? 999 : aIndex) - (bIndex < 0 ? 999 : bIndex) || a.localeCompare(b);
  });
  const brands: BrandRow[] = brandNames.map((brand) => ({ brand, ...combineRows(shops.filter((row) => row.brand === brand), days) }));

  return {
    area: fallbackData.area,
    month: monthName,
    latest,
    totals: combineRows(shops, days),
    brands,
    shops,
    comparison: fallbackData.comparison,
  };
}
