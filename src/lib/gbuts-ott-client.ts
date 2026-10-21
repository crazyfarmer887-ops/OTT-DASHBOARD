import { createGbutsSpotifySellerClient } from '../scheduler/gbuts-spotify-sync';
import { GBUTS_OTT_CATEGORIES, koreaToday, ottDate, type GbutsOttListing } from './gbuts-ott';
import { buildSpotifyListing, type SpotifyListingInput } from './gbuts-spotify-listings';
import { assertGbutsOttCredentials, DISNEY_AFTER_ORDER_NOTICE, DISNEY_REFUND_NOTICE, disneyDirectDescription, type GbutsOttCredentials } from './gbuts-disney-delivery';
import { decodeGbutsSubscriptionCredential } from './gbuts-subscription-credentials';
export interface GbutsOttMember {
  seq: number; userSeq: number; productId: string; nickname: string; status: string;
  cancelStatus: string | null; createdAt: string; subscriptionEndsAt: string;
}
export interface GbutsOttPost { seq: number; category1: { seq: number }; memberLimit: number; memberCount: number; status: string; subscriptionEndsAt: string; [key: string]: any }
function integer(value: unknown): number { if (!Number.isSafeInteger(value) || Number(value) < 1) throw new Error('벗츠 응답 식별자가 올바르지 않습니다.'); return Number(value); }
export function buildGbutsOttPost(listing: GbutsOttListing, now = new Date(), credentials?: GbutsOttCredentials): Record<string, unknown> {
  const disney = listing.deliveryMode === 'disney-numbered-password';
  if (disney) { if (!credentials) throw new Error('판매글 계정 정보를 확인해주세요.'); assertGbutsOttCredentials(credentials); }
  return { category: GBUTS_OTT_CATEGORIES[listing.serviceType], countries: ['KR'],
    subscriptionType: 'SHARE', subscriptionPrincipal: disney ? credentials!.id : '1:1 채팅의 계정 확인 링크를 열어주세요', subscriptionCredential: disney ? credentials!.password : '1:1 채팅 확인',
    subscriptionStartsAt: `${koreaToday(now)} 00:00:00`, subscriptionEndsAt: `${listing.endDate} 23:59:59`,
    price: listing.dailyPrice, priceType: 'DAY', memberLimit: listing.capacity,
    title: `[${listing.serviceType}] ${listing.title}`, description: disney ? disneyDirectDescription(listing.description) : listing.description,
    noticeBeforeOrder: '1인 1회선으로 본인에게 배정된 프로필만 이용해주세요. 계정 정보와 프로필 설정을 변경하거나 타인에게 공유하지 마세요.' + (disney ? `\n\n${DISNEY_REFUND_NOTICE}` : ''),
    noticeAfterOrder: disney ? DISNEY_AFTER_ORDER_NOTICE : '구매 감사합니다. 계정 확인 링크를 1:1 채팅으로 자동 안내드립니다. 링크에서 이용 안내에 동의한 뒤 계정 정보를 확인해주세요.' };
}
export function createGbutsOttSellerClient(token: string, transport: typeof fetch = fetch) {
  const request = async (path: string, init?: RequestInit) => {
    const readOnly = !init?.method || init.method.toUpperCase() === 'GET';
    for (let attempt = 0; attempt < (readOnly ? 2 : 1); attempt++) {
      const response = await transport(`https://api.gbuts.com${path}`, { ...init,
        headers: { 'Content-Type': 'application/json', api_key: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) });
      if (!response.ok && readOnly && attempt === 0 && [429, 500, 502, 503, 504].includes(response.status)) {
        const retryAfter = Number(response.headers.get('retry-after'));
        await response.body?.cancel().catch(() => {});
        await new Promise(resolve => setTimeout(resolve, Math.min(1500, Math.max(250, Number.isFinite(retryAfter) ? retryAfter * 1000 : 250))));
        continue;
      }
      if (!response.ok) throw new Error(`벗츠 요청 실패 (${response.status})`);
      const payload = await response.json() as any;
      if (payload.success !== true || payload.error || payload.response === undefined) throw new Error('벗츠 요청 결과를 확인하지 못했습니다.');
      return payload;
    }
    throw new Error('벗츠 조회 결과를 확인하지 못했습니다.');
  };
  const validatePost = (post: any): GbutsOttPost => {
    integer(post?.seq); integer(post?.category1?.seq); integer(post?.memberLimit);
    if (!Number.isSafeInteger(post.memberCount) || post.memberCount < 0 || !ottDate(post.subscriptionEndsAt) || typeof post.status !== 'string') throw new Error('벗츠 판매글 응답이 올바르지 않습니다.');
    return post;
  };
  // The seller list is newest-first. Check ordering before using a high-water
  // mark so hourly renewal need not repeatedly scan years of retired posts.
  const postPage = async (page: number): Promise<GbutsOttPost[]> => {
    const data = await request(`/api/seller/subscribe/share/list?page=${page}`);
    if (!Array.isArray(data.response)) throw new Error('벗츠 판매글 목록이 올바르지 않습니다.');
    const posts = data.response.map(validatePost);
    if (posts.some((post: GbutsOttPost, i: number) => i > 0 && posts[i - 1].seq <= post.seq)) throw new Error('판매글의 최신순 정렬을 확인하지 못했습니다.');
    return posts;
  };
  return { ...createGbutsSpotifySellerClient(token, transport),
    async listPosts(): Promise<GbutsOttPost[]> {
      const posts: GbutsOttPost[] = [];
      for (let page = 1; page <= 100; page++) {
        const data = await request(`/api/seller/subscribe/share/list?page=${page}`);
        if (!Array.isArray(data.response)) throw new Error('벗츠 판매글 목록이 올바르지 않습니다.');
        posts.push(...data.response.map(validatePost));
        if (data.response.length === 0) return posts;
      }
      throw new Error('벗츠 판매글 페이지 확인을 완료하지 못했습니다.');
    },
    async latestPostSeq(): Promise<number> { return (await postPage(1))[0]?.seq || 0; },
    async listPostsAfter(afterSeq: number): Promise<GbutsOttPost[]> {
      if (!Number.isSafeInteger(afterSeq) || afterSeq < 0) throw new Error('판매글 확인 기준이 올바르지 않습니다.');
      const result: GbutsOttPost[] = []; let lastSeq = Infinity;
      for (let page = 1; page <= 100; page++) {
        const posts = await postPage(page);
        if (!posts.length) return result;
        if (posts[0].seq >= lastSeq) throw new Error('판매글 페이지 순서를 확인하지 못했습니다.');
        result.push(...posts.filter(post => post.seq > afterSeq));
        lastSeq = posts.at(-1)!.seq;
        if (lastSeq <= afterSeq) return result;
      }
      throw new Error('재등록 이후 판매글 조회를 완료하지 못했습니다.');
    },
    async getPost(seq: number): Promise<GbutsOttPost> { return validatePost((await request(`/api/seller/subscribe/share/${integer(seq)}/view`)).response); },
    async listOttMembers(seq: number): Promise<GbutsOttMember[]> {
      const data = (await request(`/api/seller/subscribe/share/${integer(seq)}/member`)).response;
      if (!Array.isArray(data)) throw new Error('벗츠 파티원 목록이 올바르지 않습니다.');
      return data.map(x => { integer(x.seq); integer(x.userSeq);
        if (!ottDate(x.subscriptionEndsAt) || !ottDate(x.createdAt) || typeof x.status !== 'string') throw new Error('벗츠 주문 기간을 확인하지 못했습니다.');
        return { seq: x.seq, userSeq: x.userSeq, productId: String(x.productId), nickname: String(x.nickname || '(구매자)'),
          status: x.status, cancelStatus: x.cancelStatus == null ? null : String(x.cancelStatus), createdAt: x.createdAt, subscriptionEndsAt: x.subscriptionEndsAt };
      });
    },
    async createPost(listing: GbutsOttListing, credentials?: GbutsOttCredentials): Promise<number | null> {
      const data = (await request('/api/subscribe/share', { method: 'POST', body: JSON.stringify(buildGbutsOttPost(listing, new Date(), credentials)) })).response;
      const seq = typeof data === 'number' ? data : data?.seq ?? data?.postSeq;
      return seq == null ? null : integer(seq);
    },
    async createSpotifyPost(input: SpotifyListingInput & { countries: string[] }): Promise<number | null> {
      const data = (await request('/api/subscribe/share', { method: 'POST', body: JSON.stringify(buildSpotifyListing(input)) })).response;
      const seq = typeof data === 'number' ? data : data?.seq ?? data?.postSeq;
      return seq == null ? null : integer(seq);
    },
    async syncDisneyCredentials(post: GbutsOttPost, credentials: GbutsOttCredentials): Promise<void> {
      if (post.category1.seq !== 6 || post.subscriptionType !== 'SHARE') throw new Error('디즈니 판매글 연결을 확인해주세요.');
      assertGbutsOttCredentials(credentials);
      const description = disneyDirectDescription(String(post.description || ''));
      const noticeBeforeOrder = String(post.noticeBeforeOrder || '').includes(DISNEY_REFUND_NOTICE)
        ? post.noticeBeforeOrder : `${post.noticeBeforeOrder || ''}\n\n${DISNEY_REFUND_NOTICE}`.trim();
      if (decodeGbutsSubscriptionCredential(post.subscriptionPrincipal) === credentials.id
        && decodeGbutsSubscriptionCredential(post.subscriptionCredential) === credentials.password
        && post.description === description && post.noticeBeforeOrder === noticeBeforeOrder && post.noticeAfterOrder === DISNEY_AFTER_ORDER_NOTICE) return;
      let title = String(post.title || '');
      try { title = JSON.parse(title).ko; } catch { /* Plain seller titles are supported. */ }
      if (!title || !Array.isArray(post.countries) || post.priceType !== 'DAY') throw new Error('판매글 원본 정보를 확인해주세요.');
      // Same PUT and fields as the official seller edit form. Never send private
      // fields in title, description, notices, logs or the local listing journal.
      await request(`/api/subscribe/${integer(post.seq)}/share`, { method: 'PUT', body: JSON.stringify({
        category: post.category1.seq, countries: post.countries, subscriptionType: post.subscriptionType,
        subscriptionPrincipal: credentials.id, subscriptionCredential: credentials.password,
        subscriptionStartsAt: post.subscriptionStartsAt, subscriptionEndsAt: post.subscriptionEndsAt,
        price: post.price, priceType: post.priceType, memberLimit: post.memberLimit,
        title, description, noticeBeforeOrder, noticeAfterOrder: DISNEY_AFTER_ORDER_NOTICE,
      }) });
      const saved = await this.getPost(post.seq);
      if (decodeGbutsSubscriptionCredential(saved.subscriptionPrincipal) !== credentials.id
        || decodeGbutsSubscriptionCredential(saved.subscriptionCredential) !== credentials.password
        || saved.memberLimit !== post.memberLimit || saved.price !== post.price || saved.subscriptionEndsAt !== post.subscriptionEndsAt
        || saved.description !== description || saved.noticeBeforeOrder !== noticeBeforeOrder || saved.noticeAfterOrder !== DISNEY_AFTER_ORDER_NOTICE)
        throw new Error('벗츠 계정 정보 저장 확인이 필요합니다.');
    },
    async closePost(seq: number): Promise<void> { await request(`/api/seller/subscribe/share/${integer(seq)}/closed`, { method: 'POST' }); },
  };
}
