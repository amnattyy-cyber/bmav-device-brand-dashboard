"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { dashboardForMonth, dashboardMonths, fallbackData, loadGoogleSheetData, sheetRefreshInterval, type DailySale, type DataRow } from "./google-sheet-data";
import { clampModelSalesDateRange, modelSaleKey, modelShopInsight, summarizeModelSales } from "./model-sales";
import { focusStockKey } from "./stock-data";
import { comparableWeekPeriod, previousWeekId, shortDateRange, weekDataStatus, weekIndexForDate, weekRanges, wowChangeRate } from "./wow-periods";

type Metric = "net" | "qty";
type ViewMode = "day" | "mtd" | "achieve" | "runrate";
type MatrixRanking = "rank" | "achieve" | "runrate";
type SourceStatus = "loading" | "live" | "fallback";
type ModelTableCapture = "focus-models" | "focus-shops" | "focus-stock" | "overview" | "shop-wow" | "branch" | "top-models" | "daily-sales" | null;
type WeekSnapshot = { net: number; qty: number };
type ViewMetrics = {
  monthlyTarget: number;
  mtdActual: number;
  target: number;
  actual: number;
  previous: number;
  achievement: number;
};

const brandColors: Record<string, string> = {
  IPHONE: "#7c3aed", SAMSUNG: "#2563eb", IPAD: "#8b5cf6", VIVO: "#06b6d4",
  OPPO: "#16a34a", XIAOMI: "#f97316", HUAWEI: "#e11d48", HONOR: "#0891b2",
  INFINIX: "#65a30d", NOTHING: "#111827", REALME: "#eab308", ALLDOCUBE: "#64748b",
};

const focusModels = [
  { key: "samsung-a06-5g", label: "Samsung A06 5G", brand: "SAMSUNG", match: (model: string) => /GALAXY A06 5G/i.test(model) },
  { key: "oppo-a6c", label: "OPPO A6C", brand: "OPPO", match: (model: string) => /OPPO A6C/i.test(model) },
  { key: "vivo-y05", label: "vivo Y05", brand: "VIVO", match: (model: string) => /VIVO Y05/i.test(model) },
  { key: "xiaomi-redmi-a7-pro", label: "Xiaomi Redmi A7 Pro", brand: "XIAOMI", match: (model: string) => /REDMI A7 PRO/i.test(model) },
  { key: "honor-x5c", label: "Honor X5c", brand: "HONOR", match: (model: string) => /HONOR X5C/i.test(model) },
  { key: "infinix-smart20", label: "Infinix Smart20", brand: "INFINIX", match: (model: string) => /INFINIX SMART\s*20/i.test(model) },
  { key: "realme-note80", label: "Realme Note80", brand: "REALME", match: (model: string) => /REALME NOTE\s*80/i.test(model) },
] as const;

const number = new Intl.NumberFormat("th-TH", { maximumFractionDigits: 1 });
const integer = new Intl.NumberFormat("th-TH", { maximumFractionDigits: 0 });
const compactChart = (value: number) => value >= 1_000_000
  ? `${(value / 1_000_000).toFixed(2)}M`
  : value >= 1_000
    ? `${(value / 1_000).toFixed(value >= 100_000 ? 0 : 1)}K`
    : integer.format(value);
const sumTo = (values: number[], day: number) => values.slice(0, day).reduce((sum, value) => sum + value, 0);
const signed = (value: number, digits = 1) => `${value > 0 ? "+" : ""}${value.toFixed(digits)}%`;
const wowRateLabel = (value: number | null) => value == null ? "—" : signed(value);
const wowRateTone = (value: number | null) => value == null ? "neutral" : value >= 0 ? "positive" : "negative";
const comparisonTone = (value: number | null) => value == null || value === 0 ? "flat" : value > 0 ? "growth" : "decline";
const signedInteger = (value: number) => `${value > 0 ? "+" : ""}${integer.format(value)}`;
const salesSnapshot = (sales: DailySale[], start: string, end: string | null): WeekSnapshot => {
  if (!end) return { net: 0, qty: 0 };
  return sales.reduce((total, sale) => sale.date >= start && sale.date <= end
    ? { net: total.net + sale.net, qty: total.qty + sale.qty }
    : total, { net: 0, qty: 0 });
};
const shiftIsoDate = (date: string, days: number) => {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};
const isoDateRange = (start: string, end: string | null) => {
  if (!end || end < start) return [];
  const dates: string[] = [];
  for (let date = start; date <= end; date = shiftIsoDate(date, 1)) dates.push(date);
  return dates;
};
const compactDate = (date: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(new Date(`${date}T00:00:00Z`));

const emptyRow = (): DataRow => ({ targetQty: 0, targetNet: 0, dailyQty: Array(31).fill(0), dailyNet: Array(31).fill(0), previousDailyQty: Array(31).fill(0), previousDailyNet: Array(31).fill(0) });
const combineRows = (rows: DataRow[]): DataRow => rows.reduce((total, row) => ({
  targetQty: total.targetQty + row.targetQty,
  targetNet: total.targetNet + row.targetNet,
  dailyQty: total.dailyQty.map((value, index) => value + (row.dailyQty[index] || 0)),
  dailyNet: total.dailyNet.map((value, index) => value + (row.dailyNet[index] || 0)),
  previousDailyQty: total.previousDailyQty?.map((value, index) => value + (row.previousDailyQty?.[index] || 0)),
  previousDailyNet: total.previousDailyNet?.map((value, index) => value + (row.previousDailyNet?.[index] || 0)),
}), emptyRow());

function tone(value: number) {
  if (value >= 100) return "great";
  if (value >= 70) return "good";
  if (value >= 40) return "watch";
  return "risk";
}

function momLabel(current: number, previous: number) {
  if (!previous) return current > 0 ? "NEW" : "—";
  const value = ((current - previous) / previous) * 100;
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function momTone(current: number, previous: number) {
  if (!previous) return current > 0 ? "mom-new" : "mom-neutral";
  return current >= previous ? "mom-up" : "mom-down";
}

export default function Home() {
  const [sourceData, setSourceData] = useState(fallbackData);
  const [selectedMonth, setSelectedMonth] = useState(fallbackData.latest.slice(0, 7));
  const availableMonths = useMemo(() => dashboardMonths(sourceData), [sourceData]);
  const data = useMemo(() => dashboardForMonth(sourceData, selectedMonth), [selectedMonth, sourceData]);
  const [sourceStatus, setSourceStatus] = useState<SourceStatus>("loading");
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [metric, setMetric] = useState<Metric>("net");
  const [brandWowSort, setBrandWowSort] = useState<Metric>("net");
  const [shopBrandWowBrand, setShopBrandWowBrand] = useState("IPHONE");
  const [shopBrandWowSort, setShopBrandWowSort] = useState<Metric>("net");
  const [modelBrand, setModelBrand] = useState("SAMSUNG");
  const [modelQuery, setModelQuery] = useState("");
  const [selectedModelKeys, setSelectedModelKeys] = useState<string[]>([]);
  const [modelSalesRange, setModelSalesRange] = useState({ start: fallbackData.latest, end: fallbackData.latest });
  const [modelSort, setModelSort] = useState<Metric>("net");
  const [viewMode, setViewMode] = useState<ViewMode>("mtd");
  const [selectedBrand, setSelectedBrand] = useState("ALL");
  const [selectedShops, setSelectedShops] = useState<string[]>([]);
  const [selectedDay, setSelectedDay] = useState(Number(fallbackData.latest.slice(-2)));
  const [selectedWeek, setSelectedWeek] = useState(weekIndexForDate(fallbackData.latest));
  const [matrixRanking, setMatrixRanking] = useState<MatrixRanking>("rank");
  const [matrixSortBrand, setMatrixSortBrand] = useState("ALL");
  const [matrixCapture, setMatrixCapture] = useState(false);
  const [modelTableCapture, setModelTableCapture] = useState<ModelTableCapture>(null);
  const hasLoadedLiveData = useRef(false);
  const previousLatestDate = useRef(fallbackData.latest);
  const previousModelSalesLatestDate = useRef(fallbackData.latest);
  const latestDay = Number(data.latest.slice(-2));
  const monthPrefix = data.latest.slice(0, 7);
  const [yearNumber, monthNumber] = monthPrefix.split("-").map(Number);
  const daysInMonth = new Date(yearNumber, monthNumber, 0).getDate();
  const previousMonthDays = new Date(yearNumber, monthNumber - 1, 0).getDate();
  const shortMonth = new Intl.DateTimeFormat("en-GB", { month: "short" }).format(new Date(`${monthPrefix}-01T00:00:00Z`));
  const previousMonthName = new Intl.DateTimeFormat("en-GB", { month: "short" }).format(new Date(Date.UTC(yearNumber, monthNumber - 2, 1)));
  const visibleWeekRanges = weekRanges.map((range, index) => ({ range, index })).filter(({ range }) => range.start.slice(0, 7) === monthPrefix || range.end.slice(0, 7) === monthPrefix);
  const formatDate = useCallback((day: number) => `${monthPrefix}-${String(day).padStart(2, "0")}`, [monthPrefix]);
  const thaiDate = useCallback((day: number) => new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", year: "numeric" }).format(new Date(`${formatDate(day)}T00:00:00+07:00`)), [formatDate]);

  const refreshData = useCallback(async () => {
    try {
      const liveData = await loadGoogleSheetData();
      setSourceData(liveData);
      setSelectedMonth((current) => {
        const next = !hasLoadedLiveData.current || !dashboardMonths(liveData).includes(current) ? liveData.latest.slice(0, 7) : current;
        hasLoadedLiveData.current = true;
        return next;
      });
      setSourceStatus("live");
      setLastSync(new Date());
    } catch (error) {
      console.warn("Google Sheet refresh failed; using the latest bundled dashboard data.", error);
      setSourceStatus("fallback");
    }
  }, []);

  useEffect(() => {
    void refreshData();
    const timer = window.setInterval(() => void refreshData(), sheetRefreshInterval);
    return () => window.clearInterval(timer);
  }, [refreshData]);

  useEffect(() => {
    const priorLatestDate = previousLatestDate.current;
    const priorLatestDay = Number(priorLatestDate.slice(-2));
    setSelectedDay((current) => current === priorLatestDay ? latestDay : Math.min(current, latestDay));
    setSelectedWeek((current) => current === weekIndexForDate(priorLatestDate) ? weekIndexForDate(data.latest) : current);
    previousLatestDate.current = data.latest;
  }, [data.latest, latestDay]);

  useEffect(() => {
    if (!matrixCapture && !modelTableCapture) return;
    const exitCapture = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMatrixCapture(false);
        setModelTableCapture(null);
      }
    };
    window.addEventListener("keydown", exitCapture);
    return () => window.removeEventListener("keydown", exitCapture);
  }, [matrixCapture, modelTableCapture]);

  const shopOptions = useMemo(() => {
    const rows = (selectedBrand === "ALL" ? data.shops : data.shops.filter((row) => row.brand === selectedBrand))
      .filter((row) => row.targetQty > 0 || row.targetNet > 0 || sumTo(row.dailyQty, latestDay) > 0 || sumTo(row.dailyNet, latestDay) > 0);
    return [...new Map(rows.map((row) => [row.code, row.shop])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [data.shops, latestDay, selectedBrand]);

  const modelShopOptions = useMemo(() => {
    const shops = new Map<string, string>();
    data.shops.forEach((row) => shops.set(row.code, row.shop));
    data.modelSales.forEach((row) => shops.set(row.code, row.shop || shops.get(row.code) || row.code));
    return [...shops.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [data.modelSales, data.shops]);

  const chooseBrand = (brand: string) => {
    setSelectedBrand(brand);
    setSelectedShops((current) => current.filter((code) => data.shops.some((row) => row.code === code && (brand === "ALL" || row.brand === brand))));
  };

  const toggleShop = (code: string) => {
    setSelectedShops((current) => current.includes(code) ? current.filter((item) => item !== code) : [...current, code]);
  };

  const scopeRow = useMemo<DataRow>(() => {
    const rows = data.shops.filter((row) => (selectedBrand === "ALL" || row.brand === selectedBrand) && (selectedShops.length === 0 || selectedShops.includes(row.code)));
    return combineRows(rows);
  }, [data.shops, selectedBrand, selectedShops]);

  const dailyValues = metric === "net" ? scopeRow.dailyNet : scopeRow.dailyQty;
  const getViewMetrics = useCallback((row: DataRow): ViewMetrics => {
    const monthlyTarget = metric === "net" ? row.targetNet : row.targetQty;
    const values = metric === "net" ? row.dailyNet : row.dailyQty;
    const previousValues = metric === "net" ? (row.previousDailyNet ?? []) : (row.previousDailyQty ?? []);
    const mtdActual = sumTo(values, selectedDay);
    const previousMtd = sumTo(previousValues, Math.min(selectedDay, previousMonthDays));
    const targetToDate = (monthlyTarget / daysInMonth) * selectedDay;
    const dailyTarget = monthlyTarget / daysInMonth;
    const dailyActual = values[selectedDay - 1] || 0;
    const previousDaily = previousValues[selectedDay - 1] || 0;
    const runRate = selectedDay ? (mtdActual / selectedDay) * daysInMonth : 0;
    const previousRunRate = selectedDay ? (previousMtd / Math.min(selectedDay, previousMonthDays)) * previousMonthDays : 0;

    const view = viewMode === "day"
      ? { target: dailyTarget, actual: dailyActual, previous: previousDaily }
      : viewMode === "runrate"
        ? { target: monthlyTarget, actual: runRate, previous: previousRunRate }
        : { target: targetToDate, actual: mtdActual, previous: previousMtd };

    return {
      monthlyTarget,
      mtdActual,
      ...view,
      achievement: view.target ? (view.actual / view.target) * 100 : 0,
    };
  }, [daysInMonth, metric, previousMonthDays, selectedDay, viewMode]);

  const scopeMetrics = getViewMetrics(scopeRow);
  const { target, actual, achievement } = scopeMetrics;
  const metricLabel = metric === "net" ? "Net Amount" : "Quantity";
  const unit = metric === "net" ? "บาท" : "เครื่อง";
  const displayValue = (value: number) => metric === "net" ? `฿${integer.format(value)}` : number.format(value);
  const tableValue = (value: number) => metric === "net" ? integer.format(value) : number.format(value);
  const modeCopy = {
    day: { title: "Daily", target: "Target Daily", actual: "Actual Daily", achievement: "Daily Achievement", gap: "Daily Gap", short: "DAILY" },
    mtd: { title: "MTD", target: "Target to Date", actual: "Actual MTD", achievement: "Achieve to Date", gap: "MTD Gap", short: "MTD" },
    achieve: { title: "Achieve TD", target: "Target to Date", actual: "Actual to Date", achievement: "Achieve to Date", gap: "Gap to Date", short: "ACHIEVE TD" },
    runrate: { title: "Run Rate", target: "Monthly Target", actual: "Run Rate Forecast", achievement: "Projected Achievement", gap: "Forecast Gap", short: "RUN RATE" },
  }[viewMode];

  const brandViews = useMemo(() => data.brands.map((brand) => {
    const rows = data.shops.filter((shop) => shop.brand === brand.brand && (selectedShops.length === 0 || selectedShops.includes(shop.code)));
    const row: DataRow = combineRows(rows);
    const view = getViewMetrics(row);
    return { ...brand, viewTarget: view.target, viewActual: view.actual, viewPrevious: view.previous, viewAchievement: view.achievement, hasTarget: view.monthlyTarget > 0, hasSales: view.mtdActual > 0 };
  }).filter((row) => row.hasTarget || row.hasSales), [data.brands, data.shops, getViewMetrics, selectedShops]);

  const shopViews = useMemo(() => {
    const rows: DataRow[] = selectedBrand === "ALL"
      ? [...new Set(data.shops.map((row) => row.code))].map((code) => {
          const items = data.shops.filter((row) => row.code === code);
          return { ...combineRows(items), code, shop: items[0]?.shop ?? code };
        })
      : data.shops.filter((row) => row.brand === selectedBrand);
    return rows
      .filter((row) => selectedShops.length === 0 || selectedShops.includes(String(row.code)))
      .map((row) => {
        const view = getViewMetrics(row);
        return { ...row, viewTarget: view.target, viewActual: view.actual, viewPrevious: view.previous, viewAchievement: view.achievement, hasTarget: view.monthlyTarget > 0, hasSales: view.mtdActual > 0 };
      })
      .filter((row) => row.hasTarget || row.hasSales)
      .sort((a, b) => viewMode === "mtd" || viewMode === "day" ? b.viewActual - a.viewActual : b.viewAchievement - a.viewAchievement);
  }, [data.shops, getViewMetrics, selectedBrand, selectedShops, viewMode]);

  const trend = useMemo(() => Array.from({ length: selectedDay }, (_, index) => ({
    day: index + 1,
    actual: dailyValues[index] || 0,
  })), [dailyValues, selectedDay]);
  const trendMax = Math.max(...trend.map((item) => item.actual), 1);
  const trendTotal = sumTo(dailyValues, selectedDay);
  const selectedColor = selectedBrand === "ALL" ? "#7c3aed" : brandColors[selectedBrand] ?? "#7c3aed";
  const selectedShopNames = shopOptions.filter(([code]) => selectedShops.includes(code)).map(([, shop]) => shop);
  const shopName = selectedShops.length === 0 ? "ทุกสาขา" : selectedShops.length === 1 ? selectedShopNames[0] ?? "1 สาขาที่เลือก" : `${selectedShops.length} สาขาที่เลือก`;
  const scoreRingLabel = viewMode === "runrate" ? "PROJECTED ACHIEVE" : viewMode === "achieve" ? "ACHIEVE TO DATE" : `${modeCopy.short} ACHIEVEMENT`;

  const wow = useMemo(() => {
    const range = weekRanges[selectedWeek];
    const period = comparableWeekPeriod(range, data.latest);
    const snapshot = (rows: DailySale[], previous = false) => previous
      ? salesSnapshot(rows, period.baseStart, period.baseEnd)
      : salesSnapshot(rows, period.currentStart, period.currentEnd);
    const rows = data.sales.filter((sale) => (selectedBrand === "ALL" || sale.brand === selectedBrand) && (selectedShops.length === 0 || selectedShops.includes(sale.code)));
    const overallRows = data.sales.filter((sale) => selectedShops.length === 0 || selectedShops.includes(sale.code));
    const current = snapshot(rows);
    const previous = snapshot(rows, true);
    const overallCurrentNet = snapshot(overallRows).net;
    const overallPreviousNet = snapshot(overallRows, true).net;
    const decorate = (name: string, scopedSales: DailySale[]) => {
      const now = snapshot(scopedSales);
      const before = snapshot(scopedSales, true);
      const currentShare = overallCurrentNet ? (now.net / overallCurrentNet) * 100 : 0;
      const previousShare = overallPreviousNet ? (before.net / overallPreviousNet) * 100 : 0;
      return { name, current: now, previous: before, deltaNet: now.net - before.net, deltaQty: now.qty - before.qty, currentShare, shareDelta: currentShare - previousShare };
    };
    const brandDrivers = [...new Set(rows.map((sale) => sale.brand))].map((brand) => decorate(brand, rows.filter((sale) => sale.brand === brand))).sort((a, b) => b.deltaNet - a.deltaNet);
    const shopDrivers = [...new Set(rows.map((sale) => sale.code))].map((code) => {
      const items = rows.filter((sale) => sale.code === code);
      return decorate(items[0]?.shop ?? code, items);
    }).sort((a, b) => b.deltaNet - a.deltaNet);
    const netRate = wowChangeRate(current.net, previous.net);
    const qtyRate = wowChangeRate(current.qty, previous.qty);
    const currentAsp = current.qty ? current.net / current.qty : 0;
    const previousAsp = previous.qty ? previous.net / previous.qty : 0;
    const aspRate = wowChangeRate(currentAsp, previousAsp);
    const leadBrand = netRate == null || netRate >= 0 ? brandDrivers[0] : brandDrivers.at(-1);
    const leadShop = netRate == null || netRate >= 0 ? shopDrivers[0] : shopDrivers.at(-1);
    const direction = netRate == null ? "ไม่มีฐานเปรียบเทียบ" : netRate >= 0 ? "เติบโต" : "ชะลอ";
    const cause = netRate == null || qtyRate == null || aspRate == null
      ? "ฐานเปรียบเทียบยังไม่เพียงพอสำหรับคำนวณอัตรา WoW"
      : Math.abs(qtyRate) >= Math.abs(aspRate) ? `QTY ${signed(qtyRate)} เป็นสัญญาณหลัก` : `มูลค่าต่อเครื่อง ${signed(aspRate)} เป็นสัญญาณหลัก`;
    const action = netRate == null
      ? "ตรวจความครบถ้วนของข้อมูลฐานก่อนสรุปแนวโน้ม และใช้ยอดจริงเป็นข้อมูลตั้งต้น"
      : netRate < 0
      ? `เร่งกู้ยอดที่ ${leadShop?.name ?? "สาขาที่ติดลบ"} โดยโฟกัส ${leadBrand?.name ?? "Brand ที่ลดลง"}; ${(qtyRate ?? 0) < 0 ? "เพิ่ม conversion และ stock รุ่นขายดี" : "ดัน mix รุ่นมูลค่าสูงและ attach offer"}`
      : `รักษาแรงส่ง ${leadBrand?.name ?? "Brand นำ"} ที่ ${leadShop?.name ?? "สาขานำ"} และถอด playbook ไปยังสาขาที่ contribution ลดลง`;
    return { range, period, current, previous, netRate, qtyRate, currentAsp, previousAsp, aspRate, brandDrivers, shopDrivers, leadBrand, leadShop, direction, cause, action };
  }, [data.latest, data.sales, selectedBrand, selectedShops, selectedWeek]);

  const brandWow = useMemo(() => {
    const range = weekRanges[selectedWeek];
    const period = comparableWeekPeriod(range, data.latest);

    return new Map(data.brands.map(({ brand }) => {
      const rows = data.sales.filter((sale) => sale.brand === brand && (selectedShops.length === 0 || selectedShops.includes(sale.code)));
      const current = salesSnapshot(rows, period.currentStart, period.currentEnd)[metric];
      const previous = salesSnapshot(rows, period.baseStart, period.baseEnd)[metric];
      return [brand, { current, previous, rate: wowChangeRate(current, previous) }] as const;
    }));
  }, [data.brands, data.latest, data.sales, metric, selectedShops, selectedWeek]);

  const allBrandWow = useMemo(() => {
    const range = weekRanges[selectedWeek];
    const period = comparableWeekPeriod(range, data.latest);
    const rows = data.brands.map(({ brand }) => {
      const sales = data.sales.filter((sale) => sale.brand === brand && (selectedShops.length === 0 || selectedShops.includes(sale.code)));
      const current = salesSnapshot(sales, period.currentStart, period.currentEnd);
      const previous = salesSnapshot(sales, period.baseStart, period.baseEnd);
      return {
        brand,
        current,
        previous,
        diffQty: current.qty - previous.qty,
        diffNet: current.net - previous.net,
        qtyRate: wowChangeRate(current.qty, previous.qty),
        netRate: wowChangeRate(current.net, previous.net),
      };
    });
    const totals = rows.reduce((total, row) => ({
      current: { qty: total.current.qty + row.current.qty, net: total.current.net + row.current.net },
      previous: { qty: total.previous.qty + row.previous.qty, net: total.previous.net + row.previous.net },
    }), { current: { qty: 0, net: 0 }, previous: { qty: 0, net: 0 } });
    return {
      range,
      period,
      rows: rows.sort((a, b) => b.current[brandWowSort] - a.current[brandWowSort] || a.brand.localeCompare(b.brand)),
      totals: {
        ...totals,
        diffQty: totals.current.qty - totals.previous.qty,
        diffNet: totals.current.net - totals.previous.net,
        qtyRate: wowChangeRate(totals.current.qty, totals.previous.qty),
        netRate: wowChangeRate(totals.current.net, totals.previous.net),
      },
    };
  }, [brandWowSort, data.brands, data.latest, data.sales, selectedShops, selectedWeek]);

  const shopBrandWow = useMemo(() => {
    const range = weekRanges[selectedWeek];
    const period = comparableWeekPeriod(range, data.latest);
    const brand = data.brands.some((row) => row.brand === shopBrandWowBrand) ? shopBrandWowBrand : data.brands[0]?.brand ?? "IPHONE";
    const shopsByCode = new Map<string, string>();
    data.shops.forEach((row) => shopsByCode.set(row.code, row.shop));
    data.sales.forEach((row) => shopsByCode.set(row.code, row.shop || shopsByCode.get(row.code) || row.code));

    const rows = [...shopsByCode.entries()]
      .filter(([code]) => selectedShops.length === 0 || selectedShops.includes(code))
      .map(([code, shop]) => {
        const target = data.shops.find((row) => row.code === code && row.brand === brand);
        const sales = data.sales.filter((sale) => sale.code === code && sale.brand === brand);
        const current = salesSnapshot(sales, period.currentStart, period.currentEnd);
        const previous = salesSnapshot(sales, period.baseStart, period.baseEnd);
        const targetQty = ((target?.targetQty ?? 0) / daysInMonth) * period.currentDays;
        const targetNet = ((target?.targetNet ?? 0) / daysInMonth) * period.currentDays;
        return {
          code,
          shop,
          current,
          previous,
          targetQty,
          targetNet,
          achievementQty: targetQty > 0 ? (current.qty / targetQty) * 100 : null,
          achievementNet: targetNet > 0 ? (current.net / targetNet) * 100 : null,
          diffQty: current.qty - previous.qty,
          diffNet: current.net - previous.net,
          wowQty: wowChangeRate(current.qty, previous.qty),
          wowNet: wowChangeRate(current.net, previous.net),
          hasTarget: targetQty > 0 || targetNet > 0,
        };
      })
      .sort((a, b) => b.current[shopBrandWowSort] - a.current[shopBrandWowSort] || a.shop.localeCompare(b.shop));

    const totals = rows.reduce((total, row) => ({
      current: { qty: total.current.qty + row.current.qty, net: total.current.net + row.current.net },
      previous: { qty: total.previous.qty + row.previous.qty, net: total.previous.net + row.previous.net },
      targetQty: total.targetQty + row.targetQty,
      targetNet: total.targetNet + row.targetNet,
    }), { current: { qty: 0, net: 0 }, previous: { qty: 0, net: 0 }, targetQty: 0, targetNet: 0 });

    return {
      brand,
      range,
      period,
      previousWeek: previousWeekId(range.id),
      rows,
      totals: {
        ...totals,
        achievementQty: totals.targetQty > 0 ? (totals.current.qty / totals.targetQty) * 100 : null,
        achievementNet: totals.targetNet > 0 ? (totals.current.net / totals.targetNet) * 100 : null,
        diffQty: totals.current.qty - totals.previous.qty,
        diffNet: totals.current.net - totals.previous.net,
        wowQty: wowChangeRate(totals.current.qty, totals.previous.qty),
        wowNet: wowChangeRate(totals.current.net, totals.previous.net),
      },
    };
  }, [data.brands, data.latest, data.sales, data.shops, daysInMonth, selectedShops, selectedWeek, shopBrandWowBrand, shopBrandWowSort]);

  const shopWow = useMemo(() => {
    const range = weekRanges[selectedWeek];
    const period = comparableWeekPeriod(range, data.latest);

    return new Map(shopViews.map((shop) => {
      const rows = data.sales.filter((sale) => sale.code === String(shop.code) && (selectedBrand === "ALL" || sale.brand === selectedBrand));
      const current = salesSnapshot(rows, period.currentStart, period.currentEnd)[metric];
      const previous = salesSnapshot(rows, period.baseStart, period.baseEnd)[metric];
      return [String(shop.code), { current, previous, rate: wowChangeRate(current, previous) }] as const;
    }));
  }, [data.latest, data.sales, metric, selectedBrand, selectedWeek, shopViews]);

  const brandWowChart = useMemo(() => {
    const rows = data.brands.map(({ brand }) => {
      const weekly = brandWow.get(brand);
      return { brand, current: weekly?.current ?? 0, previous: weekly?.previous ?? 0, rate: weekly?.rate ?? null };
    }).filter((item) => item.current > 0 || item.previous > 0);
    const maxMagnitude = Math.max(...rows.map((item) => Math.abs(item.rate ?? 0)), 1);
    return { rows: rows.sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0)), maxMagnitude };
  }, [brandWow, data.brands]);

  const activeWowRate = metric === "net" ? wow.netRate : wow.qtyRate;
  const activeWowTone = activeWowRate == null ? "neutral" : activeWowRate >= 0 ? "up" : "down";

  const modelPerformance = useMemo(() => {
    const range = weekRanges[selectedWeek];
    const period = comparableWeekPeriod(range, data.latest);
    const selectedDate = formatDate(selectedDay);
    const scopedSales = data.modelSales.filter((sale) => selectedShops.length === 0 || selectedShops.includes(sale.code));
    const brandOptions = [...new Set(data.modelSales.map((sale) => sale.brand))].sort((a, b) => a.localeCompare(b));
    const grouped = new Map<string, { key: string; brand: string; model: string; sales: typeof scopedSales }>();
    for (const sale of data.modelSales) {
      const key = modelSaleKey(sale);
      if (!grouped.has(key)) grouped.set(key, { key, brand: sale.brand, model: sale.model, sales: [] });
    }
    for (const sale of scopedSales) {
      grouped.get(modelSaleKey(sale))?.sales.push(sale);
    }
    const normalizedQuery = modelQuery.trim().toLocaleUpperCase();
    const summarize = (item: typeof grouped extends Map<string, infer T> ? T : never) => {
      const daily = salesSnapshot(item.sales, selectedDate, selectedDate);
      const mtd = salesSnapshot(item.sales, `${monthPrefix}-01`, selectedDate);
      const current = salesSnapshot(item.sales, period.currentStart, period.currentEnd);
      const previous = salesSnapshot(item.sales, period.baseStart, period.baseEnd);
      return {
        ...item,
        daily,
        mtd,
        current,
        previous,
        diffQty: current.qty - previous.qty,
        diffNet: current.net - previous.net,
        wowQty: wowChangeRate(current.qty, previous.qty),
        wowNet: wowChangeRate(current.net, previous.net),
        activeShops: new Set(item.sales.filter((sale) => sale.date >= `${monthPrefix}-01` && sale.date <= selectedDate).map((sale) => sale.code)).size,
      };
    };
    const modelOptions = [...grouped.values()]
      .filter((item) => item.brand === modelBrand)
      .map(summarize)
      .sort((a, b) => b.current[modelSort] - a.current[modelSort] || b.mtd[modelSort] - a.mtd[modelSort] || a.model.localeCompare(b.model));
    const selectedKeySet = new Set(selectedModelKeys.length ? selectedModelKeys : modelOptions.map((row) => row.key));
    const rows = modelOptions.filter((row) => selectedKeySet.has(row.key) && (!normalizedQuery || `${row.brand} ${row.model}`.toLocaleUpperCase().includes(normalizedQuery)));

    const shopsByCode = new Map<string, string>();
    data.shops.forEach((row) => shopsByCode.set(row.code, row.shop));
    data.sales.forEach((row) => shopsByCode.set(row.code, row.shop || shopsByCode.get(row.code) || row.code));
    scopedSales.forEach((row) => shopsByCode.set(row.code, row.shop || shopsByCode.get(row.code) || row.code));
    const activeSales = scopedSales.filter((sale) => selectedKeySet.has(modelSaleKey(sale)) && sale.brand === modelBrand);
    const shopRows = [...shopsByCode.entries()]
      .filter(([code]) => selectedShops.length === 0 || selectedShops.includes(code))
      .map(([code, shop]) => {
        const sales = activeSales.filter((sale) => sale.code === code);
        const daily = salesSnapshot(sales, selectedDate, selectedDate);
        const mtd = salesSnapshot(sales, `${monthPrefix}-01`, selectedDate);
        const current = salesSnapshot(sales, period.currentStart, period.currentEnd);
        const previous = salesSnapshot(sales, period.baseStart, period.baseEnd);
        return {
          code,
          shop,
          daily,
          mtd,
          current,
          previous,
          wowQty: wowChangeRate(current.qty, previous.qty),
          wowNet: wowChangeRate(current.net, previous.net),
        };
      })
      .sort((a, b) => b.current[modelSort] - a.current[modelSort] || b.mtd[modelSort] - a.mtd[modelSort] || a.shop.localeCompare(b.shop));
    const branchRows = shopRows.map((row, index) => ({
      ...row,
      rank: index + 1,
      insight: modelShopInsight(row.current[modelSort], row.previous[modelSort], row.mtd[modelSort]),
    }));
    const topShop = branchRows.find((row) => row.current[modelSort] > 0) ?? branchRows[0] ?? null;
    const branchSummary = {
      topShop,
      growth: branchRows.filter((row) => row.insight.tone === "growth").length,
      decline: branchRows.filter((row) => row.insight.tone === "decline").length,
      noSales: branchRows.filter((row) => row.current.qty === 0 && row.current.net === 0).length,
    };
    const trend = Array.from({ length: selectedDay }, (_, index) => {
      const date = formatDate(index + 1);
      return { day: index + 1, ...salesSnapshot(activeSales, date, date) };
    });
    const daily = salesSnapshot(activeSales, selectedDate, selectedDate);
    const mtd = salesSnapshot(activeSales, `${monthPrefix}-01`, selectedDate);
    const current = salesSnapshot(activeSales, period.currentStart, period.currentEnd);
    const previous = salesSnapshot(activeSales, period.baseStart, period.baseEnd);
    return {
      range,
      period,
      previousWeek: previousWeekId(range.id),
      brandOptions,
      modelOptions,
      rows,
      daily,
      mtd,
      current,
      previous,
      wowQty: wowChangeRate(current.qty, previous.qty),
      wowNet: wowChangeRate(current.net, previous.net),
      shopRows: branchRows,
      branchSummary,
      trend,
      sellingShops: shopRows.filter((row) => row.mtd.qty > 0 || row.mtd.net > 0).length,
      totalShops: shopRows.length,
    };
  }, [data.latest, data.modelSales, data.sales, data.shops, formatDate, modelBrand, modelQuery, modelSort, monthPrefix, selectedDay, selectedModelKeys, selectedShops, selectedWeek]);

  const modelSalesDateBounds = useMemo(() => {
    return { min: `${monthPrefix}-01`, max: data.latest };
  }, [data.latest, monthPrefix]);

  useEffect(() => {
    const priorLatest = previousModelSalesLatestDate.current;
    setModelSalesRange((current) => {
      const followsLatest = current.start === priorLatest && current.end === priorLatest;
      const candidate = followsLatest ? { start: data.latest, end: data.latest } : current;
      return clampModelSalesDateRange(candidate.start, candidate.end, modelSalesDateBounds.min, modelSalesDateBounds.max);
    });
    previousModelSalesLatestDate.current = data.latest;
  }, [data.latest, modelSalesDateBounds.max, modelSalesDateBounds.min]);

  const activeModelSalesDates = useMemo(
    () => isoDateRange(modelSalesRange.start, modelSalesRange.end),
    [modelSalesRange.end, modelSalesRange.start],
  );
  const modelSalesDateLabel = activeModelSalesDates.length === 1
    ? compactDate(activeModelSalesDates[0])
    : `${compactDate(modelSalesRange.start)}–${compactDate(modelSalesRange.end)} · ${activeModelSalesDates.length} วัน`;

  const changeModelSalesStartDate = (start: string) => {
    setModelSalesRange((current) => clampModelSalesDateRange(start, current.end, modelSalesDateBounds.min, modelSalesDateBounds.max));
  };
  const changeModelSalesEndDate = (end: string) => {
    setModelSalesRange((current) => clampModelSalesDateRange(current.start, end, modelSalesDateBounds.min, modelSalesDateBounds.max));
  };

  const shopModelSales = useMemo(() => {
    const selectedCodes = selectedShops.length ? new Set(selectedShops) : new Set(modelShopOptions.map(([code]) => code));
    const activeKeys = new Set(selectedModelKeys.length ? selectedModelKeys : modelPerformance.modelOptions.map((row) => row.key));
    const inScope = data.modelSales.filter((sale) => selectedCodes.has(sale.code) && sale.brand === modelBrand && activeKeys.has(modelSaleKey(sale)));
    const currentDateSet = new Set(activeModelSalesDates);
    const previousDates = activeModelSalesDates.map((date) => shiftIsoDate(date, -7));
    const previousDateSet = new Set(previousDates);
    const previousDateLabel = previousDates.length === 1
      ? compactDate(previousDates[0])
      : `${compactDate(previousDates[0])}–${compactDate(previousDates.at(-1) ?? previousDates[0])}`;
    const asOfDate = activeModelSalesDates.at(-1) ?? formatDate(selectedDay);
    const asOfMonth = asOfDate.slice(0, 7);
    const currentSales = inScope.filter((sale) => currentDateSet.has(sale.date));
    const previousSales = inScope.filter((sale) => previousDateSet.has(sale.date));
    const mtdSales = inScope.filter((sale) => sale.date >= `${asOfMonth}-01` && sale.date <= asOfDate);
    const currentByKey = new Map(summarizeModelSales(currentSales).map((row) => [row.key, row]));
    const previousByKey = new Map(summarizeModelSales(previousSales).map((row) => [row.key, row]));
    const mtdByKey = new Map(summarizeModelSales(mtdSales).map((row) => [row.key, row]));
    const rowMetrics = (key: string) => {
      const current = currentByKey.get(key) ?? { qty: 0, net: 0 };
      const previous = previousByKey.get(key) ?? { qty: 0, net: 0 };
      const mtd = mtdByKey.get(key) ?? { qty: 0, net: 0 };
      return { current, previous, mtd, wowQty: wowChangeRate(current.qty, previous.qty), wowNet: wowChangeRate(current.net, previous.net) };
    };
    const dailyRows = summarizeModelSales(currentSales)
      .map((row) => ({ ...row, ...rowMetrics(row.key) }))
      .sort((a, b) => b.current[modelSort] - a.current[modelSort] || b.mtd[modelSort] - a.mtd[modelSort] || a.model.localeCompare(b.model));
    const topModels = summarizeModelSales(mtdSales)
      .map((row) => ({ ...row, ...rowMetrics(row.key) }))
      .sort((a, b) => b.current[modelSort] - a.current[modelSort] || b.mtd[modelSort] - a.mtd[modelSort] || a.model.localeCompare(b.model));
    const totals = salesSnapshot(currentSales, activeModelSalesDates[0] ?? asOfDate, activeModelSalesDates.at(-1) ?? asOfDate);
    const previousTotals = salesSnapshot(previousSales, previousDates[0] ?? asOfDate, previousDates.at(-1) ?? asOfDate);
    const selectedNames = modelShopOptions.filter(([code]) => selectedCodes.has(code)).map(([, name]) => name);
    const scopeLabel = selectedShops.length === 0 ? "ทุกสาขา" : selectedShops.length === 1 ? selectedNames[0] ?? "1 สาขา" : `${selectedShops.length} สาขาที่เลือก`;
    return {
      dailyRows,
      topModels,
      totals,
      previousTotals,
      wowQty: wowChangeRate(totals.qty, previousTotals.qty),
      wowNet: wowChangeRate(totals.net, previousTotals.net),
      scopeLabel,
      previousDateLabel,
    };
  }, [activeModelSalesDates, data.modelSales, formatDate, modelBrand, modelPerformance.modelOptions, modelShopOptions, modelSort, selectedDay, selectedModelKeys, selectedShops]);

  const focusModelMonitor = useMemo(() => {
    const selectedDate = formatDate(selectedDay);
    const scoped = data.modelSales.filter((sale) => sale.date >= `${monthPrefix}-01` && sale.date <= selectedDate && (selectedShops.length === 0 || selectedShops.includes(sale.code)));
    const definitionFor = (model: string) => focusModels.find((definition) => definition.match(model));
    const mapped = scoped.map((sale) => ({ sale, definition: definitionFor(sale.model) })).filter((item): item is typeof item & { definition: typeof focusModels[number] } => Boolean(item.definition));
    const rows = focusModels.map((definition) => {
      const sales = mapped.filter((item) => item.definition.key === definition.key).map((item) => item.sale);
      const total = salesSnapshot(sales, `${monthPrefix}-01`, selectedDate);
      const latest = salesSnapshot(sales, selectedDate, selectedDate);
      return { ...definition, total, latest, activeShops: new Set(sales.map((sale) => sale.code)).size };
    });
    const daily = Array.from({ length: selectedDay }, (_, index) => {
      const date = formatDate(index + 1);
      const values = Object.fromEntries(focusModels.map((definition) => {
        const sales = mapped.filter((item) => item.definition.key === definition.key && item.sale.date === date).map((item) => item.sale);
        return [definition.key, salesSnapshot(sales, date, date)];
      }));
      return { date, values, total: Object.values(values).reduce((sum, value) => ({ qty: sum.qty + value.qty, net: sum.net + value.net }), { qty: 0, net: 0 }) };
    });
    const total = rows.reduce((sum, row) => ({ qty: sum.qty + row.total.qty, net: sum.net + row.total.net }), { qty: 0, net: 0 });
    const shopRows = modelShopOptions
      .filter(([code]) => selectedShops.length === 0 || selectedShops.includes(code))
      .map(([code, shop]) => {
        const values = Object.fromEntries(focusModels.map((definition) => {
          const sales = mapped.filter((item) => item.definition.key === definition.key && item.sale.code === code).map((item) => item.sale);
          return [definition.key, salesSnapshot(sales, `${monthPrefix}-01`, selectedDate)];
        }));
        const shopTotal = Object.values(values).reduce((sum, value) => ({ qty: sum.qty + value.qty, net: sum.net + value.net }), { qty: 0, net: 0 });
        return { code, shop, values, total: shopTotal };
      })
      .sort((a, b) => b.total[modelSort] - a.total[modelSort] || a.shop.localeCompare(b.shop));
    return { rows, daily, shopRows, total };
  }, [data.modelSales, formatDate, modelShopOptions, modelSort, monthPrefix, selectedDay, selectedShops]);
  const focusStockMonitor = useMemo(() => {
    const visibleShops = modelShopOptions.filter(([code]) => selectedShops.length === 0 || selectedShops.includes(code));
    const visibleCodes = new Set(visibleShops.map(([code]) => code));
    const scoped = data.stock.filter((row) => visibleCodes.has(row.code));
    const rows = focusModels.map((definition) => {
      const stock = scoped.filter((row) => focusStockKey(row.model) === definition.key);
      const sales = focusModelMonitor.rows.find((row) => row.key === definition.key)?.total.qty ?? 0;
      const balance = stock.reduce((sum, row) => sum + row.balance, 0);
      const amount = stock.reduce((sum, row) => sum + row.amount, 0);
      const activeShops = new Set(stock.filter((row) => row.balance > 0).map((row) => row.code)).size;
      const dailyAverage = selectedDay ? sales / selectedDay : 0;
      return { ...definition, balance, amount, activeShops, daysCover: dailyAverage > 0 ? balance / dailyAverage : null };
    });
    const shopRows = visibleShops.map(([code, shop]) => {
      const values = Object.fromEntries(focusModels.map((definition) => {
        const stock = scoped.filter((row) => row.code === code && focusStockKey(row.model) === definition.key);
        return [definition.key, {
          balance: stock.reduce((sum, row) => sum + row.balance, 0),
          amount: stock.reduce((sum, row) => sum + row.amount, 0),
        }];
      }));
      const total = Object.values(values).reduce((sum, value) => ({ balance: sum.balance + value.balance, amount: sum.amount + value.amount }), { balance: 0, amount: 0 });
      return { code, shop, values, total };
    }).sort((a, b) => modelSort === "net"
      ? b.total.amount - a.total.amount || b.total.balance - a.total.balance || a.shop.localeCompare(b.shop)
      : b.total.balance - a.total.balance || b.total.amount - a.total.amount || a.shop.localeCompare(b.shop));
    const total = rows.reduce((sum, row) => ({ balance: sum.balance + row.balance, amount: sum.amount + row.amount }), { balance: 0, amount: 0 });
    return { rows, shopRows, total, shopCount: visibleShops.length };
  }, [data.stock, focusModelMonitor.rows, modelShopOptions, modelSort, selectedDay, selectedShops]);
  const modelTrendMax = Math.max(...modelPerformance.trend.map((item) => item[modelSort]), 1);
  const modelColor = brandColors[modelBrand] ?? "#7c3aed";
  const modelSelectionLabel = selectedModelKeys.length === 0
    ? `ทุกรุ่นใน ${modelBrand}`
    : selectedModelKeys.length === 1
      ? modelPerformance.modelOptions.find((row) => row.key === selectedModelKeys[0])?.model ?? "1 รุ่นที่เลือก"
      : `${selectedModelKeys.length} รุ่นที่เลือก`;

  const toggleModel = (key: string) => {
    setSelectedModelKeys((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key]);
  };

  const modelAreaMatrix = useMemo(() => {
    const scopedRows = data.shops.filter((row) => selectedShops.length === 0 || selectedShops.includes(row.code));
    const performanceValue = (row: DataRow) => {
      const values = metric === "net" ? row.dailyNet : row.dailyQty;
      const mtdActual = sumTo(values, selectedDay);
      if (viewMode === "day") return values[selectedDay - 1] || 0;
      if (viewMode === "runrate") return selectedDay ? (mtdActual / selectedDay) * daysInMonth : 0;
      return mtdActual;
    };
    const brandSales = [...new Set(scopedRows.map((row) => row.brand))]
      .map((brand) => ({ brand, value: scopedRows.filter((row) => row.brand === brand).reduce((sum, row) => sum + performanceValue(row), 0) }))
      .sort((a, b) => b.value - a.value || a.brand.localeCompare(b.brand));
    let topBrands = brandSales.slice(0, 12).map((item) => item.brand);
    if (selectedBrand !== "ALL" && !topBrands.includes(selectedBrand)) topBrands = [...topBrands.slice(0, 11), selectedBrand];

    const cellFor = (rows: DataRow[]) => {
      const row = combineRows(rows);
      const values = metric === "net" ? row.dailyNet : row.dailyQty;
      const monthlyTarget = metric === "net" ? row.targetNet : row.targetQty;
      const dailyActual = values[selectedDay - 1] || 0;
      const mtdActual = sumTo(values, selectedDay);
      const dailyTarget = monthlyTarget / daysInMonth;
      const targetToDate = dailyTarget * selectedDay;
      const runRate = selectedDay ? (mtdActual / selectedDay) * daysInMonth : 0;
      const actual = viewMode === "day" ? dailyActual : viewMode === "runrate" ? runRate : mtdActual;
      const viewTarget = viewMode === "day" ? dailyTarget : viewMode === "runrate" ? monthlyTarget : targetToDate;
      const achievement = viewTarget ? (actual / viewTarget) * 100 : 0;
      const runRatePercent = monthlyTarget ? (runRate / monthlyTarget) * 100 : 0;
      const rankingValue = matrixRanking === "achieve" ? achievement : matrixRanking === "runrate" ? runRatePercent : actual;
      return { actual, dailyActual, mtdActual, monthlyTarget, viewTarget, runRate, achievement, runRatePercent, rankingValue };
    };

    const shopRows = [...new Set(scopedRows.map((row) => row.code))].map((code) => {
      const rows = scopedRows.filter((row) => row.code === code);
      return {
        code,
        shop: rows[0]?.shop ?? code,
        all: cellFor(rows),
        brands: Object.fromEntries(topBrands.map((brand) => [brand, cellFor(rows.filter((row) => row.brand === brand))])),
      };
    }).filter((row) => row.all.monthlyTarget > 0 || row.all.mtdActual > 0);
    const allShop = {
      code: "ALL_SHOP",
      shop: "ALL Shop",
      all: cellFor(scopedRows),
      brands: Object.fromEntries(topBrands.map((brand) => [brand, cellFor(scopedRows.filter((row) => row.brand === brand))])),
    };
    const columns = ["ALL", ...topBrands];
    const ranks = new Map<string, number>();
    for (const column of columns) {
      const scoreFor = (row: typeof shopRows[number]) => column === "ALL" ? row.all.rankingValue : row.brands[column].rankingValue;
      const uniqueScores = [...new Set(shopRows.map(scoreFor).filter((score) => score > 0))].sort((a, b) => b - a);
      for (const row of shopRows) {
        const score = scoreFor(row);
        if (score > 0) ranks.set(`${column}|${row.code}`, uniqueScores.indexOf(score) + 1);
      }
    }
    const activeSort = columns.includes(matrixSortBrand) ? matrixSortBrand : "ALL";
    const sortedRows = [...shopRows].sort((a, b) => {
      const aCell = activeSort === "ALL" ? a.all : a.brands[activeSort];
      const bCell = activeSort === "ALL" ? b.all : b.brands[activeSort];
      return bCell.rankingValue - aCell.rankingValue || a.shop.localeCompare(b.shop);
    });
    return { topBrands, shopRows: sortedRows, allShop, ranks, activeSort };
  }, [data.shops, daysInMonth, matrixRanking, matrixSortBrand, metric, selectedBrand, selectedDay, selectedShops, viewMode]);

  const matrixRankClass = (rank: number | undefined, total: number) => {
    if (!rank) return "matrix-rank-none";
    if (rank === 1) return "matrix-rank-1";
    if (rank === 2) return "matrix-rank-2";
    if (rank === 3) return "matrix-rank-3";
    const percentile = rank / Math.max(total, 1);
    return percentile <= 0.4 ? "matrix-rank-high" : percentile <= 0.7 ? "matrix-rank-mid" : "matrix-rank-low";
  };

  const matrixCell = (cell: typeof modelAreaMatrix.allShop.all, rank?: number, isTotal = false) => {
    const hasTarget = cell.monthlyTarget > 0;
    const hasSales = cell.mtdActual > 0;
    const hasTargetWithoutSales = !isTotal && hasTarget && !hasSales;
    const targetLabel = hasTarget ? displayValue(cell.monthlyTarget) : "ไม่มี Target";
    const label = `${modeCopy.actual} ${metricLabel} ${displayValue(cell.actual)}, Run Rate ${displayValue(cell.runRate)}, Target ${targetLabel}, %Ach ${hasTarget ? `${cell.achievement.toFixed(1)}%` : "—"}, %Runrate ${hasTarget ? `${cell.runRatePercent.toFixed(1)}%` : "—"}`;
    return <div className={`matrix-cell ${isTotal ? "matrix-total-cell" : matrixRankClass(rank, modelAreaMatrix.shopRows.length)} ${hasTargetWithoutSales ? "matrix-target-no-sales" : ""}`} title={label} aria-label={label}>
      <div><strong>{metric === "net" ? compactChart(cell.actual) : integer.format(cell.actual)}</strong>{!isTotal && rank && <span>#{rank}</span>}</div>
      <small>{hasTarget ? `%RR ${cell.runRatePercent.toFixed(1)}%` : hasSales ? "No Target • มี Sales" : "—"}</small>
    </div>;
  };

  const toggleMatrixCapture = () => {
    setMatrixCapture((current) => {
      const next = !current;
      if (next) {
        setModelTableCapture(null);
        window.requestAnimationFrame(() => document.getElementById("model-area-title")?.scrollIntoView({ block: "start" }));
      }
      return next;
    });
  };

  const toggleModelCapture = (capture: Exclude<ModelTableCapture, null>, targetId: string) => {
    setModelTableCapture((current) => {
      const next = current === capture ? null : capture;
      if (next) {
        setMatrixCapture(false);
        document.querySelectorAll("details[open]").forEach((details) => details.removeAttribute("open"));
        window.requestAnimationFrame(() => document.getElementById(targetId)?.scrollIntoView({ block: "start" }));
      }
      return next;
    });
  };

  const captureButton = (capture: Exclude<ModelTableCapture, null>, targetId: string) => (
    <button className={`capture-view-button ${modelTableCapture === capture ? "active" : ""}`} type="button" aria-pressed={modelTableCapture === capture} onClick={() => toggleModelCapture(capture, targetId)}><span aria-hidden="true">{modelTableCapture === capture ? "×" : "▣"}</span>{modelTableCapture === capture ? "ออกจาก Capture" : "Capture Table"}</button>
  );

  return (
    <main className={matrixCapture ? "matrix-capture-active" : modelTableCapture ? `model-table-capture-active capture-${modelTableCapture}` : ""}>
      <section className="hero shell">
        <div className="hero-copy">
          <div className="eyebrow"><span className="live-dot" /> BMAV • DEVICE PERFORMANCE</div>
          <h1>Device by Brand<br /><span>{data.month}</span></h1>
          <p>Dashboard ที่ Focus ด้าน Net Amount พร้อมสลับดู Qty, เลือก Brand, สาขา, วันที่ขาย และมุม Performance แบบ Daily, MTD, Achieve to Date หรือ Run Rate ได้ในหน้าเดียว</p>
          <a className="download-button" href="https://bmav-device-brand-aug26.amnattyy.chatgpt.site/BMAV_Device_By_Brand_Dashboard.xlsx">ดาวน์โหลด Excel <span aria-hidden="true">↓</span></a>
        </div>
        <div className="hero-visual" aria-label={`Achievement ${achievement.toFixed(1)}%`}>
          <div className="orbit orbit-one" /><div className="orbit orbit-two" />
          <div className="score-ring" style={{ "--score": Math.min(achievement, 100), "--accent": selectedColor } as React.CSSProperties}>
            <div><strong>{achievement.toFixed(1)}%</strong><span>{scoreRingLabel}</span></div>
          </div>
          <div className="as-of">ข้อมูล ณ {thaiDate(selectedDay)}</div>
        </div>
      </section>

      <section className="filter-dock shell" aria-label="ตัวกรอง Dashboard">
        <div className="filter-group metric-filter"><span className="filter-label">มุมมองหลัก</span><div className="segmented"><button className={metric === "net" ? "selected" : ""} onClick={() => setMetric("net")}>Net Amount</button><button className={metric === "qty" ? "selected" : ""} onClick={() => setMetric("qty")}>Qty</button></div></div>
        <div className="filter-group"><label htmlFor="month-filter">Month</label><select id="month-filter" value={selectedMonth} onChange={(event) => setSelectedMonth(event.target.value)}>{availableMonths.map((month) => <option key={month} value={month}>{new Intl.DateTimeFormat("en", { month: "long", year: "numeric" }).format(new Date(`${month}-01T00:00:00Z`))}</option>)}</select></div>
        <div className="filter-group"><label htmlFor="brand-filter">Brand</label><select id="brand-filter" value={selectedBrand} onChange={(event) => chooseBrand(event.target.value)}><option value="ALL">ALL BRANDS</option>{data.brands.map((row) => <option key={row.brand} value={row.brand}>{row.brand}</option>)}</select></div>
        <div className="filter-group shop-filter"><span className="filter-label">สาขา</span><details className="shop-multiselect"><summary><span>{selectedShops.length === 0 ? "ทุกสาขาที่มี Target หรือยอดขาย" : `${selectedShops.length} สาขาที่เลือก`}</span><b aria-hidden="true">⌄</b></summary><div className="shop-menu"><label className="shop-option all-shops"><input type="checkbox" checked={selectedShops.length === 0} onChange={() => setSelectedShops([])} /><span>ทุกสาขาที่มี Target หรือยอดขาย</span></label><div className="shop-option-list">{shopOptions.map(([code, shop]) => <label className="shop-option" key={code}><input type="checkbox" checked={selectedShops.includes(code)} onChange={() => toggleShop(code)} /><span>{shop}</span></label>)}</div></div></details></div>
        <div className="filter-group performance-filter"><span className="filter-label">Performance</span><div className="segmented performance-segmented"><button className={viewMode === "mtd" ? "selected" : ""} onClick={() => setViewMode("mtd")}>MTD</button><button className={viewMode === "achieve" ? "selected" : ""} onClick={() => setViewMode("achieve")}>Achieve TD</button><button className={viewMode === "runrate" ? "selected" : ""} onClick={() => setViewMode("runrate")}>Run Rate</button><button className={viewMode === "day" ? "selected" : ""} onClick={() => setViewMode("day")}>Daily</button></div></div>
        <div className="filter-group"><label htmlFor="date-filter">วันที่ขาย</label><input id="date-filter" type="date" min={`${monthPrefix}-01`} max={data.latest} value={formatDate(selectedDay)} onChange={(event) => setSelectedDay(Number(event.target.value.slice(-2)))} /></div>
      </section>

      <section className="context-line shell"><span>{metricLabel}</span><b>{selectedBrand === "ALL" ? "ALL BRANDS" : selectedBrand}</b><b>{shopName}</b><b>{modeCopy.title} ณ {thaiDate(selectedDay)}</b></section>

      <section className="section wow-section shell" aria-labelledby="wow-title">
        <div className="section-heading wow-heading"><div><span className="section-number">WOW</span><h2 id="wow-title">Performance WoW</h2><p>{wow.range.id}: {shortDateRange(wow.period.currentStart, wow.period.currentEnd)} • เทียบฐาน {shortDateRange(wow.period.baseStart, wow.period.baseEnd)} • {weekDataStatus(wow.period)}</p></div><span className={`wow-status ${activeWowTone}`}>WoW {metric === "net" ? "Net" : "Qty"} {wowRateLabel(activeWowRate)}</span></div>
        <div className="week-picker" role="group" aria-label="เลือกช่วง Week on Week">
          {visibleWeekRanges.map(({ range, index }) => {
            const period = comparableWeekPeriod(range, data.latest);
            return <button key={range.id} className={selectedWeek === index ? "selected" : ""} onClick={() => setSelectedWeek(index)} disabled={period.currentDays === 0}><span>{range.id}</span><small>{range.label}</small><em>{weekDataStatus(period)}</em></button>;
          })}
        </div>
        <div className="wow-context"><b>ช่วงปัจจุบัน {shortDateRange(wow.period.currentStart, wow.period.currentEnd)}</b><span>ฐานเปรียบเทียบ {shortDateRange(wow.period.baseStart, wow.period.baseEnd)}</span><span>จำนวนวันเท่ากัน {wow.period.currentDays} วัน</span><span>{selectedBrand === "ALL" ? "ทุก Brand" : selectedBrand} • {shopName}</span></div>
        <div className="wow-kpis">
          <article><span>Net Amount</span><strong>฿{integer.format(wow.current.net)}</strong><small>สัปดาห์ก่อน ฿{integer.format(wow.previous.net)}</small><em className={wowRateTone(wow.netRate)}>{wow.current.net - wow.previous.net >= 0 ? "+" : ""}฿{integer.format(wow.current.net - wow.previous.net)} • {wowRateLabel(wow.netRate)}</em></article>
          <article><span>QTY</span><strong>{integer.format(wow.current.qty)} เครื่อง</strong><small>สัปดาห์ก่อน {integer.format(wow.previous.qty)} เครื่อง</small><em className={wowRateTone(wow.qtyRate)}>{wow.current.qty - wow.previous.qty >= 0 ? "+" : ""}{integer.format(wow.current.qty - wow.previous.qty)} • {wowRateLabel(wow.qtyRate)}</em></article>
          <article><span>มูลค่าต่อเครื่อง</span><strong>฿{integer.format(wow.currentAsp)}</strong><small>สัปดาห์ก่อน ฿{integer.format(wow.previousAsp)}</small><em className={wowRateTone(wow.aspRate)}>{wowRateLabel(wow.aspRate)} WoW</em></article>
          <article><span>Shop contribution signal</span><strong className="shop-signal-name">{wow.leadShop?.name ?? "—"}</strong><small>{wow.netRate == null ? "รอฐานเปรียบเทียบ" : wow.netRate >= 0 ? "สาขาผลักดันหลัก" : "สาขาตัวฉุดหลัก"}</small><em className={(wow.leadShop?.shareDelta ?? 0) >= 0 ? "positive" : "negative"}>{signed(wow.leadShop?.shareDelta ?? 0)} pts share</em></article>
        </div>
        <div className="wow-analysis-grid">
          <article className="driver-panel"><header><div><span>BRAND DRIVER</span><h3>ตัวผลักดัน / ตัวฉุด</h3></div><small>Δ Net Amount</small></header><div className="driver-list">{[...wow.brandDrivers.slice(0, 2), ...wow.brandDrivers.slice(-2).reverse().filter((driver) => !wow.brandDrivers.slice(0, 2).includes(driver))].map((driver) => <div key={driver.name}><b>{driver.name}</b><span className={driver.deltaNet >= 0 ? "positive" : "negative"}>{driver.deltaNet >= 0 ? "+" : ""}฿{compactChart(driver.deltaNet)}</span><small>QTY {driver.deltaQty >= 0 ? "+" : ""}{integer.format(driver.deltaQty)} • Share {signed(driver.shareDelta)} pts</small></div>)}</div></article>
          <article className="driver-panel"><header><div><span>SHOP DRIVER</span><h3>สาขาที่ต้องจับตา</h3></div><small>Δ Net Amount</small></header><div className="driver-list">{wow.shopDrivers.slice(0, 2).map((driver) => <div key={driver.name}><b>{driver.name}</b><span className={driver.deltaNet >= 0 ? "positive" : "negative"}>{driver.deltaNet >= 0 ? "+" : ""}฿{compactChart(driver.deltaNet)}</span><small>QTY {driver.deltaQty >= 0 ? "+" : ""}{integer.format(driver.deltaQty)} • Share {signed(driver.shareDelta)} pts</small></div>)}{wow.shopDrivers.slice(-2).reverse().filter((driver) => !wow.shopDrivers.slice(0, 2).includes(driver)).map((driver) => <div key={driver.name}><b>{driver.name}</b><span className={driver.deltaNet >= 0 ? "positive" : "negative"}>{driver.deltaNet >= 0 ? "+" : ""}฿{compactChart(driver.deltaNet)}</span><small>QTY {driver.deltaQty >= 0 ? "+" : ""}{integer.format(driver.deltaQty)} • Share {signed(driver.shareDelta)} pts</small></div>)}</div></article>
          <aside className="action-panel"><span>INSIGHT → ACTION</span><h3>สัปดาห์นี้: {wow.direction}</h3><p><b>สัญญาณ:</b> {wow.cause} ขณะที่ Shop contribution ของ {wow.leadShop?.name ?? "สาขาหลัก"} เปลี่ยน {signed(wow.leadShop?.shareDelta ?? 0)} pts</p><div><small>ACTION ชี้เป้า</small><strong>{wow.action}</strong></div></aside>
        </div>
      </section>

      <section className="section all-brand-wow-section shell" aria-labelledby="all-brand-wow-title">
        <div className="section-heading all-brand-wow-heading">
          <div><span className="section-number">TABLE</span><h2 id="all-brand-wow-title">All Brand WoW</h2><p>{allBrandWow.range.id} • {shortDateRange(allBrandWow.period.currentStart, allBrandWow.period.currentEnd)} เทียบ {previousWeekId(allBrandWow.range.id)} • {shortDateRange(allBrandWow.period.baseStart, allBrandWow.period.baseEnd)} • {allBrandWow.period.currentDays} วันเท่ากัน • {shopName}</p></div>
          <div className="all-brand-wow-actions" role="group" aria-label="เลือกการเรียงตาราง All Brand WoW"><span>เรียงตามยอดสัปดาห์ปัจจุบัน</span><div className="segmented"><button className={brandWowSort === "net" ? "selected" : ""} onClick={() => setBrandWowSort("net")}>Net Amount</button><button className={brandWowSort === "qty" ? "selected" : ""} onClick={() => setBrandWowSort("qty")}>Qty</button></div></div>
        </div>
        <div className="all-brand-wow-note"><span><i className="growth" /> เติบโต</span><span><i className="decline" /> ลดลง</span><span><i className="flat" /> ทรงตัว / ไม่มีฐาน</span><b>ตารางแสดงทุก Brand และอัปเดตตาม Week กับ Shop filter</b></div>
        <div className="all-brand-wow-wrap">
          <table className="all-brand-wow-table">
            <colgroup><col className="brand-column" /><col span={4} className="qty-column" /><col span={4} className="net-column" /></colgroup>
            <thead>
              <tr className="metric-group-row"><th rowSpan={2}>Brand</th><th colSpan={4} className="qty-group">Quantity (QTY)</th><th colSpan={4} className="net-group">Net Amount (฿)</th></tr>
              <tr><th>{previousWeekId(allBrandWow.range.id)}<small>{shortDateRange(allBrandWow.period.baseStart, allBrandWow.period.baseEnd)}</small></th><th>{allBrandWow.range.id}<small>{shortDateRange(allBrandWow.period.currentStart, allBrandWow.period.currentEnd)}</small></th><th>Diff QTY</th><th>%WoW QTY</th><th>{previousWeekId(allBrandWow.range.id)}<small>{shortDateRange(allBrandWow.period.baseStart, allBrandWow.period.baseEnd)}</small></th><th>{allBrandWow.range.id}<small>{shortDateRange(allBrandWow.period.currentStart, allBrandWow.period.currentEnd)}</small></th><th>Diff Net</th><th>%WoW Net</th></tr>
            </thead>
            <tbody>
              {allBrandWow.rows.map((row) => <tr className={selectedBrand === row.brand ? "selected-brand-row" : ""} key={row.brand}>
                <th><i style={{ background: brandColors[row.brand] ?? "#64748b" }} />{row.brand}</th>
                <td>{integer.format(row.previous.qty)}</td><td><b>{integer.format(row.current.qty)}</b></td><td className={`wow-diff ${comparisonTone(row.diffQty)}`}>{signedInteger(row.diffQty)}</td><td><span className={`all-brand-wow-rate ${comparisonTone(row.qtyRate)}`}>{wowRateLabel(row.qtyRate)}</span></td>
                <td>{integer.format(row.previous.net)}</td><td><b>{integer.format(row.current.net)}</b></td><td className={`wow-diff ${comparisonTone(row.diffNet)}`}>{signedInteger(row.diffNet)}</td><td><span className={`all-brand-wow-rate ${comparisonTone(row.netRate)}`}>{wowRateLabel(row.netRate)}</span></td>
              </tr>)}
            </tbody>
            <tfoot><tr><th>Grand Total</th><td>{integer.format(allBrandWow.totals.previous.qty)}</td><td>{integer.format(allBrandWow.totals.current.qty)}</td><td className={`wow-diff ${comparisonTone(allBrandWow.totals.diffQty)}`}>{signedInteger(allBrandWow.totals.diffQty)}</td><td><span className={`all-brand-wow-rate ${comparisonTone(allBrandWow.totals.qtyRate)}`}>{wowRateLabel(allBrandWow.totals.qtyRate)}</span></td><td>{integer.format(allBrandWow.totals.previous.net)}</td><td>{integer.format(allBrandWow.totals.current.net)}</td><td className={`wow-diff ${comparisonTone(allBrandWow.totals.diffNet)}`}>{signedInteger(allBrandWow.totals.diffNet)}</td><td><span className={`all-brand-wow-rate ${comparisonTone(allBrandWow.totals.netRate)}`}>{wowRateLabel(allBrandWow.totals.netRate)}</span></td></tr></tfoot>
          </table>
        </div>
      </section>

      <section className="kpi-grid shell">
        <article className="kpi-card purple"><div className="kpi-icon">T</div><span>{modeCopy.target} {metricLabel}</span><strong>{displayValue(target)}</strong><small>{viewMode === "day" ? "เป้าหมายเฉลี่ยต่อวัน" : viewMode === "runrate" ? "เป้าหมายเต็มเดือน" : `เป้าหมายสะสม ${selectedDay} วัน`}</small></article>
        <article className="kpi-card blue"><div className="kpi-icon">A</div><span>{modeCopy.actual} {metricLabel}</span><strong>{displayValue(actual)}</strong><small>{viewMode === "day" ? `ยอดขายวันที่ ${selectedDay} ${shortMonth}` : viewMode === "runrate" ? `ประมาณการจากยอดสะสม ${selectedDay} วัน` : "ยอดขายสะสมถึงวันที่เลือก"}</small></article>
        <article className="kpi-card orange"><div className="kpi-icon">%</div><span>{modeCopy.achievement}</span><strong>{achievement.toFixed(1)}%</strong><small>{viewMode === "runrate" ? "คาดการณ์เทียบ Target เต็มเดือน" : viewMode === "day" ? "เทียบ Target Daily" : "เทียบ Target ถึงปัจจุบัน"}</small></article>
        <article className="kpi-card green"><div className="kpi-icon">G</div><span>{modeCopy.gap}</span><strong>{displayValue(actual - target)}</strong><small>{actual >= target ? "สูงกว่าเป้าหมาย" : `ยังขาด ${unit}`}</small></article>
      </section>

      <section className="section shell">
        <div className="section-heading"><div><span className="section-number">01</span><h2>Performance by Brand</h2><p>{metricLabel} • {modeCopy.title} • {shopName} • MoM vs {previousMonthName}<br /><span className="brand-wow-context">{wow.range.id}: {shortDateRange(wow.period.currentStart, wow.period.currentEnd)} เทียบ {shortDateRange(wow.period.baseStart, wow.period.baseEnd)} • จำนวนวันเท่ากัน {wow.period.currentDays} วัน</span></p></div><div className="legend"><i className="target" /> {modeCopy.target} <i className="actual" /> {modeCopy.actual}</div></div>
        <div className="brand-grid">
          {brandViews.map((item) => {
            const color = brandColors[item.brand] ?? "#64748b";
            const weekly = brandWow.get(item.brand);
            const wowLabel = weekly?.rate == null ? "—" : signed(weekly.rate);
            const wowClass = weekly?.rate == null ? "mom-neutral" : weekly.rate >= 0 ? "mom-up" : "mom-down";
            return <button key={item.brand} className={`brand-card ${selectedBrand === item.brand ? "active" : ""}`} onClick={() => chooseBrand(item.brand)} style={{ "--brand": color } as React.CSSProperties}>
              <div className="brand-card-top"><span className="brand-mark">{item.brand.slice(0, 2)}</span><strong>{item.brand}</strong><div className="brand-rates"><em className={tone(item.viewAchievement)}>{viewMode === "mtd" || viewMode === "day" ? displayValue(item.viewActual) : `${item.viewAchievement.toFixed(1)}%`}</em><span className="brand-view-label">{modeCopy.short}</span><div className="brand-change-badges"><span className={`brand-mom ${momTone(item.viewActual, item.viewPrevious)}`}>MoM {momLabel(item.viewActual, item.viewPrevious)}</span><span className={`brand-mom ${wowClass}`}>WoW {metric === "net" ? "Net" : "Qty"} {wowLabel}</span></div></div></div>
              <div className="brand-numbers"><span>{modeCopy.target} <b>{displayValue(item.viewTarget)}</b></span><span>{modeCopy.actual} <b>{displayValue(item.viewActual)}</b></span></div>
              <div className="progress-track"><span style={{ width: `${Math.min(item.viewAchievement, 100)}%` }} /></div>
            </button>;
          })}
        </div>
        {selectedBrand !== "ALL" && <button className="reset-link" onClick={() => chooseBrand("ALL")}>ดูภาพรวมทุก Brand</button>}
      </section>

      <section className="section split-section shell">
        <div className="trend-panel panel">
          <div className="panel-head"><div><span className="section-number">02</span><h2>Daily Trend</h2><p>{metric === "net" ? "Net Amount" : "Qty"} • ยอดขายจริงรายวัน 1–{selectedDay} {shortMonth}</p></div><div className="trend-legend"><span><i className="actual-dot" /> Daily Sales</span></div></div>
          <div className="daily-chart" aria-label="กราฟยอดขายรายวัน">
            {trend.map((item) => <div className="day-column" key={item.day} aria-label={`${item.day} ${shortMonth}: ${displayValue(item.actual)}`}><div className="bar-space"><div className="actual-bar" title={`${item.day} ${shortMonth}: ${displayValue(item.actual)}`} style={{ height: `${(item.actual / trendMax) * 100}%`, background: selectedColor }}><span>{metric === "net" ? compactChart(item.actual) : number.format(item.actual)}</span></div></div><small>{item.day}</small></div>)}
          </div>
          <div className="trend-foot"><span>1 {shortMonth}</span><b>ยอดขายรวม 1–{selectedDay} {shortMonth} {displayValue(trendTotal)}</b><span>{selectedDay} {shortMonth}</span></div>
        </div>
        <aside className="focus-panel panel"><span className="section-number">PERFORMANCE FOCUS</span><h2>{metricLabel}</h2><p>{selectedBrand === "ALL" ? "ALL BRANDS" : selectedBrand} • {shopName}</p><div className="focus-meter"><span style={{ width: `${Math.min(achievement, 100)}%`, background: selectedColor }} /></div><div className="focus-stats"><span><small>{modeCopy.actual}</small><strong>{displayValue(actual)}</strong><small>{modeCopy.title}</small></span><span><small>{modeCopy.target}</small><strong>{displayValue(target)}</strong><small>{modeCopy.title}</small></span></div><div className="pace-note"><span>{modeCopy.short}</span><p>{viewMode === "runrate" ? `ประมาณการสิ้นเดือนจากยอดขายเฉลี่ย ${selectedDay} วัน` : `ข้อมูลถึงวันที่ ${thaiDate(selectedDay)}`} • เลือก Net Amount / Qty ได้ทันที</p></div></aside>
      </section>

      <section className={`section model-area-section shell ${matrixCapture ? "capture-mode" : ""}`} aria-labelledby="model-area-title">
        <div className="section-heading model-area-heading">
          <div><span className="section-number">03</span><h2 id="model-area-title">Brand x Shop · Ranking</h2><p>Top {modelAreaMatrix.topBrands.length} Brand ตาม {modeCopy.actual} {metricLabel} • {viewMode === "day" ? `วันที่ ${selectedDay} ${shortMonth}` : viewMode === "runrate" ? `ประมาณการสิ้นเดือนจากยอดสะสมถึง ${selectedDay} ${shortMonth}` : `ยอดสะสมถึง ${selectedDay} ${shortMonth}`} • รวมสาขาที่ไม่มี Target แต่มียอดขาย</p></div>
          <div className="matrix-actions"><button className={`capture-view-button ${matrixCapture ? "active" : ""}`} type="button" aria-pressed={matrixCapture} onClick={toggleMatrixCapture}><span aria-hidden="true">{matrixCapture ? "×" : "▣"}</span>{matrixCapture ? "ออกจาก Capture" : "Capture View"}</button><div className="matrix-ranking-control" role="group" aria-label="เลือกเกณฑ์จัดอันดับสี"><span>จัดสีตามอันดับ</span><div className="segmented"><button className={matrixRanking === "rank" ? "selected" : ""} onClick={() => setMatrixRanking("rank")}>Rank</button><button className={matrixRanking === "achieve" ? "selected" : ""} onClick={() => setMatrixRanking("achieve")}>% Ach</button><button className={matrixRanking === "runrate" ? "selected" : ""} onClick={() => setMatrixRanking("runrate")}>%Runrate</button></div></div></div>
        </div>
        <div className="matrix-legend"><span><i className="matrix-swatch best" /> อันดับสูง</span><span><i className="matrix-swatch middle" /> กลาง</span><span><i className="matrix-swatch low" /> ต้องเร่ง</span><small>{matrixCapture ? "Capture View แสดงทุก Brand ในภาพเดียว • กด Esc เพื่อออก" : "คลิกชื่อคอลัมน์เพื่อเรียงสาขา • เลื่อนเมาส์ที่ตัวเลขเพื่อดูยอด, Run Rate และ Target"}</small></div>
        <div className="model-area-wrap">
          <table className="model-area-table">
            <thead><tr><th>Shop / Area</th><th className={`all-model-column ${modelAreaMatrix.activeSort === "ALL" ? "sorted" : ""}`}><button onClick={() => setMatrixSortBrand("ALL")}><strong>ALL BRAND</strong><small>รวมทุก Brand/รุ่น</small></button></th>{modelAreaMatrix.topBrands.map((brand) => <th className={`brand-column-header ${selectedBrand === brand ? "selected-brand-column" : ""} ${modelAreaMatrix.activeSort === brand ? "sorted" : ""}`} style={{ "--brand": brandColors[brand] ?? "#64748b" } as React.CSSProperties} key={brand}><button onClick={() => setMatrixSortBrand(brand)}><strong>{brand}</strong><small>คลิกเพื่อเรียง</small></button></th>)}</tr></thead>
            <tbody>
              <tr className="all-shop-row"><th><strong>ALL Shop</strong><small>ผลรวมทุกสาขา · ไม่จัดอันดับ</small></th><td>{matrixCell(modelAreaMatrix.allShop.all, undefined, true)}</td>{modelAreaMatrix.topBrands.map((brand) => <td className={selectedBrand === brand ? "selected-brand-column" : ""} key={brand}>{matrixCell(modelAreaMatrix.allShop.brands[brand], undefined, true)}</td>)}</tr>
              {modelAreaMatrix.shopRows.map((row) => <tr key={row.code}><th><strong>{row.shop}</strong><small>{row.code}{row.all.monthlyTarget <= 0 && row.all.mtdActual > 0 ? " · No Target" : ""}</small></th><td className="all-model-column">{matrixCell(row.all, modelAreaMatrix.ranks.get(`ALL|${row.code}`))}</td>{modelAreaMatrix.topBrands.map((brand) => <td className={selectedBrand === brand ? "selected-brand-column" : ""} key={brand}>{matrixCell(row.brands[brand], modelAreaMatrix.ranks.get(`${brand}|${row.code}`))}</td>)}</tr>)}
            </tbody>
          </table>
        </div>
      </section>

      <section className="section model-performance-section shell" aria-labelledby="model-performance-title" style={{ "--model-brand": modelColor } as React.CSSProperties}>
        <div className="section-heading model-performance-heading">
          <div><span className="section-number">MODEL</span><h2 id="model-performance-title">Model Performance</h2><p>ข้อมูล LIVE จาก Daily_Sales_Model • Daily ณ {thaiDate(selectedDay)} • {modelPerformance.range.id} {shortDateRange(modelPerformance.period.currentStart, modelPerformance.period.currentEnd)} เทียบ {modelPerformance.previousWeek} {shortDateRange(modelPerformance.period.baseStart, modelPerformance.period.baseEnd)} • {weekDataStatus(modelPerformance.period)}</p></div>
          <div className="model-performance-controls">
            <div className="model-shared-filter"><span>Shop (เลือกได้หลายสาขา)</span><details className="shop-multiselect"><summary><span>{selectedShops.length === 0 ? "ทุกสาขา" : `${selectedShops.length} สาขาที่เลือก`}</span><b aria-hidden="true">⌄</b></summary><div className="shop-menu"><label className="shop-option all-shops"><input type="checkbox" checked={selectedShops.length === 0} onChange={() => setSelectedShops([])} /><span>ทุกสาขา</span></label><div className="shop-option-list">{modelShopOptions.map(([code, shop]) => <label className="shop-option" key={code}><input type="checkbox" checked={selectedShops.includes(code)} onChange={() => toggleShop(code)} /><span>{shop}</span></label>)}</div></div></details></div>
            <label>Brand<select value={modelBrand} onChange={(event) => { setModelBrand(event.target.value); setSelectedModelKeys([]); setModelQuery(""); }}>{modelPerformance.brandOptions.map((brand) => <option key={brand} value={brand}>{brand}</option>)}</select></label>
            <label>ค้นหา Model<input type="search" value={modelQuery} onChange={(event) => setModelQuery(event.target.value)} placeholder="พิมพ์ชื่อรุ่น" /></label>
            <div className="model-shared-filter model-multi-filter"><span>Model (เลือกได้หลายรุ่น)</span><details className="shop-multiselect"><summary aria-label="เลือกรุ่นที่ใช้กับทุกตาราง"><span>{modelSelectionLabel}</span><b aria-hidden="true">⌄</b></summary><div className="shop-menu model-filter-menu"><label className="shop-option all-shops"><input type="checkbox" checked={selectedModelKeys.length === 0} onChange={() => setSelectedModelKeys([])} /><span>ทุกรุ่นใน {modelBrand}</span></label><div className="shop-option-list">{modelPerformance.modelOptions.map((row) => <label className="shop-option" key={row.key}><input type="checkbox" checked={selectedModelKeys.includes(row.key)} onChange={() => toggleModel(row.key)} /><span>{row.model}</span></label>)}</div></div></details></div>
            <div className="model-sort-control"><span>เรียงตาม</span><div className="segmented"><button className={modelSort === "net" ? "selected" : ""} onClick={() => setModelSort("net")}>Net</button><button className={modelSort === "qty" ? "selected" : ""} onClick={() => setModelSort("qty")}>Qty</button></div></div>
          </div>
        </div>

        {!data.modelSales.length ? <div className="model-empty-state"><strong>ยังไม่พบข้อมูลรุ่นจาก Google Sheet</strong><span>Dashboard ส่วน Brand ยังคงใช้งานได้ และระบบจะลองเชื่อม Daily_Sales_Model ใหม่อัตโนมัติทุก 5 นาที</span></div> : <>
          <div className="model-focus-strip">
            <article><span>Model Scope</span><strong>{modelSelectionLabel}</strong><small>{modelBrand} • {shopModelSales.scopeLabel}</small></article>
            <article><span>Daily · {selectedDay} {shortMonth}</span><strong>{integer.format(modelPerformance.daily.qty)} เครื่อง</strong><small>Net ฿{integer.format(modelPerformance.daily.net)}</small></article>
            <article><span>{modelPerformance.range.id} · {modelPerformance.period.currentDays} วัน</span><strong>{integer.format(modelPerformance.current.qty)} เครื่อง</strong><small>Net ฿{integer.format(modelPerformance.current.net)}</small></article>
            <article><span>%WoW Qty / Net</span><strong><em className={`model-rate ${comparisonTone(modelPerformance.wowQty)}`}>{wowRateLabel(modelPerformance.wowQty)}</em><em className={`model-rate ${comparisonTone(modelPerformance.wowNet)}`}>{wowRateLabel(modelPerformance.wowNet)}</em></strong><small>เทียบจำนวนวันเท่ากัน</small></article>
            <article><span>สาขาที่มียอด MTD</span><strong>{modelPerformance.sellingShops}/{modelPerformance.totalShops}</strong><small>สาขา • ถึง {selectedDay} {shortMonth}</small></article>
          </div>

          <section className={`focus-model-monitor-card focus-model-daily-card ${modelTableCapture === "focus-models" ? "model-capture-target" : ""}`} aria-labelledby="focus-model-monitor-title">
            <header><div><span>MODEL FOCUS · DAILY MONITOR</span><h3 id="focus-model-monitor-title">ยอดขายรายวัน 7 รุ่น Focus</h3><p>{data.month} • 1–{selectedDay} {shortMonth} • {shopName}</p></div><div className="model-card-actions"><p>ในแต่ละช่องแสดง QTY และ Net Amount</p>{captureButton("focus-models", "focus-model-monitor-title")}</div></header>
            <div className="focus-model-summary">{focusModelMonitor.rows.map((row) => <article key={row.key} style={{ "--focus-brand": brandColors[row.brand] ?? "#64748b" } as React.CSSProperties}><span>{row.label}</span><strong>{integer.format(row.total.qty)} เครื่อง</strong><small>Net ฿{integer.format(row.total.net)} • {row.activeShops} สาขา</small></article>)}</div>
            <div className="focus-model-table-wrap"><table className="focus-model-table focus-model-daily-table">
              <colgroup><col className="focus-daily-date-column" /><col span={8} className="focus-daily-value-column" /></colgroup>
              <thead><tr><th>Date</th>{focusModelMonitor.rows.map((row) => <th key={row.key} style={{ "--focus-brand": brandColors[row.brand] ?? "#64748b" } as React.CSSProperties}>{row.label}<small>{row.brand}</small></th>)}<th>Total Focus</th></tr></thead>
              <tbody>{focusModelMonitor.daily.map((row) => <tr key={row.date}><th>{compactDate(row.date)}</th>{focusModelMonitor.rows.map((model) => { const value = row.values[model.key]; return <td key={model.key}><strong>{integer.format(value.qty)}</strong><small>฿{integer.format(value.net)}</small></td>; })}<td className="focus-daily-total"><strong>{integer.format(row.total.qty)}</strong><small>฿{integer.format(row.total.net)}</small></td></tr>)}</tbody>
              <tfoot><tr><th>MTD Total</th>{focusModelMonitor.rows.map((row) => <td key={row.key}><strong>{integer.format(row.total.qty)}</strong><small>฿{integer.format(row.total.net)}</small></td>)}<td><strong>{integer.format(focusModelMonitor.total.qty)}</strong><small>฿{integer.format(focusModelMonitor.total.net)}</small></td></tr></tfoot>
            </table></div>
          </section>

          <section className={`focus-model-monitor-card focus-model-shop-card ${modelTableCapture === "focus-shops" ? "model-capture-target" : ""}`} aria-labelledby="focus-model-shop-title">
            <header><div><span>MODEL FOCUS · BY SHOP</span><h3 id="focus-model-shop-title">ยอดขาย Model Focus รายสาขา</h3><p>{data.month} • 1–{selectedDay} {shortMonth} • {focusModelMonitor.shopRows.length} สาขา รวมสาขาที่ยังไม่มียอด</p></div><div className="model-card-actions"><p>เรียงตาม {modelSort === "net" ? "Net Amount" : "QTY"} • แสดง QTY และ Net</p>{captureButton("focus-shops", "focus-model-shop-title")}</div></header>
            <div className="focus-model-table-wrap"><table className="focus-model-table focus-model-shop-table">
              <colgroup><col className="focus-shop-name-column" /><col span={8} className="focus-shop-value-column" /></colgroup>
              <thead><tr><th>Shop</th>{focusModelMonitor.rows.map((row) => <th key={row.key} style={{ "--focus-brand": brandColors[row.brand] ?? "#64748b" } as React.CSSProperties}>{row.label}<small>{row.brand}</small></th>)}<th>Total Focus</th></tr></thead>
              <tbody>{focusModelMonitor.shopRows.map((row) => <tr key={row.code}><th><strong>{row.shop}</strong><small>{row.code}{row.total.qty === 0 && row.total.net === 0 ? " · No Sales" : ""}</small></th>{focusModelMonitor.rows.map((model) => { const value = row.values[model.key]; return <td key={model.key}><strong>{integer.format(value.qty)}</strong><small>฿{integer.format(value.net)}</small></td>; })}<td className="focus-daily-total"><strong>{integer.format(row.total.qty)}</strong><small>฿{integer.format(row.total.net)}</small></td></tr>)}</tbody>
              <tfoot><tr><th>Grand Total</th>{focusModelMonitor.rows.map((row) => <td key={row.key}><strong>{integer.format(row.total.qty)}</strong><small>฿{integer.format(row.total.net)}</small></td>)}<td><strong>{integer.format(focusModelMonitor.total.qty)}</strong><small>฿{integer.format(focusModelMonitor.total.net)}</small></td></tr></tfoot>
            </table></div>
          </section>

          <section className={`focus-model-monitor-card focus-stock-card ${modelTableCapture === "focus-stock" ? "model-capture-target" : ""}`} aria-labelledby="focus-stock-title">
            <header><div><span>MODEL FOCUS · STOCK SNAPSHOT</span><h3 id="focus-stock-title">Stock ล่าสุด 7 รุ่น Focus รายสาขา</h3><p>Data Stock B5 • {focusStockMonitor.shopCount} สาขาตามตัวกรอง • Stock เป็นข้อมูลล่าสุดและไม่เปลี่ยนตาม Month</p></div><div className="model-card-actions"><p><b className={`stock-source-badge ${data.stock.length ? "live" : "unavailable"}`}>{data.stock.length ? "STOCK LIVE" : "STOCK UNAVAILABLE"}</b> รีเฟรชทุก 5 นาที</p>{captureButton("focus-stock", "focus-stock-title")}</div></header>
            {data.stock.length ? <>
              <div className="focus-model-summary focus-stock-summary">{focusStockMonitor.rows.map((row) => <article key={row.key} style={{ "--focus-brand": brandColors[row.brand] ?? "#64748b" } as React.CSSProperties}><span>{row.label}</span><strong>{integer.format(row.balance)} เครื่อง</strong><small>มูลค่า ฿{integer.format(row.amount)} • มี Stock {row.activeShops}/{focusStockMonitor.shopCount} สาขา</small><small>{row.daysCover == null ? "Days Cover — (ยังไม่มียอดขาย MTD)" : `Days Cover ${number.format(row.daysCover)} วัน`}</small></article>)}</div>
              <div className="focus-model-table-wrap"><table className="focus-model-table focus-model-shop-table focus-stock-table">
                <colgroup><col className="focus-shop-name-column" /><col span={8} className="focus-shop-value-column" /></colgroup>
                <thead><tr><th>Shop</th>{focusStockMonitor.rows.map((row) => <th key={row.key} style={{ "--focus-brand": brandColors[row.brand] ?? "#64748b" } as React.CSSProperties}>{row.label}<small>{row.brand}</small></th>)}<th>Total Stock</th></tr></thead>
                <tbody>{focusStockMonitor.shopRows.map((row) => <tr key={row.code}><th><strong>{row.shop}</strong><small>{row.code}{row.total.balance === 0 ? " · Stock Out" : ""}</small></th>{focusStockMonitor.rows.map((model) => { const value = row.values[model.key]; return <td className={value.balance === 0 ? "stock-zero" : ""} key={model.key}><strong>{integer.format(value.balance)}</strong><small>฿{integer.format(value.amount)}</small></td>; })}<td className={`focus-daily-total ${row.total.balance === 0 ? "stock-zero" : ""}`}><strong>{integer.format(row.total.balance)}</strong><small>฿{integer.format(row.total.amount)}</small></td></tr>)}</tbody>
                <tfoot><tr><th>Grand Total</th>{focusStockMonitor.rows.map((row) => <td key={row.key}><strong>{integer.format(row.balance)}</strong><small>฿{integer.format(row.amount)}</small></td>)}<td><strong>{integer.format(focusStockMonitor.total.balance)}</strong><small>฿{integer.format(focusStockMonitor.total.amount)}</small></td></tr></tfoot>
              </table></div>
            </> : <div className="model-empty-state stock-empty-state"><strong>ยังเชื่อม Stock ไม่สำเร็จ</strong><span>Dashboard ยอดขายยังใช้งานได้ตามปกติ และระบบจะลองเชื่อม Data Stock B5 ใหม่อัตโนมัติทุก 5 นาที</span></div>}
          </section>

          <section className={`model-area-card ${modelTableCapture === "overview" ? "model-capture-target" : ""}`} aria-labelledby="model-area-overview-title">
            <header><div><span>BY AREA · SELECTED MODELS</span><h3 id="model-area-overview-title">ภาพรวม Performance รายรุ่น</h3></div><div className="model-card-actions"><p>{modelPerformance.rows.length} รุ่น • ตัวกรองด้านบนใช้กับทุกตาราง</p>{captureButton("overview", "model-area-overview-title")}</div></header>
            <div className="model-performance-table-wrap"><table className="model-performance-table">
              <thead><tr><th>Brand</th><th>Model</th><th>Daily<br />QTY</th><th>Daily<br />Net</th><th>{modelPerformance.previousWeek}<br />QTY</th><th>{modelPerformance.range.id}<br />QTY</th><th>%WoW<br />QTY</th><th>{modelPerformance.previousWeek}<br />Net</th><th>{modelPerformance.range.id}<br />Net</th><th>%WoW<br />Net</th><th>MTD<br />QTY</th><th>MTD<br />Net</th></tr></thead>
              <tbody>{modelPerformance.rows.map((row) => <tr className={selectedModelKeys.includes(row.key) ? "active" : ""} key={row.key} onClick={() => setSelectedModelKeys([row.key])}><td><span className="model-brand-pill" style={{ "--pill": brandColors[row.brand] ?? "#64748b" } as React.CSSProperties}>{row.brand}</span></td><th><strong>{row.model}</strong><small>{row.activeShops} สาขามียอด MTD</small></th><td>{integer.format(row.daily.qty)}</td><td>{integer.format(row.daily.net)}</td><td>{integer.format(row.previous.qty)}</td><td><b>{integer.format(row.current.qty)}</b></td><td><span className={`model-rate ${comparisonTone(row.wowQty)}`}>{wowRateLabel(row.wowQty)}</span></td><td>{integer.format(row.previous.net)}</td><td><b>{integer.format(row.current.net)}</b></td><td><span className={`model-rate ${comparisonTone(row.wowNet)}`}>{wowRateLabel(row.wowNet)}</span></td><td>{integer.format(row.mtd.qty)}</td><td><b>{integer.format(row.mtd.net)}</b></td></tr>)}</tbody>
            </table></div>
          </section>

          <div className="model-detail-grid">
            <section className="model-daily-card">
              <header><div><span>DAILY TREND · BY AREA</span><h3>{modelSelectionLabel}</h3></div><p>{modelSort === "net" ? "Net Amount" : "QTY"} • 1–{selectedDay} {shortMonth}</p></header>
              <div className="model-daily-chart">{modelPerformance.trend.map((item) => <div className="model-day-column" key={item.day}><div><i style={{ height: `${(item[modelSort] / modelTrendMax) * 100}%`, background: modelColor }}><span>{modelSort === "net" ? compactChart(item.net) : integer.format(item.qty)}</span></i></div><small>{item.day}</small></div>)}</div>
              <footer><span>1 {shortMonth}</span><b>MTD {integer.format(modelPerformance.mtd.qty)} เครื่อง • ฿{integer.format(modelPerformance.mtd.net)}</b><span>{selectedDay} {shortMonth}</span></footer>
            </section>

            <section className={`model-shop-card ${modelTableCapture === "shop-wow" ? "model-capture-target" : ""}`}>
              <header><div><span>BY SHOP · SELECTED MODELS</span><h3 id="model-shop-wow-title">WoW รายสาขา</h3></div><div className="model-card-actions"><p>{modelSelectionLabel} • {modelPerformance.totalShops} สาขา</p>{captureButton("shop-wow", "model-shop-wow-title")}</div></header>
              <div className="model-shop-table-wrap"><table className="model-shop-table"><thead><tr><th>Shop</th><th>Daily<br />QTY</th><th>Daily<br />Net</th><th>{modelPerformance.previousWeek}<br />QTY</th><th>{modelPerformance.range.id}<br />QTY</th><th>%WoW<br />QTY</th><th>{modelPerformance.previousWeek}<br />Net</th><th>{modelPerformance.range.id}<br />Net</th><th>%WoW<br />Net</th></tr></thead><tbody>{modelPerformance.shopRows.map((row) => <tr key={row.code}><th><strong>{row.shop}</strong><small>{row.code}{row.mtd.qty === 0 && row.mtd.net === 0 ? " · No Sales" : ""}</small></th><td>{integer.format(row.daily.qty)}</td><td>{integer.format(row.daily.net)}</td><td>{integer.format(row.previous.qty)}</td><td><b>{integer.format(row.current.qty)}</b></td><td><span className={`model-rate ${comparisonTone(row.wowQty)}`}>{wowRateLabel(row.wowQty)}</span></td><td>{integer.format(row.previous.net)}</td><td><b>{integer.format(row.current.net)}</b></td><td><span className={`model-rate ${comparisonTone(row.wowNet)}`}>{wowRateLabel(row.wowNet)}</span></td></tr>)}</tbody></table></div>
            </section>
          </div>

          <section className={`model-branch-analysis-card ${modelTableCapture === "branch" ? "model-capture-target branch-capture-mode" : ""}`} aria-labelledby="model-branch-analysis-title">
            <header>
              <div><span>BRANCH ANALYSIS · {modelPerformance.totalShops} SHOPS</span><h3 id="model-branch-analysis-title">วิเคราะห์ Performance รายสาขา</h3><p>{modelSelectionLabel} • เรียงตาม {modelSort === "net" ? "Net Amount" : "QTY"} {modelPerformance.range.id} • ตัวกรองร่วมด้านบน</p></div>
              <div className="branch-analysis-actions">
                <span className="shared-filter-note">{modelBrand} • {shopModelSales.scopeLabel}</span>
                {captureButton("branch", "model-branch-analysis-title")}
              </div>
            </header>
            <div className="model-branch-summary">
              <article><span>Top Shop · {modelPerformance.range.id}</span><strong>{modelPerformance.branchSummary.topShop?.shop ?? "—"}</strong><small>{modelSort === "net" ? `฿${integer.format(modelPerformance.branchSummary.topShop?.current.net ?? 0)}` : `${integer.format(modelPerformance.branchSummary.topShop?.current.qty ?? 0)} เครื่อง`}</small></article>
              <article className="growth"><span>Growth / New Sales</span><strong>{modelPerformance.branchSummary.growth}</strong><small>สาขา</small></article>
              <article className="decline"><span>Decline / No Sales Week</span><strong>{modelPerformance.branchSummary.decline}</strong><small>สาขา</small></article>
              <article className="flat"><span>No Sales สัปดาห์นี้</span><strong>{modelPerformance.branchSummary.noSales}</strong><small>จาก {modelPerformance.totalShops} สาขา</small></article>
            </div>
            <div className="model-branch-analysis-wrap"><table className="model-branch-analysis-table">
              <thead><tr><th>Rank</th><th>Shop</th><th>Daily<br /><small>QTY / Net</small></th><th>{modelPerformance.range.id}<br /><small>QTY / Net</small></th><th>%WoW<br /><small>QTY / Net</small></th><th>MTD<br /><small>QTY / Net</small></th><th>วิเคราะห์ / Action</th></tr></thead>
              <tbody>{modelPerformance.shopRows.map((row) => <tr key={row.code}><td><b>#{row.rank}</b></td><th><strong>{row.shop}</strong><small>{row.code}</small></th><td><b>{integer.format(row.daily.qty)}</b><small>฿{integer.format(row.daily.net)}</small></td><td><b>{integer.format(row.current.qty)}</b><small>฿{integer.format(row.current.net)}</small></td><td><span className={`model-rate ${comparisonTone(row.wowQty)}`}>{wowRateLabel(row.wowQty)}</span><small><span className={`model-rate ${comparisonTone(row.wowNet)}`}>{wowRateLabel(row.wowNet)}</span></small></td><td><b>{integer.format(row.mtd.qty)}</b><small>฿{integer.format(row.mtd.net)}</small></td><td><span className={`model-branch-insight ${row.insight.tone}`}><b>{row.insight.label}</b><small>{row.insight.action}</small></span></td></tr>)}</tbody>
            </table></div>
          </section>

          <section className="model-shop-sales-card" aria-labelledby="model-shop-sales-title">
            <header>
              <div><span>SHOP × MODEL × DATE RANGE</span><h3 id="model-shop-sales-title">ยอดขาย By Model รายสาขา</h3><p>เลือกวันเริ่มต้น–วันสิ้นสุดเพื่อรวมยอด และเทียบวันตรงกันย้อนหลัง 7 วันแบบจำนวนวันเท่ากัน</p></div>
              <div className="model-shop-sales-controls">
                <div className="shared-filter-note">{modelSelectionLabel}<small>{shopModelSales.scopeLabel}</small></div>
                <div className="model-sales-date-range" role="group" aria-label="เลือกช่วงวันที่สำหรับ Performance รุ่น">
                  <label><span>Start date</span><input type="date" min={modelSalesDateBounds.min} max={modelSalesDateBounds.max} value={modelSalesRange.start} onChange={(event) => changeModelSalesStartDate(event.target.value)} /></label>
                  <label><span>End date</span><input type="date" min={modelSalesRange.start} max={modelSalesDateBounds.max} value={modelSalesRange.end} onChange={(event) => changeModelSalesEndDate(event.target.value)} /></label>
                </div>
              </div>
            </header>
            <div className="model-shop-sales-summary">
              <article><span>Shop Scope</span><strong>{shopModelSales.scopeLabel}</strong><small>เชื่อมกับตัวกรองสาขาหลัก</small></article>
              <article><span>{modelSalesDateLabel}</span><strong>{integer.format(shopModelSales.totals.qty)} เครื่อง</strong><small>Net ฿{integer.format(shopModelSales.totals.net)} • {shopModelSales.dailyRows.length} รุ่น</small></article>
              <article><span>{shopModelSales.previousDateLabel} · ฐาน 7 วันก่อน</span><strong>{integer.format(shopModelSales.previousTotals.qty)} เครื่อง</strong><small>Net ฿{integer.format(shopModelSales.previousTotals.net)}</small></article>
              <article><span>%WoW Qty / Net</span><strong><em className={`model-rate ${comparisonTone(shopModelSales.wowQty)}`}>{wowRateLabel(shopModelSales.wowQty)}</em><em className={`model-rate ${comparisonTone(shopModelSales.wowNet)}`}>{wowRateLabel(shopModelSales.wowNet)}</em></strong><small>เทียบวันตรงกันย้อนหลัง 7 วัน</small></article>
            </div>
            <div className="model-shop-sales-grid">
              <section className={modelTableCapture === "top-models" ? "model-capture-target" : ""}><header><div><span>SELECTED MODELS · WOW</span><h4 id="model-top-models-title">Performance รุ่นตามช่วงวันที่</h4></div><div className="model-card-actions"><p>{modelSalesDateLabel} • เรียงตาม {modelSort === "net" ? "Net" : "Qty"}</p>{captureButton("top-models", "model-top-models-title")}</div></header><div className="model-shop-sales-table-wrap"><table className="model-top-brand-table"><thead><tr><th>Brand</th><th>Model</th><th>วันที่เลือก<br /><small>QTY / Net</small></th><th>{shopModelSales.previousDateLabel}<br /><small>QTY / Net</small></th><th>%WoW<br /><small>QTY / Net</small></th><th>MTD<br /><small>QTY / Net</small></th></tr></thead><tbody>{shopModelSales.topModels.map((row) => <tr key={row.key} onClick={() => setSelectedModelKeys([row.key])}><td><span className="model-brand-pill" style={{ "--pill": brandColors[row.brand] ?? "#64748b" } as React.CSSProperties}>{row.brand}</span></td><th><strong>{row.model}</strong><small>คลิกเพื่อเลือกเฉพาะรุ่นนี้</small></th><td><b>{integer.format(row.current.qty)}</b><small>฿{integer.format(row.current.net)}</small></td><td><b>{integer.format(row.previous.qty)}</b><small>฿{integer.format(row.previous.net)}</small></td><td><span className={`model-rate ${comparisonTone(row.wowQty)}`}>{wowRateLabel(row.wowQty)}</span><small><span className={`model-rate ${comparisonTone(row.wowNet)}`}>{wowRateLabel(row.wowNet)}</span></small></td><td><b>{integer.format(row.mtd.qty)}</b><small>฿{integer.format(row.mtd.net)}</small></td></tr>)}</tbody></table></div></section>
              <section className={modelTableCapture === "daily-sales" ? "model-capture-target" : ""}><header><div><span>DATE RANGE MODEL SALES · WOW</span><h4 id="model-daily-sales-title">รุ่นที่ขายในวันที่เลือก</h4></div><div className="model-card-actions"><p>{shopModelSales.dailyRows.length ? `${shopModelSales.dailyRows.length} รุ่น • ${modelSalesDateLabel}` : "No Sales"}</p>{captureButton("daily-sales", "model-daily-sales-title")}</div></header><div className="model-shop-sales-table-wrap">{shopModelSales.dailyRows.length ? <table className="model-daily-sales-table"><thead><tr><th>Rank</th><th>Brand</th><th>Model</th><th>วันที่เลือก<br /><small>QTY / Net</small></th><th>{shopModelSales.previousDateLabel}<br /><small>QTY / Net</small></th><th>%WoW<br /><small>QTY / Net</small></th><th>MTD<br /><small>QTY / Net</small></th></tr></thead><tbody>{shopModelSales.dailyRows.map((row, index) => <tr key={row.key} onClick={() => setSelectedModelKeys([row.key])}><td><b>#{index + 1}</b></td><td><span className="model-brand-pill" style={{ "--pill": brandColors[row.brand] ?? "#64748b" } as React.CSSProperties}>{row.brand}</span></td><th><strong>{row.model}</strong><small>คลิกเพื่อเลือกเฉพาะรุ่นนี้</small></th><td><b>{integer.format(row.current.qty)}</b><small>฿{integer.format(row.current.net)}</small></td><td><b>{integer.format(row.previous.qty)}</b><small>฿{integer.format(row.previous.net)}</small></td><td><span className={`model-rate ${comparisonTone(row.wowQty)}`}>{wowRateLabel(row.wowQty)}</span><small><span className={`model-rate ${comparisonTone(row.wowNet)}`}>{wowRateLabel(row.wowNet)}</span></small></td><td><b>{integer.format(row.mtd.qty)}</b><small>฿{integer.format(row.mtd.net)}</small></td></tr>)}</tbody></table> : <div className="model-daily-empty"><strong>No Sales</strong><span>ไม่พบยอดขาย By Model ของ {shopModelSales.scopeLabel} ใน {modelSalesDateLabel}</span></div>}</div></section>
            </div>
          </section>
        </>}
      </section>

      <section className="section shop-performance-section shell">
        <div className="section-heading shop-heading"><div><span className="section-number">04</span><h2>Shop Performance</h2><p>{selectedBrand === "ALL" ? "สาขาที่มี Target หรือยอดขายใน BMAV" : `สาขาที่มี Target หรือยอดขาย ${selectedBrand}`} • {modeCopy.title} • MoM เทียบ {previousMonthName}</p></div><span className="shop-count">{shopViews.length} สาขา</span></div>
        <section className="shop-brand-wow-card" aria-labelledby="shop-brand-wow-title" style={{ "--shop-wow-brand": brandColors[shopBrandWow.brand] ?? "#64748b" } as React.CSSProperties}>
          <header className="shop-brand-wow-head">
            <div><span>SHOP · WEEK COMPARISON</span><h3 id="shop-brand-wow-title">Performance WoW รายสาขา</h3><p>{shopBrandWow.previousWeek} {shortDateRange(shopBrandWow.period.baseStart, shopBrandWow.period.baseEnd)} เทียบ {shopBrandWow.range.id} {shortDateRange(shopBrandWow.period.currentStart, shopBrandWow.period.currentEnd)} • {shopBrandWow.period.currentDays} วันเท่ากัน • แสดงสาขา No Target ครบ</p></div>
            <div className="shop-brand-wow-controls">
              <label htmlFor="shop-brand-wow-brand">เลือก Brand</label>
              <select id="shop-brand-wow-brand" value={shopBrandWow.brand} onChange={(event) => setShopBrandWowBrand(event.target.value)}>{data.brands.map((row) => <option key={row.brand} value={row.brand}>{row.brand}</option>)}</select>
              <div className="segmented" role="group" aria-label="เรียง Performance WoW รายสาขา"><button className={shopBrandWowSort === "net" ? "selected" : ""} onClick={() => setShopBrandWowSort("net")}>Net Amount</button><button className={shopBrandWowSort === "qty" ? "selected" : ""} onClick={() => setShopBrandWowSort("qty")}>Qty</button></div>
            </div>
          </header>
          <div className="shop-brand-wow-legend"><b>{shopBrandWow.brand}</b><span><i className="growth" /> เติบโต</span><span><i className="decline" /> ลดลง</span><span><i className="flat" /> ทรงตัว</span><small>Target คำนวณตามจำนวนวันของ Week ที่เลือก</small></div>
          <div className="shop-brand-wow-wrap">
            <table className="shop-brand-wow-table">
              <colgroup><col className="shop-column" /><col span={6} className="qty-column" /><col span={6} className="net-column" /></colgroup>
              <thead>
                <tr className="shop-brand-wow-groups"><th rowSpan={2}>Shop</th><th colSpan={6}>Quantity (QTY)</th><th colSpan={6}>Net Amount (฿)</th></tr>
                <tr><th>{shopBrandWow.previousWeek}<small>{shortDateRange(shopBrandWow.period.baseStart, shopBrandWow.period.baseEnd)}</small></th><th>TG QTY<small>{shopBrandWow.period.currentDays} วัน</small></th><th>{shopBrandWow.range.id}<small>{shortDateRange(shopBrandWow.period.currentStart, shopBrandWow.period.currentEnd)}</small></th><th>% Ach</th><th>Diff</th><th>%WoW</th><th>{shopBrandWow.previousWeek}<small>{shortDateRange(shopBrandWow.period.baseStart, shopBrandWow.period.baseEnd)}</small></th><th>TG Net<small>{shopBrandWow.period.currentDays} วัน</small></th><th>{shopBrandWow.range.id}<small>{shortDateRange(shopBrandWow.period.currentStart, shopBrandWow.period.currentEnd)}</small></th><th>% Ach</th><th>Diff</th><th>%WoW</th></tr>
              </thead>
              <tbody>{shopBrandWow.rows.map((row) => <tr key={row.code}>
                <th><strong>{row.shop}</strong><small>{row.code}{!row.hasTarget ? " · No Target" : ""}</small></th>
                <td>{integer.format(row.previous.qty)}</td><td>{integer.format(row.targetQty)}</td><td><b>{integer.format(row.current.qty)}</b></td><td><span className={`shop-brand-wow-ach ${row.achievementQty == null ? "flat" : tone(row.achievementQty)}`}>{row.achievementQty == null ? "—" : `${row.achievementQty.toFixed(1)}%`}</span></td><td className={`shop-brand-wow-diff ${comparisonTone(row.diffQty)}`}>{signedInteger(row.diffQty)}</td><td><span className={`shop-brand-wow-rate ${comparisonTone(row.wowQty)}`}>{wowRateLabel(row.wowQty)}</span></td>
                <td>{integer.format(row.previous.net)}</td><td>{integer.format(row.targetNet)}</td><td><b>{integer.format(row.current.net)}</b></td><td><span className={`shop-brand-wow-ach ${row.achievementNet == null ? "flat" : tone(row.achievementNet)}`}>{row.achievementNet == null ? "—" : `${row.achievementNet.toFixed(1)}%`}</span></td><td className={`shop-brand-wow-diff ${comparisonTone(row.diffNet)}`}>{signedInteger(row.diffNet)}</td><td><span className={`shop-brand-wow-rate ${comparisonTone(row.wowNet)}`}>{wowRateLabel(row.wowNet)}</span></td>
              </tr>)}</tbody>
              <tfoot><tr><th>Grand Total</th><td>{integer.format(shopBrandWow.totals.previous.qty)}</td><td>{integer.format(shopBrandWow.totals.targetQty)}</td><td>{integer.format(shopBrandWow.totals.current.qty)}</td><td><span className={`shop-brand-wow-ach ${shopBrandWow.totals.achievementQty == null ? "flat" : tone(shopBrandWow.totals.achievementQty)}`}>{shopBrandWow.totals.achievementQty == null ? "—" : `${shopBrandWow.totals.achievementQty.toFixed(1)}%`}</span></td><td className={`shop-brand-wow-diff ${comparisonTone(shopBrandWow.totals.diffQty)}`}>{signedInteger(shopBrandWow.totals.diffQty)}</td><td><span className={`shop-brand-wow-rate ${comparisonTone(shopBrandWow.totals.wowQty)}`}>{wowRateLabel(shopBrandWow.totals.wowQty)}</span></td><td>{integer.format(shopBrandWow.totals.previous.net)}</td><td>{integer.format(shopBrandWow.totals.targetNet)}</td><td>{integer.format(shopBrandWow.totals.current.net)}</td><td><span className={`shop-brand-wow-ach ${shopBrandWow.totals.achievementNet == null ? "flat" : tone(shopBrandWow.totals.achievementNet)}`}>{shopBrandWow.totals.achievementNet == null ? "—" : `${shopBrandWow.totals.achievementNet.toFixed(1)}%`}</span></td><td className={`shop-brand-wow-diff ${comparisonTone(shopBrandWow.totals.diffNet)}`}>{signedInteger(shopBrandWow.totals.diffNet)}</td><td><span className={`shop-brand-wow-rate ${comparisonTone(shopBrandWow.totals.wowNet)}`}>{wowRateLabel(shopBrandWow.totals.wowNet)}</span></td></tr></tfoot>
            </table>
          </div>
        </section>
        <section className="wow-brand-chart" aria-labelledby="brand-wow-chart-title">
          <header><div><span>WEEK COMPARISON</span><h3 id="brand-wow-chart-title">%WoW by Brand</h3></div><p>{metricLabel} • {wow.range.id} {shortDateRange(wow.period.currentStart, wow.period.currentEnd)}<br />เทียบฐาน {shortDateRange(wow.period.baseStart, wow.period.baseEnd)} • {wow.period.currentDays} วันเท่ากัน</p></header>
          <div className="diverging-chart" role="img" aria-label={`กราฟเปอร์เซ็นต์ Week on Week แยกตาม Brand สำหรับ ${metricLabel}`}>
            <div className="chart-side-labels"><span>ลดลง</span><b>0%</b><span>เติบโต</span></div>
            {brandWowChart.rows.map((item) => {
              const hasBase = item.rate != null;
              const rate = item.rate ?? 0;
              const width = hasBase ? Math.max(rate === 0 ? 0 : 2, (Math.abs(rate) / brandWowChart.maxMagnitude) * 100) : 0;
              return <div className={`diverging-row ${selectedBrand === item.brand ? "highlight" : ""}`} key={item.brand}>
                <strong>{item.brand}</strong><div className="diverging-track"><i className="zero-line" />
                  <span className={!hasBase ? "bar-neutral" : rate < 0 ? "bar-negative" : "bar-positive"} style={{ width: `${width / 2}%`, [rate < 0 ? "right" : "left"]: "50%" }} />
                  <em className={!hasBase ? "value-neutral" : rate < 0 ? "value-negative" : "value-positive"} style={!hasBase ? { left: "calc(50% + 7px)" } : { [rate < 0 ? "right" : "left"]: `calc(50% + ${width / 2}% + 7px)` }}>{hasBase ? signed(rate) : "—"}</em>
                </div>
              </div>;
            })}
          </div>
        </section>
        <div className="shop-table-wrap"><table><thead><tr><th>อันดับ</th><th>สาขา</th><th>Target</th><th>{modeCopy.actual}</th><th>MoM</th><th>WoW {metric === "net" ? "Net" : "Qty"}</th><th>Achievement</th><th>Gap</th></tr></thead><tbody>
          {shopViews.map((shop, index) => {
            const weekly = shopWow.get(String(shop.code));
            const wowLabel = weekly?.rate == null ? "—" : signed(weekly.rate);
            const wowTone = weekly?.rate == null ? "mom-neutral" : weekly.rate >= 0 ? "mom-up" : "mom-down";
            return <tr key={shop.code}><td><span className={`rank ${index < 3 ? "top" : ""}`}>{index + 1}</span></td><td className="shop-name"><strong>{shop.shop}</strong>{!shop.hasTarget && <small className="no-target-badge">No Target</small>}</td><td>{shop.hasTarget ? tableValue(shop.viewTarget) : "—"}</td><td><b>{tableValue(shop.viewActual)}</b></td><td><span className={`mom-value ${momTone(shop.viewActual, shop.viewPrevious)}`}>{momLabel(shop.viewActual, shop.viewPrevious)}</span></td><td><span className={`mom-value ${wowTone}`}>{wowLabel}</span></td><td>{shop.hasTarget ? <div className="achievement-cell"><div><span style={{ width: `${Math.min(shop.viewAchievement, 100)}%` }} /></div><em className={tone(shop.viewAchievement)}>{shop.viewAchievement.toFixed(1)}%</em></div> : <span className="not-applicable">—</span>}</td><td className={shop.hasTarget ? shop.viewActual - shop.viewTarget >= 0 ? "positive-gap" : "gap" : ""}>{shop.hasTarget ? tableValue(shop.viewActual - shop.viewTarget) : "—"}</td></tr>;
          })}
        </tbody></table></div>
      </section>

      <footer className="shell"><div><strong>BMAV</strong><span>Device by Brand Dashboard</span></div><p><span className={`source-badge ${sourceStatus}`}>{sourceStatus === "live" ? "LIVE · Google Sheet" : sourceStatus === "loading" ? "กำลังอัปเดต" : "ข้อมูลสำรอง"}</span> Last updated {thaiDate(latestDay)}{lastSync ? ` · Sync ${lastSync.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })}` : ""}</p></footer>
    </main>
  );
}
