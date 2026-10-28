import { createGbutsSpotifySellerClient } from '../scheduler/gbuts-spotify-sync';
import { GBUTS_OTT_CATEGORIES, koreaToday, ottDate, type GbutsOttListing } from './gbuts-ott';
import { buildSpotifyListing, type SpotifyListingInput } from './gbuts-spotify-listings';
import { assertGbutsOttCredentials, DISNEY_AFTER_ORDER_NOTICE, DISNEY_REFUND_NOTICE, disneyDirectDescription, type GbutsOttCredentials } from './gbuts-disney-delivery';
import { decodeGbutsSubscriptionCredential } from './gbuts-subscription-credentials';
import { netflixPasswordOnlyOrderNotice, GBUTS_NETFLIX_CODE_AFTER_ORDER_NOTICE, GBUTS_NETFLIX_MAILBOX_AFTER_ORDER_NOTICE } from './gbuts-ott-templates';
export interface GbutsOttMember {
  seq: number; userSeq: number; productId: string; nickname: string; status: string;
  cancelStatus: string | null; createdAt: string; subscriptionEndsAt: string;
}
export interface GbutsOttPost { seq: number; category1: { seq: number }; memberLimit: number; memberCount: number; status: string; subscriptionEndsAt: string; [key: string]: any }
function integer(value: unknown): number { if (!Number.isSafeInteger(value) || Number(value) < 1) throw new Error('벗츠 응답 식별자가 올바르지 않습니다.'); return Number(value); }
export function buildGbutsOttPost(listing: GbutsOttListing, now = new Date(), credentials?: GbutsOttCredentials): Record<string, unknown> {
  const disney = listing.deliveryMode === 'disney-numbered-password';
  const nativeCredentials = disney || (listing.serviceType === '넷플릭스' && Boolean(listing.repostFrom));
  if (nativeCredentials) { if (!credentials) throw new Error('판매글 계정 정보를 확인해주세요.'); assertGbutsOttCredentials(credentials); }
  return { category: GBUTS_OTT_CATEGORIES[listing.serviceType], countries: ['KR'],
    subscriptionType: 'SHARE', subscriptionPrincipal: nativeCredentials ? credentials!.id : listing.serviceType === '넷플릭스' ? '1:1 채팅으로 ID·PW를 안내드립니다' : '1:1 채팅의 계정 확인 링크를 열어주세요', subscriptionCredential: nativeCredentials ? credentials!.password : '1:1 채팅 확인',
    subscriptionStartsAt: `${koreaToday(now)} 00:00:00`, subscriptionEndsAt: `${listing.endDate} 23:59:59`,
    price: listing.dailyPrice, priceType: 'DAY', memberLimit: listing.capacity,
    title: `[${listing.serviceType}] ${listing.title}`, description: disney ? disneyDirectDescription(listing.description) : listing.description,
    noticeBeforeOrder: listing.noticeBeforeOrder ?? '1인 1회선으로 본인에게 배정된 프로필만 이용해주세요. 계정 정보와 프로필 설정을 변경하거나 타인에게 공유하지 마세요.' + (disney ? `\n\n${DISNEY_REFUND_NOTICE}` : ''),
    noticeAfterOrder: listing.serviceType === '넷플릭스' ? listing.emailCodeProvider === 'emailverify' ? GBUTS_NETFLIX_MAILBOX_AFTER_ORDER_NOTICE : listing.emailCodeProvider === 'aaryan' ? GBUTS_NETFLIX_CODE_AFTER_ORDER_NOTICE : netflixPasswordOnlyOrderNotice(listing.noticeAfterOrder) : listing.noticeAfterOrder ?? (disney ? DISNEY_AFTER_ORDER_NOTICE : '구매 감사합니다. 계정 확인 링크를 1:1 채팅으로 자동 안내드립니다. 링크에서 이용 안내에 동의한 뒤 계정 정보를 확인해주세요.') };
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
  async function syncNativeCredentials(post: GbutsOttPost, credentials: GbutsOttCredentials): Promise<void> {
    if (![5, 6].includes(post.category1.seq) || post.subscriptionType !== 'SHARE') throw new Error('판매글 계정 연결을 확인해주세요.');
    const disney = post.category1.seq === 6;
    assertGbutsOttCredentials(credentials);
    const description = disney ? disneyDirectDescription(String(post.description || '')) : post.description;
    const noticeAfterOrder = disney ? DISNEY_AFTER_ORDER_NOTICE : post.noticeAfterOrder;
    const noticeBeforeOrder = !disney || String(post.noticeBeforeOrder || '').includes(DISNEY_REFUND_NOTICE)
      ? post.noticeBeforeOrder : `${post.noticeBeforeOrder || ''}\n\n${DISNEY_REFUND_NOTICE}`.trim();
    if (decodeGbutsSubscriptionCredential(post.subscriptionPrincipal) === credentials.id
      && decodeGbutsSubscriptionCredential(post.subscriptionCredential) === credentials.password
      && post.description === description && post.noticeBeforeOrder === noticeBeforeOrder && post.noticeAfterOrder === noticeAfterOrder) return;
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
      title, description, noticeBeforeOrder, noticeAfterOrder,
    }) });
    const saved = validatePost((await request(`/api/seller/subscribe/share/${integer(post.seq)}/view`)).response);
    if (decodeGbutsSubscriptionCredential(saved.subscriptionPrincipal) !== credentials.id
      || decodeGbutsSubscriptionCredential(saved.subscriptionCredential) !== credentials.password
      || saved.memberLimit !== post.memberLimit || saved.price !== post.price || saved.subscriptionEndsAt !== post.subscriptionEndsAt
      || saved.description !== description || saved.noticeBeforeOrder !== noticeBeforeOrder || saved.noticeAfterOrder !== noticeAfterOrder)
      throw new Error('벗츠 계정 정보 저장 확인이 필요합니다.');
  }
  // The seller list is grouped by recruitment state, even under COMPLETED:
  // a fully subscribed ON_SALE post can precede a newer CLOSED post. There is
  // no verified global timestamp order, so discovery must finish every page.
  async function allSellerPosts(): Promise<GbutsOttPost[]> {
    const posts: GbutsOttPost[] = []; const seen = new Set<number>();
    for (let page = 1; page <= 1000; page++) {
      const data = await request(`/api/seller/subscribe/share/list?page=${page}`);
      if (!Array.isArray(data.response)) throw new Error('벗츠 판매글 목록이 올바르지 않습니다.');
      const rows = data.response.map(validatePost);
      if (new Set(rows.map((post: GbutsOttPost) => post.seq)).size !== rows.length || rows.some((post: GbutsOttPost) => seen.has(post.seq))) throw new Error('판매글 목록이 조회 중 변경되어 다시 확인해야 합니다.');
      for (const post of rows) seen.add(post.seq);
      posts.push(...rows);
      if (!rows.length) return posts;
    }
    throw new Error('벗츠 판매글 페이지 확인을 완료하지 못했습니다.');
  }
  async function listSubscriptionPublicRanking(category:number):Promise<Array<{seq:number;sellerSeq:number}>> {
    integer(category);
    const data = await request(`/api/subscribe/share?categorySeqs=${category}&page=1&size=20`, { cache: 'no-store' });
    const page = data.pagination;
    if (!Array.isArray(data.response) || !page || page.currentPage !== 1 || !Number.isSafeInteger(page.totalCount)
      || page.totalCount < 0 || data.response.length !== Math.min(20, page.totalCount)) throw new Error('구독 최신순 목록을 모두 확인하지 못했습니다.');
    const rows = data.response.map((post: any) => {
      if (post.category1?.seq !== category) throw new Error('구독 목록의 상품 종류를 확인해주세요.');
      return { seq: integer(post.seq), sellerSeq: integer(post.seller?.seq) };
    });
    if (new Set(rows.map((row: { seq: number }) => row.seq)).size !== rows.length) throw new Error('구독 목록이 조회 중 변경되었습니다.');
    return rows;
  }
  return { ...createGbutsSpotifySellerClient(token, transport),
    listSubscriptionPublicRanking,
    async listOttPublicRanking(serviceType:string) {
      const category=serviceType==='유튜브'?7:GBUTS_OTT_CATEGORIES[serviceType];
      if(!category)throw Error('순위 감시 서비스 종류를 확인해주세요.');
      return listSubscriptionPublicRanking(category);
    },
    listPosts: allSellerPosts,
    async latestPostSeq(): Promise<number> {
      return (await allSellerPosts()).reduce((highest, post) => Math.max(highest, post.seq), 0);
    },
    async listPostsAfter(afterSeq: number): Promise<GbutsOttPost[]> {
      if (!Number.isSafeInteger(afterSeq) || afterSeq < 0) throw new Error('판매글 확인 기준이 올바르지 않습니다.');
      return (await allSellerPosts()).filter(post => post.seq > afterSeq);
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
    async createSubscriptionPost(input:Omit<import('../scheduler/gbuts-youtube-renewal').SubscriptionPayload,'subscriptionPrincipal'|'subscriptionCredential'> & {subscriptionPrincipal:string|null;subscriptionCredential:string|null}):Promise<number|null> {
      integer(input.category);integer(input.memberLimit);
      if(!['INVITE','SHARE'].includes(input.subscriptionType)||input.priceType!=='DAY'||!Number.isSafeInteger(input.price)||input.price<1
        || ![input.subscriptionPrincipal,input.subscriptionCredential].every(v=>v===null||typeof v==='string'))throw Error('구독공유 재등록 조건 확인 필요');
      const data=(await request('/api/subscribe/share',{method:'POST',body:JSON.stringify(input)})).response;
      const seq=typeof data==='number'?data:data?.seq??data?.postSeq;return seq==null?null:integer(seq);
    },
    async createYouTubeInvitePost(input: import('../scheduler/gbuts-youtube-renewal').InvitePayload): Promise<number | null> {
      if (input.category !== 7 || input.subscriptionType !== 'INVITE' || input.subscriptionPrincipal !== '' || input.subscriptionCredential !== '')
        throw new Error('유튜브 초대형 판매글만 등록할 수 있습니다.');
      const data = (await request('/api/subscribe/share', { method: 'POST', body: JSON.stringify(input) })).response;
      const seq = typeof data === 'number' ? data : data?.seq ?? data?.postSeq;
      return seq == null ? null : integer(seq);
    },
    async createSpotifyPost(input: SpotifyListingInput & { countries: string[] }): Promise<number | null> {
      const data = (await request('/api/subscribe/share', { method: 'POST', body: JSON.stringify(buildSpotifyListing(input)) })).response;
      const seq = typeof data === 'number' ? data : data?.seq ?? data?.postSeq;
      return seq == null ? null : integer(seq);
    },
    async syncDisneyCredentials(post: GbutsOttPost, credentials: GbutsOttCredentials): Promise<void> {
      if (post.category1.seq !== 6) throw new Error('디즈니 판매글 연결을 확인해주세요.');
      await syncNativeCredentials(post, credentials);
    },
    async syncNetflixCredentials(post: GbutsOttPost, credentials: GbutsOttCredentials): Promise<void> {
      if (post.category1.seq !== 5) throw new Error('넷플릭스 판매글 연결을 확인해주세요.');
      await syncNativeCredentials(post, credentials);
    },
    async updateDisneySaleTerms(post: GbutsOttPost, terms: { dailyPrice: number; title: string }): Promise<void> {
      if (post.category1.seq !== 6 || post.subscriptionType !== 'SHARE' || post.priceType !== 'DAY' || post.status !== 'ON_SALE'
        || !Array.isArray(post.countries) || !Number.isSafeInteger(terms.dailyPrice) || terms.dailyPrice < 1 || terms.dailyPrice > 1000000
        || !terms.title.trim() || terms.title.length > 30) throw new Error('디즈니 판매 조건을 확인해주세요.');
      const title = `[디즈니플러스] ${terms.title}`;
      let currentTitle = post.title;
      try { currentTitle = typeof currentTitle === 'string' ? JSON.parse(currentTitle).ko : currentTitle?.ko; } catch { /* Plain title. */ }
      if (Number(post.price) === terms.dailyPrice && currentTitle === title) return;
      const id = decodeGbutsSubscriptionCredential(post.subscriptionPrincipal);
      const password = decodeGbutsSubscriptionCredential(post.subscriptionCredential);
      assertGbutsOttCredentials({ id, password });
      await request(`/api/subscribe/${integer(post.seq)}/share`, { method: 'PUT', body: JSON.stringify({
        category: post.category1.seq, countries: post.countries, subscriptionType: post.subscriptionType,
        subscriptionPrincipal: id, subscriptionCredential: password,
        subscriptionStartsAt: post.subscriptionStartsAt, subscriptionEndsAt: post.subscriptionEndsAt,
        price: terms.dailyPrice, priceType: post.priceType, memberLimit: post.memberLimit,
        title, description: post.description, noticeBeforeOrder: post.noticeBeforeOrder, noticeAfterOrder: post.noticeAfterOrder,
      }) });
      const saved = await this.getPost(post.seq);
      let savedTitle = saved.title;
      try { savedTitle = typeof savedTitle === 'string' ? JSON.parse(savedTitle).ko : savedTitle?.ko; } catch { /* Plain title. */ }
      if (Number(saved.price) !== terms.dailyPrice || savedTitle !== title || saved.memberLimit !== post.memberLimit
        || saved.subscriptionEndsAt !== post.subscriptionEndsAt || saved.subscriptionStartsAt !== post.subscriptionStartsAt
        || decodeGbutsSubscriptionCredential(saved.subscriptionPrincipal) !== id || decodeGbutsSubscriptionCredential(saved.subscriptionCredential) !== password
        || saved.description !== post.description || saved.noticeBeforeOrder !== post.noticeBeforeOrder || saved.noticeAfterOrder !== post.noticeAfterOrder)
        throw new Error('디즈니 판매 조건 저장 확인이 필요합니다.');
    },
    async closePost(seq: number): Promise<void> { await request(`/api/seller/subscribe/share/${integer(seq)}/closed`, { method: 'POST' }); },
  };
}
