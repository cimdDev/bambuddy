export function estimatePrintCost(
  filamentUsedGrams: number | null | undefined,
  defaultFilamentCostPerKg: number | null | undefined
): number | null {
  if (filamentUsedGrams == null || defaultFilamentCostPerKg == null) return null;
  if (!Number.isFinite(filamentUsedGrams) || !Number.isFinite(defaultFilamentCostPerKg)) return null;
  if (filamentUsedGrams < 0 || defaultFilamentCostPerKg < 0) return null;
  return (filamentUsedGrams / 1000) * defaultFilamentCostPerKg;
}

export function formatCurrencyAmount(amount: number, currencySymbol: string): string {
  return `${currencySymbol}${amount.toFixed(2)}`;
}
