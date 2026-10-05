/** Validate the provider snapshot before using it to reserve shared inventory. */
export function verifiedGraytagManagementDeals(payload: any, httpOk: boolean, jsonOk: boolean): any[] {
  const rows = payload?.data?.data?.lenderDeals ?? payload?.data?.lenderDeals ?? payload?.lenderDeals;
  if (!httpOk || !jsonOk || payload?.succeeded !== true || !Array.isArray(rows)
    || rows.some((x: any) => !x || (!x.dealUsid && !x.productUsid) || typeof x.dealStatus !== 'string'))
    throw new Error('그레이태그 재고 응답을 확인하지 못했습니다.');
  return rows;
}
export function dedupeGraytagManagementDeals(rows: any[]): any[] {
  const seen = new Set<string>();
  return rows.filter(row => { const key = row.dealUsid ? `deal:${row.dealUsid}` : `product:${row.productUsid}`; if (seen.has(key)) return false; seen.add(key); return true; });
}
