export const LISTING_PERIODS = [{ months: 1, label: '1달' }, { months: 3, label: '3달' }, { months: 6, label: '6개월' }, { months: 12, label: '1년' }] as const;

/** Inclusive calendar period: Oct 18 + one month ends Nov 17; Jan 31 ends Feb 28. */
export function listingPeriodEnd(start: string, months: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !Number.isInteger(months) || months < 1 || months > 12
    || !Number.isFinite(Date.parse(start)) || new Date(start).toISOString().slice(0, 10) !== start) return '';
  const [year, month, day] = start.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, month - 1 + months + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month - 1 + months, Math.min(day - 1, lastDay))).toISOString().slice(0, 10);
}
