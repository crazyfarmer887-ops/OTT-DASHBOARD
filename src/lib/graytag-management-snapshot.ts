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

type InventoryPageReader = (kind: 'after' | 'before', finished: boolean, page: number) => Promise<Response>;

/** Only GET pages may be retried. A failed stream invalidates the whole snapshot. */
export async function readVerifiedGraytagManagementSnapshot(readPage: InventoryPageReader) {
  const read = async (kind: 'after' | 'before', finished: boolean) => {
    const collected: any[] = [];
    for (let page = 1; page <= 10; page++) {
      let rows: any[] | undefined;
      for (let attempt = 0; attempt < 3; attempt++) {
        let response: Response | undefined;
        try { response = await readPage(kind, finished, page); } catch { /* A GET connection failure may be retried. */ }
        if (response?.status === 401 || (response && response.status >= 300 && response.status < 400))
          throw new Error('그레이태그 로그인이 만료됐습니다. 판매자 연결을 확인해주세요.');
        if (response?.ok) {
          const payload = await response.json().catch(() => null);
          rows = verifiedGraytagManagementDeals(payload, true, payload !== null);
          break;
        }
        if (response && ![403, 408, 429, 500, 502, 503, 504].includes(response.status))
          throw new Error(`그레이태그 재고 조회 실패 (${response.status}). 판매자 연결을 확인해주세요.`);
        if (attempt === 2) throw new Error(response
          ? `그레이태그 재고 조회 실패 (${response.status}). 잠시 후 다시 시도해주세요. 판매글은 등록되지 않았습니다.`
          : '그레이태그 연결이 지연되고 있습니다. 잠시 후 다시 시도해주세요.');
        const retryAfter = response?.headers.get('retry-after');
        const seconds = retryAfter ? Number(retryAfter) : NaN;
        const requestedDelay = retryAfter ? (Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retryAfter) - Date.now()) : 0;
        if (requestedDelay > 60_000) throw new Error('그레이태그 조회 제한이 지속되고 있습니다. 잠시 후 다시 시도해주세요.');
        const delay = Math.max((attempt + 1) * 1500, Number.isFinite(requestedDelay) ? requestedDelay : 0);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
      collected.push(...rows!);
      if (rows!.length < 500) return collected;
    }
    throw new Error('그레이태그 재고 페이지를 모두 확인하지 못했습니다.');
  };
  // Sequential streams avoid the burst caused by four concurrent page loops.
  const afterOpenDeals = await read('after', false);
  const afterFinishedDeals = await read('after', true);
  const beforeOpenDeals = await read('before', false);
  const beforeFinishedDeals = await read('before', true);
  return { afterOpenDeals, afterFinishedDeals, beforeOpenDeals, beforeFinishedDeals };
}
