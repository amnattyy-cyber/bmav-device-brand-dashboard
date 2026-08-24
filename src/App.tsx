"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fallbackData, loadGoogleSheetData, sheetRefreshInterval, type DailySale, type DataRow } from "./google-sheet-data";
import { comparableWeekPeriod, shortDateRange, weekDataStatus, weekIndexForDate, weekRanges, wowChangeRate } from "./wow-periods";

type Metric = "net" | "qty";
type ViewMode = "day" | "mtd" | "achieve" | "runrate";
type MatrixRanking = "rank" | "achieve" | "runrate";
type SourceStatus = "loading" | "live" | "fallback";
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
  const [data, setData] = useState(fallbackData);
  const [sourceStatus, setSourceStatus] = useState<SourceStatus>("loading");
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [metric, setMetric] = useState<Metric>("net");
  const [brandWowSort, setBrandWowSort] = useState<Metric>("net");
  const [viewMode, setViewMode] = useState<ViewMode>("mtd");
  const [selectedBrand, setSelectedBrand] = useState("ALL");
  const [selectedShops, setSelectedShops] = useState<string[]>([]);
  const [selectedDay, setSelectedDay] = useState(Number(fallbackData.latest.slice(-2)));
  const [selectedWeek, setSelectedWeek] = useState(weekIndexForDate(fallbackData.latest));
  const [matrixRanking, setMatrixRanking] = useState<MatrixRanking>("rank");
  const [matrixSortBrand, setMatrixSortBrand] = useState("ALL");
  const [matrixCapture, setMatrixCapture] = useState(false);
  const previousLatestDate = useRef(fallbackData.latest);
  const latestDay = Number(data.latest.slice(-2));
  const monthPrefix = data.latest.slice(0, 7);
  const [yearNumber, monthNumber] = monthPrefix.split("-").map(Number);
  const daysInMonth = new Date(yearNumber, monthNumber, 0).getDate();
  const previousMonthDays = new Date(yearNumber, monthNumber - 1, 0).getDate();
  const formatDate = useCallback((day: number) => `${monthPrefix}-${String(day).padStart(2, "0")}`, [monthPrefix]);
  const thaiDate = useCallback((day: number) => new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", year: "numeric" }).format(new Date(`${formatDate(day)}T00:00:00+07:00`)), [formatDate]);

  const refreshData = useCallback(async () => {
    try {
      const liveData = await loadGoogleSheetData();
      setData(liveData);
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
    if (!matrixCapture) return;
    const exitCapture = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMatrixCapture(false);
    };
    window.addEventListener("keydown", exitCapture);
    return () => window.removeEventListener("keydown", exitCapture);
  }, [matrixCapture]);

  const shopOptions = useMemo(() => {
    const rows = (selectedBrand === "ALL" ? data.shops : data.shops.filter((row) => row.brand === selectedBrand))
      .filter((row) => row.targetQty > 0 || row.targetNet > 0 || sumTo(row.dailyQty, latestDay) > 0 || sumTo(row.dailyNet, latestDay) > 0);
    return [...new Map(rows.map((row) => [row.code, row.shop])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [data.shops, latestDay, selectedBrand]);

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
      if (next) window.requestAnimationFrame(() => document.getElementById("model-area-title")?.scrollIntoView({ block: "start" }));
      return next;
    });
  };

  return (
    <main className={matrixCapture ? "matrix-capture-active" : ""}>
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
        <div className="filter-group"><label htmlFor="brand-filter">Brand</label><select id="brand-filter" value={selectedBrand} onChange={(event) => chooseBrand(event.target.value)}><option value="ALL">ALL BRANDS</option>{data.brands.map((row) => <option key={row.brand} value={row.brand}>{row.brand}</option>)}</select></div>
        <div className="filter-group shop-filter"><span className="filter-label">สาขา</span><details className="shop-multiselect"><summary><span>{selectedShops.length === 0 ? "ทุกสาขาที่มี Target หรือยอดขาย" : `${selectedShops.length} สาขาที่เลือก`}</span><b aria-hidden="true">⌄</b></summary><div className="shop-menu"><label className="shop-option all-shops"><input type="checkbox" checked={selectedShops.length === 0} onChange={() => setSelectedShops([])} /><span>ทุกสาขาที่มี Target หรือยอดขาย</span></label><div className="shop-option-list">{shopOptions.map(([code, shop]) => <label className="shop-option" key={code}><input type="checkbox" checked={selectedShops.includes(code)} onChange={() => toggleShop(code)} /><span>{shop}</span></label>)}</div></div></details></div>
        <div className="filter-group performance-filter"><span className="filter-label">Performance</span><div className="segmented performance-segmented"><button className={viewMode === "mtd" ? "selected" : ""} onClick={() => setViewMode("mtd")}>MTD</button><button className={viewMode === "achieve" ? "selected" : ""} onClick={() => setViewMode("achieve")}>Achieve TD</button><button className={viewMode === "runrate" ? "selected" : ""} onClick={() => setViewMode("runrate")}>Run Rate</button><button className={viewMode === "day" ? "selected" : ""} onClick={() => setViewMode("day")}>Daily</button></div></div>
        <div className="filter-group"><label htmlFor="date-filter">วันที่ขาย</label><input id="date-filter" type="date" min={`${monthPrefix}-01`} max={data.latest} value={formatDate(selectedDay)} onChange={(event) => setSelectedDay(Number(event.target.value.slice(-2)))} /></div>
      </section>

      <section className="context-line shell"><span>{metricLabel}</span><b>{selectedBrand === "ALL" ? "ALL BRANDS" : selectedBrand}</b><b>{shopName}</b><b>{modeCopy.title} ณ {thaiDate(selectedDay)}</b></section>

      <section className="section wow-section shell" aria-labelledby="wow-title">
        <div className="section-heading wow-heading"><div><span className="section-number">WOW</span><h2 id="wow-title">Performance WoW</h2><p>{wow.range.id}: {shortDateRange(wow.period.currentStart, wow.period.currentEnd)} • เทียบฐาน {shortDateRange(wow.period.baseStart, wow.period.baseEnd)} • {weekDataStatus(wow.period)}</p></div><span className={`wow-status ${activeWowTone}`}>WoW {metric === "net" ? "Net" : "Qty"} {wowRateLabel(activeWowRate)}</span></div>
        <div className="week-picker" role="group" aria-label="เลือกช่วง Week on Week">
          {weekRanges.map((range, index) => {
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
          <div><span className="section-number">TABLE</span><h2 id="all-brand-wow-title">All Brand WoW</h2><p>{allBrandWow.range.id} • ปัจจุบัน {shortDateRange(allBrandWow.period.currentStart, allBrandWow.period.currentEnd)} เทียบฐาน {shortDateRange(allBrandWow.period.baseStart, allBrandWow.period.baseEnd)} • {allBrandWow.period.currentDays} วันเท่ากัน • {shopName}</p></div>
          <div className="all-brand-wow-actions" role="group" aria-label="เลือกการเรียงตาราง All Brand WoW"><span>เรียงตามยอดสัปดาห์ปัจจุบัน</span><div className="segmented"><button className={brandWowSort === "net" ? "selected" : ""} onClick={() => setBrandWowSort("net")}>Net Amount</button><button className={brandWowSort === "qty" ? "selected" : ""} onClick={() => setBrandWowSort("qty")}>Qty</button></div></div>
        </div>
        <div className="all-brand-wow-note"><span><i className="growth" /> เติบโต</span><span><i className="decline" /> ลดลง</span><span><i className="flat" /> ทรงตัว / ไม่มีฐาน</span><b>ตารางแสดงทุก Brand และอัปเดตตาม Week กับ Shop filter</b></div>
        <div className="all-brand-wow-wrap">
          <table className="all-brand-wow-table">
            <colgroup><col className="brand-column" /><col span={4} className="qty-column" /><col span={4} className="net-column" /></colgroup>
            <thead>
              <tr className="metric-group-row"><th rowSpan={2}>Brand</th><th colSpan={4} className="qty-group">Quantity (QTY)</th><th colSpan={4} className="net-group">Net Amount (฿)</th></tr>
              <tr><th>ฐาน<small>{shortDateRange(allBrandWow.period.baseStart, allBrandWow.period.baseEnd)}</small></th><th>ปัจจุบัน<small>{shortDateRange(allBrandWow.period.currentStart, allBrandWow.period.currentEnd)}</small></th><th>Diff QTY</th><th>%WoW QTY</th><th>ฐาน<small>{shortDateRange(allBrandWow.period.baseStart, allBrandWow.period.baseEnd)}</small></th><th>ปัจจุบัน<small>{shortDateRange(allBrandWow.period.currentStart, allBrandWow.period.currentEnd)}</small></th><th>Diff Net</th><th>%WoW Net</th></tr>
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
        <article className="kpi-card blue"><div className="kpi-icon">A</div><span>{modeCopy.actual} {metricLabel}</span><strong>{displayValue(actual)}</strong><small>{viewMode === "day" ? `ยอดขายวันที่ ${selectedDay} Aug` : viewMode === "runrate" ? `ประมาณการจากยอดสะสม ${selectedDay} วัน` : "ยอดขายสะสมถึงวันที่เลือก"}</small></article>
        <article className="kpi-card orange"><div className="kpi-icon">%</div><span>{modeCopy.achievement}</span><strong>{achievement.toFixed(1)}%</strong><small>{viewMode === "runrate" ? "คาดการณ์เทียบ Target เต็มเดือน" : viewMode === "day" ? "เทียบ Target Daily" : "เทียบ Target ถึงปัจจุบัน"}</small></article>
        <article className="kpi-card green"><div className="kpi-icon">G</div><span>{modeCopy.gap}</span><strong>{displayValue(actual - target)}</strong><small>{actual >= target ? "สูงกว่าเป้าหมาย" : `ยังขาด ${unit}`}</small></article>
      </section>

      <section className="section shell">
        <div className="section-heading"><div><span className="section-number">01</span><h2>Performance by Brand</h2><p>{metricLabel} • {modeCopy.title} • {shopName} • MoM vs Jul<br /><span className="brand-wow-context">{wow.range.id}: {shortDateRange(wow.period.currentStart, wow.period.currentEnd)} เทียบ {shortDateRange(wow.period.baseStart, wow.period.baseEnd)} • จำนวนวันเท่ากัน {wow.period.currentDays} วัน</span></p></div><div className="legend"><i className="target" /> {modeCopy.target} <i className="actual" /> {modeCopy.actual}</div></div>
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
          <div className="panel-head"><div><span className="section-number">02</span><h2>Daily Trend</h2><p>{metric === "net" ? "Net Amount" : "Qty"} • ยอดขายจริงรายวัน 1–{selectedDay} Aug</p></div><div className="trend-legend"><span><i className="actual-dot" /> Daily Sales</span></div></div>
          <div className="daily-chart" aria-label="กราฟยอดขายรายวัน">
            {trend.map((item) => <div className="day-column" key={item.day} aria-label={`${item.day} Aug: ${displayValue(item.actual)}`}><div className="bar-space"><div className="actual-bar" title={`${item.day} Aug: ${displayValue(item.actual)}`} style={{ height: `${(item.actual / trendMax) * 100}%`, background: selectedColor }}><span>{metric === "net" ? compactChart(item.actual) : number.format(item.actual)}</span></div></div><small>{item.day}</small></div>)}
          </div>
          <div className="trend-foot"><span>1 Aug</span><b>ยอดขายรวม 1–{selectedDay} Aug {displayValue(trendTotal)}</b><span>{selectedDay} Aug</span></div>
        </div>
        <aside className="focus-panel panel"><span className="section-number">PERFORMANCE FOCUS</span><h2>{metricLabel}</h2><p>{selectedBrand === "ALL" ? "ALL BRANDS" : selectedBrand} • {shopName}</p><div className="focus-meter"><span style={{ width: `${Math.min(achievement, 100)}%`, background: selectedColor }} /></div><div className="focus-stats"><span><small>{modeCopy.actual}</small><strong>{displayValue(actual)}</strong><small>{modeCopy.title}</small></span><span><small>{modeCopy.target}</small><strong>{displayValue(target)}</strong><small>{modeCopy.title}</small></span></div><div className="pace-note"><span>{modeCopy.short}</span><p>{viewMode === "runrate" ? `ประมาณการสิ้นเดือนจากยอดขายเฉลี่ย ${selectedDay} วัน` : `ข้อมูลถึงวันที่ ${thaiDate(selectedDay)}`} • เลือก Net Amount / Qty ได้ทันที</p></div></aside>
      </section>

      <section className={`section model-area-section shell ${matrixCapture ? "capture-mode" : ""}`} aria-labelledby="model-area-title">
        <div className="section-heading model-area-heading">
          <div><span className="section-number">03</span><h2 id="model-area-title">Model x Area · Ranking</h2><p>Top {modelAreaMatrix.topBrands.length} Brand ตาม {modeCopy.actual} {metricLabel} • {viewMode === "day" ? `วันที่ ${selectedDay} Aug` : viewMode === "runrate" ? `ประมาณการสิ้นเดือนจากยอดสะสมถึง ${selectedDay} Aug` : `ยอดสะสมถึง ${selectedDay} Aug`} • รวมสาขาที่ไม่มี Target แต่มียอดขาย</p></div>
          <div className="matrix-actions"><button className={`capture-view-button ${matrixCapture ? "active" : ""}`} type="button" aria-pressed={matrixCapture} onClick={toggleMatrixCapture}><span aria-hidden="true">{matrixCapture ? "×" : "▣"}</span>{matrixCapture ? "ออกจาก Capture" : "Capture View"}</button><div className="matrix-ranking-control" role="group" aria-label="เลือกเกณฑ์จัดอันดับสี"><span>จัดสีตามอันดับ</span><div className="segmented"><button className={matrixRanking === "rank" ? "selected" : ""} onClick={() => setMatrixRanking("rank")}>Rank</button><button className={matrixRanking === "achieve" ? "selected" : ""} onClick={() => setMatrixRanking("achieve")}>% Ach</button><button className={matrixRanking === "runrate" ? "selected" : ""} onClick={() => setMatrixRanking("runrate")}>%Runrate</button></div></div></div>
        </div>
        <div className="matrix-legend"><span><i className="matrix-swatch best" /> อันดับสูง</span><span><i className="matrix-swatch middle" /> กลาง</span><span><i className="matrix-swatch low" /> ต้องเร่ง</span><small>{matrixCapture ? "Capture View แสดงทุก Brand ในภาพเดียว • กด Esc เพื่อออก" : "คลิกชื่อคอลัมน์เพื่อเรียงสาขา • เลื่อนเมาส์ที่ตัวเลขเพื่อดูยอด, Run Rate และ Target"}</small></div>
        <div className="model-area-wrap">
          <table className="model-area-table">
            <thead><tr><th>Shop / Area</th><th className={`all-model-column ${modelAreaMatrix.activeSort === "ALL" ? "sorted" : ""}`}><button onClick={() => setMatrixSortBrand("ALL")}><strong>ALL MODEL</strong><small>รวมทุก Brand/รุ่น</small></button></th>{modelAreaMatrix.topBrands.map((brand) => <th className={`brand-column-header ${selectedBrand === brand ? "selected-brand-column" : ""} ${modelAreaMatrix.activeSort === brand ? "sorted" : ""}`} style={{ "--brand": brandColors[brand] ?? "#64748b" } as React.CSSProperties} key={brand}><button onClick={() => setMatrixSortBrand(brand)}><strong>{brand}</strong><small>คลิกเพื่อเรียง</small></button></th>)}</tr></thead>
            <tbody>
              <tr className="all-shop-row"><th><strong>ALL Shop</strong><small>ผลรวมทุกสาขา · ไม่จัดอันดับ</small></th><td>{matrixCell(modelAreaMatrix.allShop.all, undefined, true)}</td>{modelAreaMatrix.topBrands.map((brand) => <td className={selectedBrand === brand ? "selected-brand-column" : ""} key={brand}>{matrixCell(modelAreaMatrix.allShop.brands[brand], undefined, true)}</td>)}</tr>
              {modelAreaMatrix.shopRows.map((row) => <tr key={row.code}><th><strong>{row.shop}</strong><small>{row.code}{row.all.monthlyTarget <= 0 && row.all.mtdActual > 0 ? " · No Target" : ""}</small></th><td className="all-model-column">{matrixCell(row.all, modelAreaMatrix.ranks.get(`ALL|${row.code}`))}</td>{modelAreaMatrix.topBrands.map((brand) => <td className={selectedBrand === brand ? "selected-brand-column" : ""} key={brand}>{matrixCell(row.brands[brand], modelAreaMatrix.ranks.get(`${brand}|${row.code}`))}</td>)}</tr>)}
            </tbody>
          </table>
        </div>
      </section>

      <section className="section shop-performance-section shell">
        <div className="section-heading shop-heading"><div><span className="section-number">04</span><h2>Shop Performance</h2><p>{selectedBrand === "ALL" ? "สาขาที่มี Target หรือยอดขายใน BMAV" : `สาขาที่มี Target หรือยอดขาย ${selectedBrand}`} • {modeCopy.title} • MoM เทียบ Jul</p></div><span className="shop-count">{shopViews.length} สาขา</span></div>
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
