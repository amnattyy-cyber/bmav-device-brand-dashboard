"use client";

import { useMemo, useState } from "react";
import data from "./dashboard-data.json";

type Metric = "net" | "qty";
type Period = "mtd" | "day";
type DataRow = {
  brand?: string;
  code?: string;
  shop?: string;
  targetQty: number;
  targetNet: number;
  dailyQty: number[];
  dailyNet: number[];
};

const brandColors: Record<string, string> = {
  IPHONE: "#7c3aed", SAMSUNG: "#2563eb", IPAD: "#8b5cf6", VIVO: "#06b6d4",
  OPPO: "#16a34a", XIAOMI: "#f97316", HUAWEI: "#e11d48", HONOR: "#0891b2",
  INFINIX: "#65a30d", NOTHING: "#111827", REALME: "#eab308", ALLDOCUBE: "#64748b",
};

const number = new Intl.NumberFormat("th-TH", { maximumFractionDigits: 1 });
const integer = new Intl.NumberFormat("th-TH", { maximumFractionDigits: 0 });
const compact = (value: number) => value >= 1_000_000 ? `${(value / 1_000_000).toFixed(2)}M` : integer.format(value);
const latestDay = Number(data.latest.slice(-2));
const formatDate = (day: number) => `2026-08-${String(day).padStart(2, "0")}`;
const thaiDate = (day: number) => new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", year: "numeric" }).format(new Date(`${formatDate(day)}T00:00:00+07:00`));
const sumTo = (values: number[], day: number) => values.slice(0, day).reduce((sum, value) => sum + value, 0);

const emptyRow = (): DataRow => ({ targetQty: 0, targetNet: 0, dailyQty: Array(31).fill(0), dailyNet: Array(31).fill(0) });
const combineRows = (rows: DataRow[]): DataRow => rows.reduce((total, row) => ({
  targetQty: total.targetQty + row.targetQty,
  targetNet: total.targetNet + row.targetNet,
  dailyQty: total.dailyQty.map((value, index) => value + (row.dailyQty[index] || 0)),
  dailyNet: total.dailyNet.map((value, index) => value + (row.dailyNet[index] || 0)),
}), emptyRow());

function tone(value: number) {
  if (value >= 100) return "great";
  if (value >= 70) return "good";
  if (value >= 40) return "watch";
  return "risk";
}

export default function Home() {
  const [metric, setMetric] = useState<Metric>("net");
  const [period, setPeriod] = useState<Period>("mtd");
  const [selectedBrand, setSelectedBrand] = useState("ALL");
  const [selectedShop, setSelectedShop] = useState("ALL");
  const [selectedDay, setSelectedDay] = useState(latestDay);
  const [showAllShops, setShowAllShops] = useState(false);

  const shopOptions = useMemo(() => {
    const rows = selectedBrand === "ALL" ? data.shops : data.shops.filter((row) => row.brand === selectedBrand);
    return [...new Map(rows.map((row) => [row.code, row.shop])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [selectedBrand]);

  const chooseBrand = (brand: string) => {
    setSelectedBrand(brand);
    setShowAllShops(false);
    if (selectedShop !== "ALL" && !data.shops.some((row) => row.brand === brand && row.code === selectedShop)) setSelectedShop("ALL");
  };

  const scopeRow = useMemo<DataRow>(() => {
    if (selectedShop !== "ALL") {
      const rows = data.shops.filter((row) => row.code === selectedShop && (selectedBrand === "ALL" || row.brand === selectedBrand));
      return combineRows(rows);
    }
    if (selectedBrand !== "ALL") return data.brands.find((row) => row.brand === selectedBrand) ?? emptyRow();
    return data.totals;
  }, [selectedBrand, selectedShop]);

  const monthlyTarget = metric === "net" ? scopeRow.targetNet : scopeRow.targetQty;
  const dailyValues = metric === "net" ? scopeRow.dailyNet : scopeRow.dailyQty;
  const actual = period === "mtd" ? sumTo(dailyValues, selectedDay) : dailyValues[selectedDay - 1] || 0;
  const target = (monthlyTarget / 31) * (period === "mtd" ? selectedDay : 1);
  const achievement = target ? (actual / target) * 100 : 0;
  const metricLabel = metric === "net" ? "Net Amount" : "Quantity";
  const unit = metric === "net" ? "บาท" : "เครื่อง";
  const displayValue = (value: number) => metric === "net" ? `฿${compact(value)}` : number.format(value);

  const brandViews = useMemo(() => data.brands.map((brand) => {
    const row: DataRow = selectedShop === "ALL" ? brand : (data.shops.find((shop) => shop.brand === brand.brand && shop.code === selectedShop) ?? emptyRow());
    const values = metric === "net" ? row.dailyNet : row.dailyQty;
    const rowTarget = ((metric === "net" ? row.targetNet : row.targetQty) / 31) * (period === "mtd" ? selectedDay : 1);
    const rowActual = period === "mtd" ? sumTo(values, selectedDay) : values[selectedDay - 1] || 0;
    return { ...brand, viewTarget: rowTarget, viewActual: rowActual, viewAchievement: rowTarget ? (rowActual / rowTarget) * 100 : 0 };
  }).filter((row) => row.viewTarget > 0), [metric, period, selectedDay, selectedShop]);

  const shopViews = useMemo(() => {
    const rows: DataRow[] = selectedBrand === "ALL"
      ? [...new Set(data.shops.map((row) => row.code))].map((code) => {
          const items = data.shops.filter((row) => row.code === code);
          return { ...combineRows(items), code, shop: items[0]?.shop ?? code };
        })
      : data.shops.filter((row) => row.brand === selectedBrand);
    return rows
      .filter((row) => selectedShop === "ALL" || row.code === selectedShop)
      .map((row) => {
        const values = metric === "net" ? row.dailyNet : row.dailyQty;
        const rowTarget = ((metric === "net" ? row.targetNet : row.targetQty) / 31) * (period === "mtd" ? selectedDay : 1);
        const rowActual = period === "mtd" ? sumTo(values, selectedDay) : values[selectedDay - 1] || 0;
        return { ...row, viewTarget: rowTarget, viewActual: rowActual, viewAchievement: rowTarget ? (rowActual / rowTarget) * 100 : 0 };
      })
      .filter((row) => row.viewTarget > 0)
      .sort((a, b) => b.viewAchievement - a.viewAchievement);
  }, [metric, period, selectedBrand, selectedShop, selectedDay]);

  const trend = useMemo(() => Array.from({ length: selectedDay }, (_, index) => {
    const day = index + 1;
    return {
      day,
      actual: period === "mtd" ? sumTo(dailyValues, day) : dailyValues[index] || 0,
      runRate: (monthlyTarget / 31) * (period === "mtd" ? day : 1),
    };
  }), [dailyValues, monthlyTarget, period, selectedDay]);
  const trendMax = Math.max(...trend.flatMap((item) => [item.actual, item.runRate]), 1);
  const selectedColor = selectedBrand === "ALL" ? "#7c3aed" : brandColors[selectedBrand] ?? "#7c3aed";
  const displayedShops = showAllShops ? shopViews : shopViews.slice(0, 10);
  const shopName = selectedShop === "ALL" ? "ทุกสาขา" : shopOptions.find(([code]) => code === selectedShop)?.[1] ?? selectedShop;

  return (
    <main>
      <section className="hero shell">
        <div className="hero-copy">
          <div className="eyebrow"><span className="live-dot" /> BMAV • DEVICE PERFORMANCE</div>
          <h1>Device by Brand<br /><span>August 2026</span></h1>
          <p>Dashboard ที่ Focus ด้าน Net Amount พร้อมสลับดู Qty, เลือก Brand, สาขา, วันที่ขาย และมุมมอง Daily หรือ MTD ได้ในหน้าเดียว</p>
          <a className="download-button" href="https://bmav-device-brand-aug26.amnattyy.chatgpt.site/BMAV_Device_By_Brand_Dashboard.xlsx">ดาวน์โหลด Excel <span aria-hidden="true">↓</span></a>
        </div>
        <div className="hero-visual" aria-label={`Achievement ${achievement.toFixed(1)}%`}>
          <div className="orbit orbit-one" /><div className="orbit orbit-two" />
          <div className="score-ring" style={{ "--score": Math.min(achievement, 100), "--accent": selectedColor } as React.CSSProperties}>
            <div><strong>{achievement.toFixed(1)}%</strong><span>{period === "mtd" ? "MTD" : "DAILY"} ACHIEVEMENT</span></div>
          </div>
          <div className="as-of">ข้อมูล ณ {thaiDate(selectedDay)}</div>
        </div>
      </section>

      <section className="filter-dock shell" aria-label="ตัวกรอง Dashboard">
        <div className="filter-group metric-filter"><span className="filter-label">มุมมองหลัก</span><div className="segmented"><button className={metric === "net" ? "selected" : ""} onClick={() => setMetric("net")}>Net Amount</button><button className={metric === "qty" ? "selected" : ""} onClick={() => setMetric("qty")}>Qty</button></div></div>
        <div className="filter-group"><label htmlFor="brand-filter">Brand</label><select id="brand-filter" value={selectedBrand} onChange={(event) => chooseBrand(event.target.value)}><option value="ALL">ALL BRANDS</option>{data.brands.map((row) => <option key={row.brand} value={row.brand}>{row.brand}</option>)}</select></div>
        <div className="filter-group shop-filter"><label htmlFor="shop-filter">สาขา</label><select id="shop-filter" value={selectedShop} onChange={(event) => { setSelectedShop(event.target.value); setShowAllShops(false); }}><option value="ALL">ทุกสาขาที่มี Target</option>{shopOptions.map(([code, shop]) => <option key={code} value={code}>{shop}</option>)}</select></div>
        <div className="filter-group"><span className="filter-label">ช่วงเวลา</span><div className="segmented"><button className={period === "mtd" ? "selected" : ""} onClick={() => setPeriod("mtd")}>MTD</button><button className={period === "day" ? "selected" : ""} onClick={() => setPeriod("day")}>Daily</button></div></div>
        <div className="filter-group"><label htmlFor="date-filter">วันที่ขาย</label><input id="date-filter" type="date" min="2026-08-01" max={data.latest} value={formatDate(selectedDay)} onChange={(event) => setSelectedDay(Number(event.target.value.slice(-2)))} /></div>
      </section>

      <section className="context-line shell"><span>{metricLabel}</span><b>{selectedBrand === "ALL" ? "ALL BRANDS" : selectedBrand}</b><b>{shopName}</b><b>{period === "mtd" ? "MTD" : "Daily"} ณ {thaiDate(selectedDay)}</b></section>

      <section className="kpi-grid shell">
        <article className="kpi-card purple"><div className="kpi-icon">T</div><span>Target {metricLabel}</span><strong>{displayValue(target)}</strong><small>{period === "mtd" ? `สะสม ${selectedDay} วัน` : "เป้าหมายเฉลี่ยต่อวัน"}</small></article>
        <article className="kpi-card blue"><div className="kpi-icon">A</div><span>Actual {metricLabel}</span><strong>{displayValue(actual)}</strong><small>{period === "mtd" ? "ยอดขายสะสม" : `ยอดขายวันที่ ${selectedDay} Aug`}</small></article>
        <article className="kpi-card orange"><div className="kpi-icon">%</div><span>Achievement</span><strong>{achievement.toFixed(1)}%</strong><small>เทียบ Target {period === "mtd" ? "MTD" : "Daily"}</small></article>
        <article className="kpi-card green"><div className="kpi-icon">G</div><span>Gap to Target</span><strong>{displayValue(actual - target)}</strong><small>{actual >= target ? "สูงกว่าเป้าหมาย" : `ยังขาด ${unit}`}</small></article>
      </section>

      <section className="section shell">
        <div className="section-heading"><div><span className="section-number">01</span><h2>Performance by Brand</h2><p>{metricLabel} • {period === "mtd" ? "MTD" : "Daily"} • {shopName}</p></div><div className="legend"><i className="target" /> Target <i className="actual" /> Actual</div></div>
        <div className="brand-grid">
          {brandViews.map((item) => {
            const color = brandColors[item.brand] ?? "#64748b";
            return <button key={item.brand} className={`brand-card ${selectedBrand === item.brand ? "active" : ""}`} onClick={() => chooseBrand(item.brand)} style={{ "--brand": color } as React.CSSProperties}>
              <div className="brand-card-top"><span className="brand-mark">{item.brand.slice(0, 2)}</span><strong>{item.brand}</strong><em className={tone(item.viewAchievement)}>{item.viewAchievement.toFixed(1)}%</em></div>
              <div className="brand-numbers"><span>Target <b>{displayValue(item.viewTarget)}</b></span><span>Actual <b>{displayValue(item.viewActual)}</b></span></div>
              <div className="progress-track"><span style={{ width: `${Math.min(item.viewAchievement, 100)}%` }} /></div>
            </button>;
          })}
        </div>
        {selectedBrand !== "ALL" && <button className="reset-link" onClick={() => chooseBrand("ALL")}>ดูภาพรวมทุก Brand</button>}
      </section>

      <section className="section split-section shell">
        <div className="trend-panel panel">
          <div className="panel-head"><div><span className="section-number">02</span><h2>Daily Trend</h2><p>{metricLabel} • {period === "mtd" ? "ยอดสะสม" : "ยอดขายรายวัน"} เทียบ Run Rate</p></div><div className="trend-legend"><span><i className="actual-dot" /> Actual</span><span><i className="run-dot" /> Run rate</span></div></div>
          <div className="daily-chart" aria-label="กราฟยอดขายรายวัน">
            {trend.map((item) => <div className="day-column" key={item.day}><div className="bar-space"><div className="run-bar" style={{ height: `${(item.runRate / trendMax) * 100}%` }} /><div className="actual-bar" style={{ height: `${(item.actual / trendMax) * 100}%`, background: selectedColor }}><span>{item.day === selectedDay ? (metric === "net" ? compact(item.actual) : number.format(item.actual)) : ""}</span></div></div><small>{item.day}</small></div>)}
          </div>
          <div className="trend-foot"><span>1 Aug</span><b>{period === "mtd" ? "ยอดสะสม" : "ยอดวันที่เลือก"} {displayValue(actual)}</b><span>{selectedDay} Aug</span></div>
        </div>
        <aside className="focus-panel panel"><span className="section-number">NET FOCUS</span><h2>{metricLabel}</h2><p>{selectedBrand === "ALL" ? "ALL BRANDS" : selectedBrand} • {shopName}</p><div className="focus-meter"><span style={{ width: `${Math.min(achievement, 100)}%`, background: selectedColor }} /></div><div className="focus-stats"><span><small>Actual</small><strong>{displayValue(actual)}</strong><small>{period === "mtd" ? "MTD" : "Daily"}</small></span><span><small>Target</small><strong>{displayValue(target)}</strong><small>{period === "mtd" ? "MTD" : "Daily"}</small></span></div><div className="pace-note"><span>{period.toUpperCase()}</span><p>เลือกดูข้อมูลได้ถึงวันที่ <b>{thaiDate(latestDay)}</b> และสลับ Net Amount / Qty ได้ทันที</p></div></aside>
      </section>

      <section className="section shell">
        <div className="section-heading shop-heading"><div><span className="section-number">03</span><h2>Shop Performance</h2><p>{selectedBrand === "ALL" ? "สาขาที่มี Target ใน BMAV" : `เฉพาะสาขาที่มี Target ${selectedBrand}`}</p></div><span className="shop-count">{shopViews.length} สาขา</span></div>
        <div className="shop-table-wrap"><table><thead><tr><th>อันดับ</th><th>สาขา</th><th>Target {metric === "net" ? "Net" : "Qty"}</th><th>Actual</th><th>Achievement</th><th>Gap</th></tr></thead><tbody>
          {displayedShops.map((shop, index) => <tr key={shop.code}><td><span className={`rank ${index < 3 ? "top" : ""}`}>{index + 1}</span></td><td><strong>{shop.shop}</strong><small>{shop.code}</small></td><td>{displayValue(shop.viewTarget)}</td><td><b>{displayValue(shop.viewActual)}</b></td><td><div className="achievement-cell"><div><span style={{ width: `${Math.min(shop.viewAchievement, 100)}%` }} /></div><em className={tone(shop.viewAchievement)}>{shop.viewAchievement.toFixed(1)}%</em></div></td><td className={shop.viewActual - shop.viewTarget >= 0 ? "positive-gap" : "gap"}>{displayValue(shop.viewActual - shop.viewTarget)}</td></tr>)}
        </tbody></table></div>
        {shopViews.length > 10 && <button className="show-more" onClick={() => setShowAllShops(!showAllShops)}>{showAllShops ? "แสดง 10 อันดับแรก" : `ดูครบทั้ง ${shopViews.length} สาขา`} <span>{showAllShops ? "↑" : "↓"}</span></button>}
      </section>

      <footer className="shell"><div><strong>BMAV</strong><span>Device by Brand Dashboard</span></div><p>Source: Target & Sales data • Last updated {thaiDate(latestDay)}</p></footer>
    </main>
  );
}
