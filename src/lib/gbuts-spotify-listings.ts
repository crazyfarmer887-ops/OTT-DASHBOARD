import { existsSync, readFileSync } from 'node:fs';
import { writeJsonAtomic } from './graytag-sales-session';
import { koreaToday } from './gbuts-ott';
import type { GbutsOttPost } from './gbuts-ott-client';

export const LEGACY_SPOTIFY_POST_SEQ = 15557;
export interface SpotifyListingInput {
  title: string; description: string; noticeBeforeOrder: string | null; noticeAfterOrder: string | null;
  startDate: string; endDate: string; dailyPrice: number; capacity: number;
}
export interface SpotifyListing extends SpotifyListingInput {
  id: string; requestHash: string; countries: string[]; createdAt: string;
  state: 'submitting' | 'uncertain' | 'registered'; beforePostSeqs: number[]; postSeq?: number; error?: string;
  deletedAt?: string;
}
export interface SpotifyListingStore { version: 1; listings: Record<string, SpotifyListing> }
const path = () => process.env.GBUTS_SPOTIFY_LISTINGS_PATH || '/home/ubuntu/.hermes/hermes-agent/graytag-aio-manager-0606/data/gbuts-spotify-listings.json';
export function readSpotifyListings(): SpotifyListingStore {
  if (!existsSync(path())) return { version: 1, listings: {} };
  const store = JSON.parse(readFileSync(path(), 'utf8'));
  if (store.version !== 1 || !store.listings || typeof store.listings !== 'object' || Array.isArray(store.listings))
    throw new Error('스포티파이 판매글 기록을 확인하지 못했습니다.');
  for (const [id, row] of Object.entries(store.listings) as Array<[string, SpotifyListing]>) {
    if (!row || row.id !== id || !['submitting', 'uncertain', 'registered'].includes(row.state)
      || !Array.isArray(row.beforePostSeqs) || !Array.isArray(row.countries)
      || (row.postSeq !== undefined && (!Number.isSafeInteger(row.postSeq) || row.postSeq < 1))
      || (row.state === 'registered' && !row.postSeq)
      || (row.deletedAt !== undefined && (row.state !== 'registered' || !Number.isFinite(Date.parse(row.deletedAt)))))
      throw new Error('스포티파이 판매글 기록이 올바르지 않습니다.');
  }
  return store;
}
export function writeSpotifyListings(store: SpotifyListingStore): void { writeJsonAtomic(path(), store); }
export function spotifyPostSeqs(): number[] {
  const legacy = Number(process.env.GBUTS_SPOTIFY_POST_SEQ || LEGACY_SPOTIFY_POST_SEQ);
  if (!Number.isSafeInteger(legacy) || legacy < 1) throw new Error('기존 스포티파이 판매글 번호를 확인해주세요.');
  return [...new Set([legacy, ...Object.values(readSpotifyListings().listings).filter(x => x.state === 'registered').map(x => x.postSeq!)])];
}
export function deletedSpotifyPostSeqs(): number[] {
  return Object.values(readSpotifyListings().listings).filter(x => x.deletedAt).map(x => x.postSeq!);
}
export function spotifyText(value: unknown): string {
  if (typeof value === 'string') {
    try { const parsed = JSON.parse(value); if (typeof parsed?.ko === 'string') return parsed.ko; } catch { /* plain text */ }
    return value;
  }
  return value && typeof value === 'object' && 'ko' in value ? String(value.ko || '') : '';
}
export function spotifyTemplate(post: GbutsOttPost, now = new Date()): SpotifyListingInput & { countries: string[]; sourcePostSeq: number } {
  if (post.category1.seq !== 20 || post.subscriptionType !== 'INVITE' || post.priceType !== 'DAY'
    || !Array.isArray(post.countries) || !post.countries.length || post.countries.some(x => typeof x !== 'string'))
    throw new Error('기존 스포티파이 초대형 판매글을 확인하지 못했습니다.');
  const startDate = koreaToday(now);
  const end = new Date(`${startDate}T00:00:00Z`); end.setUTCFullYear(end.getUTCFullYear() + 1); end.setUTCDate(end.getUTCDate() - 1);
  const result = { sourcePostSeq: post.seq, title: spotifyText(post.title), description: spotifyText(post.description),
    noticeBeforeOrder: post.noticeBeforeOrder == null ? null : spotifyText(post.noticeBeforeOrder),
    noticeAfterOrder: post.noticeAfterOrder == null ? null : spotifyText(post.noticeAfterOrder), countries: [...post.countries],
    startDate, endDate: end.toISOString().slice(0, 10), dailyPrice: Number(post.price), capacity: post.memberLimit };
  validateSpotifyListing(result, now);
  return result;
}
export function validateSpotifyListing(input: SpotifyListingInput, now = new Date()): void {
  const date = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  if (!input.title?.trim() || input.title.length > 100 || !input.description?.trim() || input.description.length > 5000
    || [input.noticeBeforeOrder, input.noticeAfterOrder].some(x => x !== null && (typeof x !== 'string' || x.length > 5000))
    || !date(input.startDate) || !date(input.endDate) || input.startDate < koreaToday(now) || input.endDate <= input.startDate
    || !Number.isSafeInteger(input.dailyPrice) || input.dailyPrice < 1 || input.dailyPrice > 100000
    || !Number.isSafeInteger(input.capacity) || input.capacity < 1 || input.capacity > 5)
    throw new Error('제목·본문·이용 기간·하루 요금·모집 인원(1~5명)을 확인해주세요.');
}
export function buildSpotifyListing(input: SpotifyListingInput & { countries: string[] }): Record<string, unknown> {
  return { category: 20, countries: input.countries, subscriptionType: 'INVITE', subscriptionPrincipal: null, subscriptionCredential: null,
    title: input.title, description: input.description, noticeBeforeOrder: input.noticeBeforeOrder, noticeAfterOrder: input.noticeAfterOrder,
    subscriptionStartsAt: `${input.startDate} 00:00:00`, subscriptionEndsAt: `${input.endDate} 23:59:59`,
    price: input.dailyPrice, priceType: 'DAY', memberLimit: input.capacity };
}
export function matchesSpotifyListing(post: GbutsOttPost, listing: SpotifyListing): boolean {
  return post.category1.seq === 20 && post.subscriptionType === 'INVITE' && post.priceType === 'DAY'
    && spotifyText(post.title) === listing.title && spotifyText(post.description) === listing.description
    && spotifyText(post.noticeBeforeOrder) === (listing.noticeBeforeOrder || '') && spotifyText(post.noticeAfterOrder) === (listing.noticeAfterOrder || '')
    && String(post.subscriptionStartsAt).slice(0, 10) === listing.startDate && String(post.subscriptionEndsAt).slice(0, 10) === listing.endDate
    && Number(post.price) === listing.dailyPrice && post.memberLimit === listing.capacity
    && JSON.stringify([...(post.countries || [])].sort()) === JSON.stringify([...listing.countries].sort());
}
