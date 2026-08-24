export type WeekRange = {
  id: string;
  start: string;
  end: string;
  label: string;
};

export type ComparableWeekPeriod = {
  range: WeekRange;
  currentStart: string;
  currentEnd: string | null;
  baseStart: string;
  baseEnd: string | null;
  currentDays: number;
  complete: boolean;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const weekRanges: WeekRange[] = [
  { id: "Week 32", start: "2026-08-03", end: "2026-08-09", label: "3–9 Aug" },
  { id: "Week 33", start: "2026-08-10", end: "2026-08-16", label: "10–16 Aug" },
  { id: "Week 34", start: "2026-08-17", end: "2026-08-23", label: "17–23 Aug" },
  { id: "Week 35", start: "2026-08-24", end: "2026-08-30", label: "24–30 Aug" },
  { id: "Week 36", start: "2026-08-31", end: "2026-09-06", label: "31 Aug–6 Sep" },
];

export function previousWeekId(weekId: string) {
  const weekNumber = Number(weekId.match(/\d+/)?.[0]);
  return Number.isFinite(weekNumber) ? `Week ${weekNumber - 1}` : "Week ก่อน";
}

function isoTime(isoDate: string) {
  return Date.parse(`${isoDate}T00:00:00Z`);
}

export function addDays(isoDate: string, days: number) {
  return new Date(isoTime(isoDate) + days * DAY_MS).toISOString().slice(0, 10);
}

function dayCount(start: string, end: string) {
  return Math.floor((isoTime(end) - isoTime(start)) / DAY_MS) + 1;
}

export function comparableWeekPeriod(range: WeekRange, latestDate: string): ComparableWeekPeriod {
  const baseStart = addDays(range.start, -7);
  if (latestDate < range.start) {
    return { range, currentStart: range.start, currentEnd: null, baseStart, baseEnd: null, currentDays: 0, complete: false };
  }
  const currentEnd = latestDate < range.end ? latestDate : range.end;
  const currentDays = dayCount(range.start, currentEnd);
  return {
    range,
    currentStart: range.start,
    currentEnd,
    baseStart,
    baseEnd: addDays(baseStart, currentDays - 1),
    currentDays,
    complete: currentDays === 7,
  };
}

export function weekIndexForDate(isoDate: string) {
  const index = weekRanges.findIndex((range) => isoDate >= range.start && isoDate <= range.end);
  if (index >= 0) return index;
  return isoDate < weekRanges[0].start ? 0 : weekRanges.length - 1;
}

function dateParts(isoDate: string) {
  const [, month, day] = isoDate.split("-").map(Number);
  return { day, month, monthName: monthNames[month - 1] };
}

export function shortDateRange(start: string, end: string | null) {
  if (!end) return "ยังไม่มีข้อมูล";
  const from = dateParts(start);
  const to = dateParts(end);
  if (start === end) return `${from.day} ${from.monthName}`;
  if (from.month === to.month) return `${from.day}–${to.day} ${from.monthName}`;
  return `${from.day} ${from.monthName}–${to.day} ${to.monthName}`;
}

export function weekDataStatus(period: ComparableWeekPeriod) {
  if (period.currentDays === 0) return "ยังไม่มีข้อมูล";
  return period.complete ? "ข้อมูลครบ 7 วัน" : `ข้อมูล ${period.currentDays}/7 วัน • สัปดาห์ยังไม่ครบ`;
}

export function wowChangeRate(current: number, base: number) {
  return base > 0 ? ((current - base) / base) * 100 : null;
}
