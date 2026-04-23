export function estimatePrintCost(
  filamentUsedGrams: number | null | undefined,
  costPerKg: number | null | undefined,
): number | null {
  if (filamentUsedGrams == null || filamentUsedGrams <= 0) return null;
  if (costPerKg == null || costPerKg <= 0) return null;
  return Math.round(((filamentUsedGrams / 1000) * costPerKg) * 100) / 100;
}

export function formatCurrencyAmount(
  amount: number | null | undefined,
  currencySymbol: string,
): string | null {
  if (amount == null) return null;
  return `${currencySymbol}${amount.toFixed(2)}`;
}
