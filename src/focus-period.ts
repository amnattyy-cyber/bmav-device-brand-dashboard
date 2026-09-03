export type FocusView = "daily" | "mtd";

export type FocusPeriod = {
  start: string;
  end: string;
  days: number;
};

export function focusPeriod(view: FocusView, monthPrefix: string, selectedDate: string): FocusPeriod {
  return {
    start: view === "daily" ? selectedDate : `${monthPrefix}-01`,
    end: selectedDate,
    days: view === "daily" ? 1 : Number(selectedDate.slice(-2)),
  };
}

export function selectedDayFromDate(value: string, latestDay: number): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const day = Number(value.slice(-2));
  return Number.isInteger(day) && day >= 1 && day <= latestDay ? day : null;
}
