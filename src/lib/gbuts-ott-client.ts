import { createGbutsSpotifySellerClient } from '../scheduler/gbuts-spotify-sync';
import { GBUTS_OTT_CATEGORIES, koreaToday, ottDate, type GbutsOttListing } from './gbuts-ott';
export interface GbutsOttMember {
  seq: number; userSeq: number; productId: string; nickname: string; status: string;
  cancelStatus: string | null; createdAt: string; subscriptionEndsAt: string;
}
export interface GbutsOttPost { seq: number; category1: { seq: number }; memberLimit: number; memberCount: number; status: string; subscriptionEndsAt: string; [key: string]: any }
function integer(value: unknown): number { if (!Number.isSafeInteger(value) || Number(value) < 1) throw new Error('벗츠 응답 식별자가 올바르지 않습니다.'); return Number(value); }
export function buildGbutsOttPost(listing: GbutsOttListing, now = new Date()): Record<string, unknown> {
  return { category: GBUTS_OTT_CATEGORIES[listing.serviceType], countries: ['KR'],
    subscriptionType: 'SHARE', subscriptionPrincipal: '1:1 채팅의 계정 확인 링크를 열어주세요', subscriptionCredential: '1:1 채팅 확인',
    subscriptionStartsAt: `${koreaToday(now)} 00:00:00`, subscriptionEndsAt: `${listing.endDate} 23:59:59`,
    price: listing.dailyPrice, priceType: 'DAY', memberLimit: listing.capacity,
    title: `[${listing.serviceType}] ${listing.title}`, description: listing.description,
    noticeBeforeOrder: '1인 1회선으로 본인에게 배정된 프로필만 이용해주세요. 계정 정보와 프로필 설정을 변경하거나 타인에게 공유하지 마세요.',
    noticeAfterOrder: '구매 감사합니다. 계정 확인 링크를 1:1 채팅으로 자동 안내드립니다. 링크에서 이용 안내에 동의한 뒤 계정 정보를 확인해주세요.' };
}
export function createGbutsOttSellerClient(token: string, transport: typeof fetch = fetch) {
  const request = async (path: string, init?: RequestInit) => {
    const response = await transport(`https://api.gbuts.com${path}`, { ...init,
      headers: { 'Content-Type': 'application/json', api_key: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`벗츠 요청 실패 (${response.status})`);
    const payload = await response.json() as any;
    if (payload.success !== true || payload.error || payload.response === undefined) throw new Error('벗츠 요청 결과를 확인하지 못했습니다.');
    return payload;
  };
  const validatePost = (post: any): GbutsOttPost => {
    integer(post?.seq); integer(post?.category1?.seq); integer(post?.memberLimit);
    if (!Number.isSafeInteger(post.memberCount) || post.memberCount < 0 || !ottDate(post.subscriptionEndsAt) || typeof post.status !== 'string') throw new Error('벗츠 판매글 응답이 올바르지 않습니다.');
    return post;
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
    async createPost(listing: GbutsOttListing): Promise<number | null> {
      const data = (await request('/api/subscribe/share', { method: 'POST', body: JSON.stringify(buildGbutsOttPost(listing)) })).response;
      const seq = typeof data === 'number' ? data : data?.seq ?? data?.postSeq;
      return seq == null ? null : integer(seq);
    },
    async closePost(seq: number): Promise<void> { await request(`/api/seller/subscribe/share/${integer(seq)}/closed`, { method: 'POST' }); },
  };
}
