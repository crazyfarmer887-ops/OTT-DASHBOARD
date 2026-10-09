/** Validate the provider snapshot before using it to reserve shared inventory. */
export function verifiedGraytagManagementDeals(payload: any, httpOk: boolean, jsonOk: boolean): any[] {
  const candidates: Array<[string, unknown]> = [
    ['data.data.lenderDeals', payload?.data?.data?.lenderDeals],
    ['data.lenderDeals', payload?.data?.lenderDeals],
    ['lenderDeals', payload?.lenderDeals],
  ];
  const [path, rows] = candidates.find(([, value]) => Array.isArray(value)) || ['', undefined];
  const invalidRows = Array.isArray(rows) ? rows.flatMap((row, index) => {
    const missing: string[] = [];
    if (!row || typeof row !== 'object') missing.push('object');
    else {
      if (!row.dealUsid && !row.productUsid) missing.push('dealUsid|productUsid');
      if (typeof row.dealStatus !== 'string') missing.push('dealStatus');
    }
    return missing.length ? [{ index, missing, keys: row && typeof row === 'object' ? Object.keys(row).sort() : [] }] : [];
  }) : [];
  if (!httpOk || !jsonOk || payload?.succeeded !== true || !Array.isArray(rows) || invalidRows.length) {
    // Keep provider values private; these metadata make the failed contract diagnosable.
    const diagnostic = { httpOk, jsonOk, succeeded: payload?.succeeded,
      payloadKeys: payload && typeof payload === 'object' ? Object.keys(payload).sort() : [],
      dataKeys: payload?.data && typeof payload.data === 'object' ? Object.keys(payload.data).sort() : [],
      path: path || null, rowCount: Array.isArray(rows) ? rows.length : null,
      invalidCount: invalidRows.length, invalidSamples: invalidRows.slice(0, 3) };
    const error: any = new Error('그레이태그 재고 응답을 확인하지 못했습니다.');
    error.diagnostic = diagnostic;
    throw error;
  }
  return rows;
}

export async function isAuthoritativeGraytagInventoryResponse(response: Response): Promise<boolean> {
  if (!response.ok || response.redirected || (response.status >= 300 && response.status < 400)) return false;
  const payload = await response.json().catch(() => null);
  try {
    verifiedGraytagManagementDeals(payload, true, payload !== null);
    return true;
  } catch { return false; }
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
          throw new Error(`그레이태그 로그인 확인이 필요합니다 (${response.status}). 판매자 연결을 확인해주세요.`);
        if (response?.ok) {
          const payload = await response.json().catch(() => null);
          try {
            rows = verifiedGraytagManagementDeals(payload, true, payload !== null);
          } catch (error: any) {
            if (error?.diagnostic) Object.assign(error.diagnostic, { stream: kind, finished, page });
            throw error;
          }
          break;
        }
        if (response && ![403, 408, 429, 500, 502, 503, 504].includes(response.status))
          throw new Error(`그레이태그 재고 조회 실패 (${response.status}). 판매자 연결을 확인해주세요.`);
        if (attempt === 2) throw new Error(response
          ? `그레이태그 재고 조회 실패 (${response.status}). 재고 확인을 보류했습니다. 잠시 후 다시 시도해주세요.`
          : '그레이태그 연결이 지연되고 있습니다. 잠시 후 다시 시도해주세요.');
        const retryAfter = response?.headers.get('retry-after');
        const seconds = retryAfter ? Number(retryAfter) : NaN;
        const requestedDelay = retryAfter ? (Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retryAfter) - Date.now()) : 0;
        if (requestedDelay > 60_000) throw new Error(`그레이태그 조회 제한이 지속되고 있습니다 (${response?.status}). 잠시 후 다시 시도해주세요.`);
        const delay = Math.max((attempt + 1) * 1500, Number.isFinite(requestedDelay) ? requestedDelay : 0);
        await response?.body?.cancel().catch(() => {});
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

/** YouTube invitation chats cannot supply shared OTT credentials. Unknown services stay included. */
export function graytagCredentialHydrationDeals<T extends { productTypeString?: string }>(rows: T[], inventoryOnly: boolean): T[] {
  return inventoryOnly ? rows.filter(deal => deal.productTypeString !== '유튜브') : rows;
}
