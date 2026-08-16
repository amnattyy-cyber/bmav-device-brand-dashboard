"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fallbackData, loadGoogleSheetData, sheetRefreshInterval, type DataRow } from "./google-sheet-data";

type Metric = "net" | "qty";
type ViewMode = "day" | "mtd" | "achieve" | "runrate";
type SourceStatus = "loading" | "live" | "fallback";
type WeekRange = { start: number; end: number; label: string };
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
const weekRanges: WeekRange[] = [
  { start: 1, end: 7, label: "1–7 Aug" },
  { start: 8, end: 14, label: "8–14 Aug" },
  { start: 15, end: 21, label: "15–21 Aug" },
  { start: 22, end: 28, label: "22–28 Aug" },
  { start: 29, end: 31, label: "29–31 Aug" },
];
const weekIndexForDay = (day: number) => Math.max(0, weekRanges.findIndex((range) => day >= range.start && day <= range.end));
const rangeSum = (values: number[] | undefined, start: number, end: number) => (values ?? []).slice(start - 1, end).reduce((sum, value) => sum + value, 0);
const changeRate = (current: number, previous: number) => previous ? ((current - previous) / previous) * 100 : current ? 100 : 0;
const signed = (value: number, digits = 1) => `${value > 0 ? "+" : ""}${value.toFixed(digits)}%`;

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
  const [viewMode, setViewMode] = useState<ViewMode>("mtd");
  const [selectedBrand, setSelectedBrand] = useState("ALL");
  const [selectedShops, setSelectedShops] = useState<string[]>([]);
  const [selectedDay, setSelectedDay] = useState(Number(fallbackData.latest.slice(-2)));
  const [selectedWeek, setSelectedWeek] = useState(weekIndexForDay(Number(fallbackData.latest.slice(-2))));
  const previousLatestDay = useRef(Number(fallbackData.latest.slice(-2)));
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
    const priorLatestDay = previousLatestDay.current;
    setSelectedDay((current) => current === priorLatestDay ? latestDay : Math.min(current, latestDay));
    setSelectedWeek((current) => current === weekIndexForDay(priorLatestDay) ? weekIndexForDay(latestDay) : current);
    previousLatestDay.current = latestDay;
  }, [latestDay]);

  const shopOptions = useMemo(() => {
    const rows = selectedBrand === "ALL" ? data.shops : data.shops.filter((row) => row.brand === selectedBrand);
    return [...new Map(rows.map((row) => [row.code, row.shop])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [data.shops, selectedBrand]);

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
    return { ...brand, viewTarget: view.target, viewActual: view.actual, viewPrevious: view.previous, viewAchievement: view.achievement };
  }).filter((row) => row.viewTarget > 0), [data.brands, data.shops, getViewMetrics, selectedShops]);

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
        return { ...row, viewTarget: view.target, viewActual: view.actual, viewPrevious: view.previous, viewAchievement: view.achievement };
      })
      .filter((row) => row.viewTarget > 0)
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
  const previousColumnLabel = viewMode === "runrate" ? "Run Rate Jul" : viewMode === "day" ? "Actual Jul" : "Actual Jul MTD";
  const scoreRingLabel = viewMode === "runrate" ? "PROJECTED ACHIEVE" : viewMode === "achieve" ? "ACHIEVE TO DATE" : `${modeCopy.short} ACHIEVEMENT`;

  const wow = useMemo(() => {
    const range = weekRanges[selectedWeek];
    const currentEnd = Math.min(range.end, latestDay);
    const currentDays = Math.max(0, currentEnd - range.start + 1);
    const snapshot = (row: DataRow, previous = false): WeekSnapshot => {
      if (!currentDays) return { net: 0, qty: 0 };
      if (previous && selectedWeek === 0) {
        const previousMonthEnd = previousMonthDays;
        return {
          net: rangeSum(row.previousDailyNet, previousMonthEnd - currentDays + 1, previousMonthEnd),
          qty: rangeSum(row.previousDailyQty, previousMonthEnd - currentDays + 1, previousMonthEnd),
        };
      }
      const start = previous ? weekRanges[selectedWeek - 1].start : range.start;
      return {
        net: rangeSum(row.dailyNet, start, start + currentDays - 1),
        qty: rangeSum(row.dailyQty, start, start + currentDays - 1),
      };
    };
    const rows = data.shops.filter((row) => (selectedBrand === "ALL" || row.brand === selectedBrand) && (selectedShops.length === 0 || selectedShops.includes(row.code)));
    const current = snapshot(combineRows(rows));
    const previous = snapshot(combineRows(rows), true);
    const overallCurrentNet = snapshot(combineRows(data.shops)).net;
    const overallPreviousNet = snapshot(combineRows(data.shops), true).net;
    const decorate = (name: string, row: DataRow) => {
      const now = snapshot(row);
      const before = snapshot(row, true);
      const currentShare = overallCurrentNet ? (now.net / overallCurrentNet) * 100 : 0;
      const previousShare = overallPreviousNet ? (before.net / overallPreviousNet) * 100 : 0;
      return { name, current: now, previous: before, deltaNet: now.net - before.net, deltaQty: now.qty - before.qty, currentShare, shareDelta: currentShare - previousShare };
    };
    const brandDrivers = [...new Set(rows.map((row) => row.brand))].map((brand) => decorate(brand, combineRows(rows.filter((row) => row.brand === brand)))).sort((a, b) => b.deltaNet - a.deltaNet);
    const shopDrivers = [...new Set(rows.map((row) => row.code))].map((code) => {
      const items = rows.filter((row) => row.code === code);
      return decorate(items[0]?.shop ?? code, combineRows(items));
    }).sort((a, b) => b.deltaNet - a.deltaNet);
    const netRate = changeRate(current.net, previous.net);
    const qtyRate = changeRate(current.qty, previous.qty);
    const currentAsp = current.qty ? current.net / current.qty : 0;
    const previousAsp = previous.qty ? previous.net / previous.qty : 0;
    const aspRate = changeRate(currentAsp, previousAsp);
    const leadBrand = netRate >= 0 ? brandDrivers[0] : brandDrivers.at(-1);
    const leadShop = netRate >= 0 ? shopDrivers[0] : shopDrivers.at(-1);
    const direction = netRate >= 0 ? "เติบโต" : "ชะลอ";
    const cause = Math.abs(qtyRate) >= Math.abs(aspRate) ? `QTY ${signed(qtyRate)} เป็นสัญญาณหลัก` : `มูลค่าต่อเครื่อง ${signed(aspRate)} เป็นสัญญาณหลัก`;
    const action = netRate < 0
      ? `เร่งกู้ยอดที่ ${leadShop?.name ?? "สาขาที่ติดลบ"} โดยโฟกัส ${leadBrand?.name ?? "Brand ที่ลดลง"}; ${qtyRate < 0 ? "เพิ่ม conversion และ stock รุ่นขายดี" : "ดัน mix รุ่นมูลค่าสูงและ attach offer"}`
      : `รักษาแรงส่ง ${leadBrand?.name ?? "Brand นำ"} ที่ ${leadShop?.name ?? "สาขานำ"} และถอด playbook ไปยังสาขาที่ contribution ลดลง`;
    const previousLabel = selectedWeek === 0 ? `${previousMonthDays - currentDays + 1}–${previousMonthDays} Jul` : `${weekRanges[selectedWeek - 1].start}–${weekRanges[selectedWeek - 1].start + currentDays - 1} Aug`;
    return { range, currentEnd, currentDays, current, previous, netRate, qtyRate, currentAsp, previousAsp, aspRate, brandDrivers, shopDrivers, leadBrand, leadShop, direction, cause, action, previousLabel };
  }, [data.shops, latestDay, previousMonthDays, selectedBrand, selectedShops, selectedWeek]);

  const brandWow = useMemo(() => {
    const range = weekRanges[selectedWeek];
    const currentEnd = Math.min(range.end, latestDay);
    const currentDays = Math.max(0, currentEnd - range.start + 1);
    const snapshot = (row: DataRow, previous = false): WeekSnapshot => {
      if (!currentDays) return { net: 0, qty: 0 };
      if (previous && selectedWeek === 0) {
        return {
          net: rangeSum(row.previousDailyNet, previousMonthDays - currentDays + 1, previousMonthDays),
          qty: rangeSum(row.previousDailyQty, previousMonthDays - currentDays + 1, previousMonthDays),
        };
      }
      const start = previous ? weekRanges[selectedWeek - 1].start : range.start;
      return {
        net: rangeSum(row.dailyNet, start, start + currentDays - 1),
        qty: rangeSum(row.dailyQty, start, start + currentDays - 1),
      };
    };

    return new Map(data.brands.map(({ brand }) => {
      const rows = data.shops.filter((shop) => shop.brand === brand && (selectedShops.length === 0 || selectedShops.includes(shop.code)));
      const row = combineRows(rows);
      const current = snapshot(row)[metric];
      const previous = snapshot(row, true)[metric];
      return [brand, { current, previous, rate: previous > 0 ? changeRate(current, previous) : null }] as const;
    }));
  }, [data.brands, data.shops, latestDay, metric, previousMonthDays, selectedShops, selectedWeek]);

  return (
    <main>
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
        <div className="filter-group shop-filter"><span className="filter-label">สาขา</span><details className="shop-multiselect"><summary><span>{selectedShops.length === 0 ? "ทุกสาขาที่มี Target" : `${selectedShops.length} สาขาที่เลือก`}</span><b aria-hidden="true">⌄</b></summary><div className="shop-menu"><label className="shop-option all-shops"><input type="checkbox" checked={selectedShops.length === 0} onChange={() => setSelectedShops([])} /><span>ทุกสาขาที่มี Target</span></label><div className="shop-option-list">{shopOptions.map(([code, shop]) => <label className="shop-option" key={code}><input type="checkbox" checked={selectedShops.includes(code)} onChange={() => toggleShop(code)} /><span>{shop}</span></label>)}</div></div></details></div>
        <div className="filter-group performance-filter"><span className="filter-label">Performance</span><div className="segmented performance-segmented"><button className={viewMode === "mtd" ? "selected" : ""} onClick={() => setViewMode("mtd")}>MTD</button><button className={viewMode === "achieve" ? "selected" : ""} onClick={() => setViewMode("achieve")}>Achieve TD</button><button className={viewMode === "runrate" ? "selected" : ""} onClick={() => setViewMode("runrate")}>Run Rate</button><button className={viewMode === "day" ? "selected" : ""} onClick={() => setViewMode("day")}>Daily</button></div></div>
        <div className="filter-group"><label htmlFor="date-filter">วันที่ขาย</label><input id="date-filter" type="date" min={`${monthPrefix}-01`} max={data.latest} value={formatDate(selectedDay)} onChange={(event) => setSelectedDay(Number(event.target.value.slice(-2)))} /></div>
      </section>

      <section className="context-line shell"><span>{metricLabel}</span><b>{selectedBrand === "ALL" ? "ALL BRANDS" : selectedBrand}</b><b>{shopName}</b><b>{modeCopy.title} ณ {thaiDate(selectedDay)}</b></section>

      <section className="section wow-section shell" aria-labelledby="wow-title">
        <div className="section-heading wow-heading"><div><span className="section-number">WOW</span><h2 id="wow-title">Week on Week by Brand</h2><p>เทียบช่วงวันเท่ากัน • Net Amount, QTY, drivers และสัญญาณเชิงพาณิชย์</p></div><span className={`wow-status ${wow.netRate >= 0 ? "up" : "down"}`}>{wow.direction} {signed(wow.netRate)}</span></div>
        <div className="week-picker" role="group" aria-label="เลือกช่วง Week on Week">
          {weekRanges.map((range, index) => <button key={range.label} className={selectedWeek === index ? "selected" : ""} onClick={() => setSelectedWeek(index)} disabled={range.start > latestDay}><span>{range.label}</span><small>{range.start > latestDay ? "ยังไม่มีข้อมูล" : index === weekIndexForDay(latestDay) && latestDay < range.end ? `ถึง ${latestDay} Aug` : "พร้อมวิเคราะห์"}</small></button>)}
        </div>
        <div className="wow-context"><b>{wow.range.label}{wow.currentEnd < wow.range.end ? ` (ข้อมูลถึง ${wow.currentEnd} Aug)` : ""}</b><span>เทียบ {wow.previousLabel}</span><span>{selectedBrand === "ALL" ? "ทุก Brand" : selectedBrand} • {shopName}</span></div>
        <div className="wow-kpis">
          <article><span>Net Amount</span><strong>฿{integer.format(wow.current.net)}</strong><small>สัปดาห์ก่อน ฿{integer.format(wow.previous.net)}</small><em className={wow.current.net >= wow.previous.net ? "positive" : "negative"}>{wow.current.net - wow.previous.net >= 0 ? "+" : ""}฿{integer.format(wow.current.net - wow.previous.net)} • {signed(wow.netRate)}</em></article>
          <article><span>QTY</span><strong>{integer.format(wow.current.qty)} เครื่อง</strong><small>สัปดาห์ก่อน {integer.format(wow.previous.qty)} เครื่อง</small><em className={wow.current.qty >= wow.previous.qty ? "positive" : "negative"}>{wow.current.qty - wow.previous.qty >= 0 ? "+" : ""}{integer.format(wow.current.qty - wow.previous.qty)} • {signed(wow.qtyRate)}</em></article>
          <article><span>มูลค่าต่อเครื่อง</span><strong>฿{integer.format(wow.currentAsp)}</strong><small>สัปดาห์ก่อน ฿{integer.format(wow.previousAsp)}</small><em className={wow.currentAsp >= wow.previousAsp ? "positive" : "negative"}>{signed(wow.aspRate)} WoW</em></article>
          <article><span>Shop contribution signal</span><strong>{wow.leadShop?.name ?? "—"}</strong><small>{wow.netRate >= 0 ? "สาขาผลักดันหลัก" : "สาขาตัวฉุดหลัก"}</small><em className={(wow.leadShop?.shareDelta ?? 0) >= 0 ? "positive" : "negative"}>{signed(wow.leadShop?.shareDelta ?? 0)} pts share</em></article>
        </div>
        <div className="wow-analysis-grid">
          <article className="driver-panel"><header><div><span>BRAND DRIVER</span><h3>ตัวผลักดัน / ตัวฉุด</h3></div><small>Δ Net Amount</small></header><div className="driver-list">{[...wow.brandDrivers.slice(0, 2), ...wow.brandDrivers.slice(-2).reverse().filter((driver) => !wow.brandDrivers.slice(0, 2).includes(driver))].map((driver) => <div key={driver.name}><b>{driver.name}</b><span className={driver.deltaNet >= 0 ? "positive" : "negative"}>{driver.deltaNet >= 0 ? "+" : ""}฿{compactChart(driver.deltaNet)}</span><small>QTY {driver.deltaQty >= 0 ? "+" : ""}{integer.format(driver.deltaQty)} • Share {signed(driver.shareDelta)} pts</small></div>)}</div></article>
          <article className="driver-panel"><header><div><span>SHOP DRIVER</span><h3>สาขาที่ต้องจับตา</h3></div><small>Δ Net Amount</small></header><div className="driver-list">{wow.shopDrivers.slice(0, 2).map((driver) => <div key={driver.name}><b>{driver.name}</b><span className={driver.deltaNet >= 0 ? "positive" : "negative"}>{driver.deltaNet >= 0 ? "+" : ""}฿{compactChart(driver.deltaNet)}</span><small>QTY {driver.deltaQty >= 0 ? "+" : ""}{integer.format(driver.deltaQty)} • Share {signed(driver.shareDelta)} pts</small></div>)}{wow.shopDrivers.slice(-2).reverse().filter((driver) => !wow.shopDrivers.slice(0, 2).includes(driver)).map((driver) => <div key={driver.name}><b>{driver.name}</b><span className={driver.deltaNet >= 0 ? "positive" : "negative"}>{driver.deltaNet >= 0 ? "+" : ""}฿{compactChart(driver.deltaNet)}</span><small>QTY {driver.deltaQty >= 0 ? "+" : ""}{integer.format(driver.deltaQty)} • Share {signed(driver.shareDelta)} pts</small></div>)}</div></article>
          <aside className="action-panel"><span>INSIGHT → ACTION</span><h3>สัปดาห์นี้ยอด{wow.direction}</h3><p><b>สัญญาณ:</b> {wow.cause} ขณะที่ Shop contribution ของ {wow.leadShop?.name ?? "สาขาหลัก"} เปลี่ยน {signed(wow.leadShop?.shareDelta ?? 0)} pts</p><div><small>ACTION ชี้เป้า</small><strong>{wow.action}</strong></div></aside>
        </div>
      </section>

      <section className="kpi-grid shell">
        <article className="kpi-card purple"><div className="kpi-icon">T</div><span>{modeCopy.target} {metricLabel}</span><strong>{displayValue(target)}</strong><small>{viewMode === "day" ? "เป้าหมายเฉลี่ยต่อวัน" : viewMode === "runrate" ? "เป้าหมายเต็มเดือน" : `เป้าหมายสะสม ${selectedDay} วัน`}</small></article>
        <article className="kpi-card blue"><div className="kpi-icon">A</div><span>{modeCopy.actual} {metricLabel}</span><strong>{displayValue(actual)}</strong><small>{viewMode === "day" ? `ยอดขายวันที่ ${selectedDay} Aug` : viewMode === "runrate" ? `ประมาณการจากยอดสะสม ${selectedDay} วัน` : "ยอดขายสะสมถึงวันที่เลือก"}</small></article>
        <article className="kpi-card orange"><div className="kpi-icon">%</div><span>{modeCopy.achievement}</span><strong>{achievement.toFixed(1)}%</strong><small>{viewMode === "runrate" ? "คาดการณ์เทียบ Target เต็มเดือน" : viewMode === "day" ? "เทียบ Target Daily" : "เทียบ Target ถึงปัจจุบัน"}</small></article>
        <article className="kpi-card green"><div className="kpi-icon">G</div><span>{modeCopy.gap}</span><strong>{displayValue(actual - target)}</strong><small>{actual >= target ? "สูงกว่าเป้าหมาย" : `ยังขาด ${unit}`}</small></article>
      </section>

      <section className="section shell">
        <div className="section-heading"><div><span className="section-number">01</span><h2>Performance by Brand</h2><p>{metricLabel} • {modeCopy.title} • {shopName} • MoM vs Jul<br /><span className="brand-wow-context">WoW {wow.range.label}{wow.currentEnd < wow.range.end ? ` (ข้อมูลถึง ${wow.currentEnd} Aug)` : ""} เทียบ {wow.previousLabel} • จำนวนวันเท่ากัน</span></p></div><div className="legend"><i className="target" /> {modeCopy.target} <i className="actual" /> {modeCopy.actual}</div></div>
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

      <section className="section shop-performance-section shell">
        <div className="section-heading shop-heading"><div><span className="section-number">03</span><h2>Shop Performance</h2><p>{selectedBrand === "ALL" ? "สาขาที่มี Target ใน BMAV" : `เฉพาะสาขาที่มี Target ${selectedBrand}`} • {modeCopy.title} • MoM เทียบ Jul</p></div><span className="shop-count">{shopViews.length} สาขา</span></div>
        <div className="shop-table-wrap"><table><thead><tr><th>อันดับ</th><th>สาขา</th><th>Target</th><th>Actual Aug</th><th>{previousColumnLabel}</th><th>MoM</th><th>Achievement</th><th>Gap</th></tr></thead><tbody>
          {shopViews.map((shop, index) => <tr key={shop.code}><td><span className={`rank ${index < 3 ? "top" : ""}`}>{index + 1}</span></td><td className="shop-name"><strong>{shop.shop}</strong></td><td>{tableValue(shop.viewTarget)}</td><td><b>{tableValue(shop.viewActual)}</b></td><td>{tableValue(shop.viewPrevious)}</td><td><span className={`mom-value ${momTone(shop.viewActual, shop.viewPrevious)}`}>{momLabel(shop.viewActual, shop.viewPrevious)}</span></td><td><div className="achievement-cell"><div><span style={{ width: `${Math.min(shop.viewAchievement, 100)}%` }} /></div><em className={tone(shop.viewAchievement)}>{shop.viewAchievement.toFixed(1)}%</em></div></td><td className={shop.viewActual - shop.viewTarget >= 0 ? "positive-gap" : "gap"}>{tableValue(shop.viewActual - shop.viewTarget)}</td></tr>)}
        </tbody></table></div>
      </section>

      <footer className="shell"><div><strong>BMAV</strong><span>Device by Brand Dashboard</span></div><p><span className={`source-badge ${sourceStatus}`}>{sourceStatus === "live" ? "LIVE · Google Sheet" : sourceStatus === "loading" ? "กำลังอัปเดต" : "ข้อมูลสำรอง"}</span> Last updated {thaiDate(latestDay)}{lastSync ? ` · Sync ${lastSync.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })}` : ""}</p></footer>
    </main>
  );
}
