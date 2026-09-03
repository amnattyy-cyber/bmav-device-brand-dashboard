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
