export function estimatePrintCost(
  filamentUsedGrams: number | null | undefined,
  defaultCostPerKg: number | null | undefined,
): number | null {
  if (filamentUsedGrams == null || filamentUsedGrams <= 0) return null;
  if (defaultCostPerKg == null || defaultCostPerKg <= 0) return null;
  return Math.round(((filamentUsedGrams / 1000) * defaultCostPerKg) * 100) / 100;
}

export function formatCurrencyAmount(
  amount: number | null | undefined,
  currencySymbol: string,
): string | null {
  if (amount == null) return null;
  return `${currencySymbol}${amount.toFixed(2)}`;
}
