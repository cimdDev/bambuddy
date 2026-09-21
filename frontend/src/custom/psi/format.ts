import { formatWeight } from '../../utils/weight';

export const fmtWeight = (grams: number) => formatWeight(grams);
export const fmtHours = (hours: number) => `${hours.toFixed(1)} h`;
export const fmtMoney = (currency: string, value: number) => `${currency} ${value.toFixed(2)}`;
