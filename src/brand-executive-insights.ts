export type ExecutiveBrandRow = {
  brand: string;
  target: number;
  actual: number;
  achievement: number | null;
  wow: number | null;
  activeShops: number;
  totalShops: number;
  hasTarget: boolean;
};

export type ExecutiveShopRow = {
  code: string;
  shop: string;
  target: number;
  actual: number;
  achievement: number | null;
  noSalesBrands: number;
  totalBrands: number;
};

export type BrandExecutiveAnalysis = {
  totalBrands: number;
  targetBrands: number;
  achieved: ExecutiveBrandRow[];
  nearTarget: ExecutiveBrandRow[];
  underFifty: ExecutiveBrandRow[];
  noSales: ExecutiveBrandRow[];
  topActual: ExecutiveBrandRow | null;
  topAchievement: ExecutiveBrandRow | null;
  topGrowth: ExecutiveBrandRow | null;
  biggestDecline: ExecutiveBrandRow | null;
  topShop: ExecutiveShopRow | null;
  riskShop: ExecutiveShopRow | null;
};

const firstBy = <T>(rows: T[], score: (row: T) => number, direction: "asc" | "desc" = "desc") => {
  const sorted = [...rows].sort((a, b) => direction === "desc" ? score(b) - score(a) : score(a) - score(b));
  return sorted[0] ?? null;
};

export function analyzeBrandExecutive(brands: ExecutiveBrandRow[], shops: ExecutiveShopRow[]): BrandExecutiveAnalysis {
  const targetRows = brands.filter((row) => row.hasTarget && row.achievement != null);
  const achieved = targetRows.filter((row) => (row.achievement ?? 0) >= 100);
  const nearTarget = targetRows.filter((row) => (row.achievement ?? 0) >= 80 && (row.achievement ?? 0) < 100);
  const underFifty = targetRows.filter((row) => (row.achievement ?? 0) < 50);
  const noSales = brands.filter((row) => row.actual <= 0);
  const comparableGrowth = brands.filter((row) => row.wow != null && (row.wow ?? 0) > 0);
  const comparableDecline = brands.filter((row) => row.wow != null && (row.wow ?? 0) < 0);
  const shopsWithTarget = shops.filter((row) => row.target > 0 && row.achievement != null);
  const riskShops = shops.filter((row) => row.totalBrands > 0);

  return {
    totalBrands: brands.length,
    targetBrands: targetRows.length,
    achieved,
    nearTarget,
    underFifty,
    noSales,
    topActual: firstBy(brands, (row) => row.actual),
    topAchievement: firstBy(targetRows, (row) => row.achievement ?? 0),
    topGrowth: firstBy(comparableGrowth, (row) => row.wow ?? 0),
    biggestDecline: firstBy(comparableDecline, (row) => row.wow ?? 0, "asc"),
    topShop: firstBy(shopsWithTarget, (row) => row.achievement ?? 0),
    riskShop: [...riskShops].sort((a, b) => b.noSalesBrands - a.noSalesBrands || (a.achievement ?? Number.POSITIVE_INFINITY) - (b.achievement ?? Number.POSITIVE_INFINITY))[0] ?? null,
  };
}
