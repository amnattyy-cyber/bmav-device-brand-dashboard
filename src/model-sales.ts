export type ModelSale = {
  date: string;
  code: string;
  shop: string;
  brand: string;
  model: string;
  qty: number;
  net: number;
};

export type ModelShopInsight = {
  label: "No Sales MTD" | "No Sales Week" | "New Sales" | "Growth" | "Decline" | "Stable";
  action: string;
  tone: "growth" | "decline" | "flat";
};

export function modelShopInsight(current: number, previous: number, mtd: number): ModelShopInsight {
  if (current === 0 && mtd === 0) return { label: "No Sales MTD", action: "เร่งเปิดยอดรุ่นนี้", tone: "flat" };
  if (current === 0) return { label: "No Sales Week", action: "เร่งกลับมาทำยอด", tone: "decline" };
  if (previous === 0) return { label: "New Sales", action: "ต่อยอดสาขาเริ่มขาย", tone: "growth" };
  if (current > previous) return { label: "Growth", action: "รักษาแรงขาย", tone: "growth" };
  if (current < previous) return { label: "Decline", action: "เร่งกู้ยอด WoW", tone: "decline" };
  return { label: "Stable", action: "ติดตามและเพิ่มยอด", tone: "flat" };
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        value += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(value);
      value = "";
    } else if (character === "\n") {
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
    } else if (character !== "\r") {
      value += character;
    }
  }

  if (value || row.length) {
    row.push(value);
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ""));
}

function numeric(value: string | undefined) {
  const cleaned = String(value ?? "").replace(/[^0-9.-]/g, "");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function dateIso(value: string | undefined) {
  const input = String(value ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) return input;
  const gvizDate = input.match(/^Date\((\d{4}),(\d{1,2}),(\d{1,2})\)$/);
  if (gvizDate) {
    const [, year, zeroBasedMonth, day] = gvizDate;
    return `${year}-${String(Number(zeroBasedMonth) + 1).padStart(2, "0")}-${day.padStart(2, "0")}`;
  }
  const slashDate = input.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (slashDate) {
    const [, day, month, year] = slashDate;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }
  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) return "";
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}`;
}

function findHeader(headers: string[], aliases: string[]) {
  const normalized = headers.map((header) => header.trim().toLowerCase());
  return aliases.map((alias) => normalized.indexOf(alias.toLowerCase())).find((index) => index >= 0) ?? -1;
}

export function parseModelSalesTable(table: string[][]): ModelSale[] {
  if (table.length < 2) return [];
  const headers = table[0];
  const date = findHeader(headers, ["Sales Date", "Date"]);
  const code = findHeader(headers, ["Shop Code", "Code"]);
  const shop = findHeader(headers, ["Shop Name", "Shop"]);
  const brand = findHeader(headers, ["Brand"]);
  const summedQty = findHeader(headers, ["Sum of QTY", "Total Qty"]);
  const modelByName = findHeader(headers, ["Model", "Model Name", "Product Model"]);
  // Daily_Sales_Model currently labels the model-name column as "Qty" and
  // stores the numeric quantity in "Sum of QTY". Keep the reader compatible
  // with both that live layout and a future corrected "Model" header.
  const model = modelByName >= 0 ? modelByName : summedQty >= 0 ? findHeader(headers, ["Qty"]) : -1;
  const qty = summedQty >= 0 ? summedQty : findHeader(headers, ["Qty", "Quantity"]);
  const net = findHeader(headers, ["Sum of NET_AMOUNT", "Net Amount", "NET_AMOUNT", "Net"]);
  const required = { date, code, shop, brand, model, qty, net };
  const missing = Object.entries(required).filter(([, index]) => index < 0).map(([name]) => name);
  if (missing.length) throw new Error(`Missing Daily_Sales_Model column: ${missing.join(", ")}`);

  return table.slice(1).map((row) => ({
    date: dateIso(row[date]),
    code: String(row[code] ?? "").trim(),
    shop: String(row[shop] ?? "").trim(),
    brand: String(row[brand] ?? "").trim().toUpperCase(),
    model: String(row[model] ?? "").trim(),
    qty: numeric(row[qty]),
    net: numeric(row[net]),
  })).filter((row) => row.date && row.code && row.brand && row.model && (row.qty !== 0 || row.net !== 0));
}

export const modelSaleKey = (sale: Pick<ModelSale, "brand" | "model">) => `${sale.brand}|${sale.model}`;
