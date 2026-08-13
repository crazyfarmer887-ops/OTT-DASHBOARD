export interface RenewalFilterableRow {
  idempotencyKey: string;
  category: string;
  service: string;
  buyer: string;
  account: string;
  eligible: boolean;
  jobStatus: string | null;
  couponStatus: string;
}

export function filterRenewalRows<T extends RenewalFilterableRow>(rows: readonly T[], filters: { category: string; search: string; status: string }): T[] {
  const query = filters.search.trim().toLocaleLowerCase('ko');
  return rows.filter((row) => {
    if (filters.category !== 'all' && row.category !== filters.category) return false;
    if (filters.status !== 'all' && row.jobStatus !== filters.status && row.couponStatus !== filters.status) return false;
    return !query || [row.service, row.buyer, row.account, row.idempotencyKey].some((value) => String(value || '').toLocaleLowerCase('ko').includes(query));
  });
}

export function selectionAfterScopeChange(current: ReadonlySet<string>, previousScope: string, nextScope: string, previousRevision: number, nextRevision: number): Set<string> {
  return previousScope === nextScope && previousRevision === nextRevision ? new Set(current) : new Set();
}
