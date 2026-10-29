import { parseFragment, type DefaultTreeAdapterMap } from 'parse5';
import { EVERYVIEW_BASE, everyviewFetch, fetchEveryviewHostParties, parsePartyDetail } from './everyview-api';
import { disneyEveryviewAccountKey } from './gbuts-disney-everyview';
import { GBUTS_OTT_CATEGORIES, activeOttOrder, disneyAccountCapacity, holdsDisneyProfile, koreaToday, ottDate, ottKey, sharedOttAccounts, type GbutsOttStore } from './gbuts-ott';
import { decodeGbutsSubscriptionCredential } from './gbuts-subscription-credentials';
import { assertGbutsOttCredentials, buildGbutsDisneyDirectText } from './gbuts-disney-delivery';
import type { GbutsOttRuntimeDependencies } from '../scheduler/gbuts-ott-sync';
import type { GbutsOttMember, GbutsOttPost } from './gbuts-ott-client';
import type { EveryviewDisneyPublishPreflight, EveryviewDisneyPublishRequest, EveryviewDisneyPublicationProof } from '../scheduler/everyview-disney-publish';

type Node = DefaultTreeAdapterMap['node'];
const all = (node: Node): Node[] => [node, ...('childNodes' in node ? node.childNodes.flatMap(all) : [])];
const attr = (node: Node, name: string) => 'attrs' in node ? node.attrs.find(a => a.name === name)?.value : undefined;
const content = (node: Node): string => (node.nodeName === '#text' && 'value' in node ? node.value : '')
  + ('childNodes' in node ? node.childNodes.map(content).join('') : '');
const cls = (node: Node, name: string) => (attr(node,'class') || '').split(/\s+/).includes(name);
const norm = (s: string) => s.trim().toLowerCase();
const integer = (value: string | undefined): number | null => {
  if (!value || !/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(value.trim())) return null;
  const n = Number(value.replace(/,/g,''));return Number.isSafeInteger(n) ? n : null;
};

/** Parses only explicitly rendered seller and buyer evidence; incomplete data is never a success. */
export function parseEveryviewDisneyPublicationProof(input: {
  partyId: number; accountEmail: string; owned: boolean; hostHtml: string; publicHtml: string;
  expectedAdditionalInfo: string; expectedPassword: string;
}): EveryviewDisneyPublicationProof | null {
  const { partyId, accountEmail, owned, hostHtml, publicHtml, expectedAdditionalInfo, expectedPassword } = input;
  if (!owned || !Number.isSafeInteger(partyId) || partyId < 1 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(accountEmail)
    || !expectedAdditionalInfo || !expectedPassword) return null;
  const host = parsePartyDetail(hostHtml, partyId), h = all(parseFragment(hostHtml)), p = all(parseFragment(publicHtml));
  if (!host.hostName || !host.serviceName || !/디즈니|disney/i.test(host.serviceName)
    || host.loginInfo.length !== 1 || host.loginInfo[0].shareType !== 'ACCOUNT'
    || norm(host.loginInfo[0].accountId || '') !== norm(accountEmail) || host.loginInfo[0].accountPassword !== expectedPassword) return null;
  const uniqueInput = (id: string) => { const list = h.filter(n => n.nodeName === 'input' && attr(n,'id') === id);return list.length === 1 ? attr(list[0],'value') : undefined; };
  const extra = h.filter(n => n.nodeName === 'textarea' && cls(n,'login-additionalInfo'));
  if (extra.length !== 1 || content(extra[0]).trim() !== expectedAdditionalInfo.trim()) return null;
  const hostId = integer(uniqueInput('editPartyId')), payment = uniqueInput('editPaymentType'), rolling = uniqueInput('editIsRolling');
  const baseDays = integer(uniqueInput('editBaseDays')), fee = integer(uniqueInput('editUsageFee'));
  const cap = integer(uniqueInput('editRecruitCnt')), members = integer(uniqueInput('editCurrentMemberCnt'));
  if (hostId !== partyId || payment !== 'PERIOD' || rolling !== 'Y' || baseDays !== 30 || fee !== 2910 || cap !== 1
    || members === null || members < 0 || members > 1) return null;
  const metas = p.filter(n => cls(n,'fpd-party-meta')), tags = p.filter(n => cls(n,'fpd-svc-tag'));
  if (metas.length !== 1 || !new RegExp(`파티ID\\s*:\\s*s${partyId}(?:\\s|·|$)`).test(content(metas[0]))
    || !tags.some(n => /디즈니|disney/i.test(content(n)))) return null;
  const stats = p.filter(n => cls(n,'fpd-stat-item'));
  const getStat = (label: string) => {
    const hits = stats.filter(n => all(n).some(x => cls(x,'fpd-stat-label') && content(x).trim() === label));
    if (hits.length !== 1) return null;
    const values = all(hits[0]).filter(x => cls(x,'fpd-stat-val'));
    const subs = all(hits[0]).filter(x => cls(x,'fpd-stat-sub'));
    return values.length === 1 && subs.length === 1 ? { value: content(values[0]).trim(), sub: content(subs[0]).trim() } : null;
  };
  const period = getStat('이용기간'), total = getStat('이용료'), end = getStat('파티 종료일'), capacity = getStat('모집 현황');
  if (period?.value !== '30일' || period.sub !== '참여일부터' || total?.value !== '2,910원'
    || !/^월\s*2,910원\s*꼴$/.test(total.sub) || end?.value !== '기간만료 시'
    || !capacity || !/^[01]\s*\/\s*1$/.test(capacity.value)) return null;
  // The published monthly-equivalent is the provider's displayed 30-day
  // rate; here it equals 97/day exactly. A raw persisted daily field is not
  // independently exposed by this HTML, so callers must not claim otherwise.
  return { partyId, owned: true, serviceCode: 'disney_plus', accountEmail, shareType: 'ACCOUNT', periodTermType: 'ROLLING',
    usageDays: 30, totalUsageFee: 2910, oneDayUsageFee: 97, monthUsageFee: 2910, shareEndDate: null,
    buyerCapacity: 1, profileNumber: 6, emailAccessVerified: true };
}

/** Performs GETs only; a hidden/unavailable public page is inconclusive. */
export async function readEveryviewDisneyPublicationProof(cookie: string, partyId: number, accountEmail: string,
  expected: { additionalInfo:string; password:string }): Promise<EveryviewDisneyPublicationProof | null> {
  if (!cookie || !Number.isSafeInteger(partyId) || partyId < 1) return null;
  const owned = (await fetchEveryviewHostParties(cookie)).filter(p => p.partyType === 'free' && p.partyId === partyId);
  if (owned.length !== 1) return null;
  const [host, publicPage] = await Promise.all([
    everyviewFetch(`${EVERYVIEW_BASE}/partyLeader_free_detail_type1?id=${partyId}`, { cookieStr: cookie, cache: 'no-store', redirect: 'manual' }),
    everyviewFetch(`${EVERYVIEW_BASE}/findParty_free_detail?id=${partyId}`, { cookieStr: cookie, cache: 'no-store', redirect: 'manual' }),
  ]);
  if (!host.ok || !publicPage.ok || host.redirected || publicPage.redirected) return null;
  return parseEveryviewDisneyPublicationProof({ partyId, accountEmail, owned: true, hostHtml: await host.text(), publicHtml: await publicPage.text(),
    expectedAdditionalInfo: expected.additionalInfo, expectedPassword: expected.password });
}

export type EveryviewDisneyReadiness = { syncReady: boolean; cutoffReady: boolean; profileDeliveryReady: boolean };
/** Existing Everyview parties must be checked independently of the GButs ledger. */
export async function noExistingEveryviewDisneyAccount(cookie:string, email:string):Promise<boolean> {
  if (!cookie || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw Error('EVERYVIEW_SOURCE_UNAVAILABLE');
  const parties=await fetchEveryviewHostParties(cookie);
  // An empty parsed collection may be a changed, partially loaded or stale
  // owner page; no verified empty-state marker is available in this adapter.
  if(!parties.length)throw Error('EVERYVIEW_SOURCE_UNAVAILABLE');
  for(const party of parties) {
    if(party.partyType === 'general') {
      // Provider-managed Disney parties do not expose a verifiable account mapping here.
      if(/디즈니|disney/i.test(`${party.title} ${party.serviceName || ''}`)) return false;
      continue;
    }
    const response=await everyviewFetch(`${EVERYVIEW_BASE}/partyLeader_free_detail_type1?id=${party.partyId}`,{cookieStr:cookie,cache:'no-store',redirect:'manual'});
    if(!response.ok || response.redirected)throw Error('EVERYVIEW_SOURCE_UNAVAILABLE');
    const html=await response.text(), nodes=all(parseFragment(html));
    const ids=nodes.filter(n=>n.nodeName==='input'&&attr(n,'id')==='editPartyId');
    if(ids.length!==1 || integer(attr(ids[0],'value'))!==party.partyId)throw Error('EVERYVIEW_SOURCE_UNAVAILABLE');
    const detail=parsePartyDetail(html,party.partyId);
    if(!detail.hostName || !detail.serviceName || detail.loginInfo.length !== 1) throw Error('EVERYVIEW_SOURCE_UNAVAILABLE');
    const info=detail.loginInfo[0];
    if(info.shareType === 'ACCOUNT') {
      if(!info.accountId) throw Error('EVERYVIEW_SOURCE_UNAVAILABLE');
      if(norm(info.accountId)===norm(email))return false;
    } else if(/디즈니|disney/i.test(detail.serviceName)) return false;
  }
  return true;
}
export interface EveryviewDisneyPreflightSources {
  gbuts: GbutsOttRuntimeDependencies;
  listPosts(): Promise<GbutsOttPost[]>;
  getPost(seq: number): Promise<GbutsOttPost>;
  listMembers(seq: number): Promise<GbutsOttMember[]>;
  everyviewNoConflict(request: EveryviewDisneyPublishRequest): Promise<boolean>;
  /** Must inspect the live workers/config; a caller cannot infer readiness from source code or unit tests. */
  readiness(request: EveryviewDisneyPublishRequest): Promise<EveryviewDisneyReadiness>;
  now(): Date;
}

/** Fresh seller listing, current buyers, all platform commitments and credentials. GETs only. */
export async function readEveryviewDisneyPreflight(store: GbutsOttStore, request: EveryviewDisneyPublishRequest,
  sources: EveryviewDisneyPreflightSources): Promise<EveryviewDisneyPublishPreflight> {
  const now = sources.now(), accountHash = disneyEveryviewAccountKey(request.accountEmail), accountKey = ottKey('디즈니플러스', request.accountEmail);
  const listings = Object.values(store.listings).filter(l => ottKey(l.serviceType,l.accountEmail) === accountKey && l.state === 'registered'
    && l.deliveryMode === 'disney-numbered-password' && !l.replacedBy && l.postSeq);
  if (listings.length !== 1 || listings[0].capacity < 1 || listings[0].capacity > 5 || disneyAccountCapacity(store,listings[0]) !== 5
    || !sources.gbuts.listingCredentials) throw Error('GBUTS_LISTING_UNVERIFIED');
  const listing = listings[0], [posts,post,members,management,ready,credentials,everyviewClear] = await Promise.all([
    sources.listPosts(),sources.getPost(listing.postSeq!),sources.listMembers(listing.postSeq!),(sources.gbuts.renewalManagement ? sources.gbuts.renewalManagement('디즈니플러스') : sources.gbuts.management({ forceRefresh: true })),
    sources.readiness(request),sources.gbuts.listingCredentials(listing),sources.everyviewNoConflict(request),
  ]);
  if (everyviewClear !== true) throw Error('EVERYVIEW_CONFLICT_OR_UNVERIFIED');
  if (posts.filter(p => p.seq === post.seq).length !== 1 || post.seq !== listing.postSeq || post.category1.seq !== GBUTS_OTT_CATEGORIES['디즈니플러스']
    || post.status !== 'ON_SALE' || post.memberLimit !== listing.capacity || ottDate(post.subscriptionEndsAt) !== listing.endDate
    || members.length < post.memberCount || !Number.isSafeInteger(post.memberCount)
    || new Set(members.map(m => m.seq)).size !== members.length
    || members.some(m => !Number.isSafeInteger(m.seq) || m.seq < 1 || !Number.isSafeInteger(m.userSeq) || m.userSeq < 1))
    throw Error('GBUTS_LISTING_UNVERIFIED');
  const matches = management.services.flatMap(s => s.accounts).filter(a => ottKey(a.serviceType,a.email) === accountKey);
  if (matches.length !== 1 || ottDate(matches[0].expiryDate) !== request.accountEndDate || listing.endDate > request.accountEndDate)
    throw Error('ACCOUNT_EXPIRY_UNVERIFIED');
  const manual = sources.gbuts.manualMembers(), account = sharedOttAccounts(management,manual,store,now).find(a => a.key === accountKey);
  if (!account || !account.eligible || account.overbooked || account.total !== 6 || account.gbuts !== 5
    || account.graytag !== 0 || account.manual !== 0 || account.claims !== 0 || account.occupied !== 5 || account.available !== 1)
    throw Error('ACCOUNT_SEATS_UNVERIFIED');
  const holds = Object.values(store.orders).filter(o => {
    const l = store.listings[o.listingId];return l && ottKey(l.serviceType,l.accountEmail) === accountKey
      && (activeOttOrder(o,now) || holdsDisneyProfile(o,l,now) || (o.status === 'MISSING' && o.cancelStatus !== 'REFUNDED' && o.endDate >= koreaToday(now)));
  });
  if (holds.some(o => !Number.isInteger(o.profileNumber) || o.profileNumber! < 1 || o.profileNumber! > 5)) throw Error('PROFILE_CONFLICT');
  const heldPostSeqs = [...new Set(holds.map(o => o.postSeq))];
  const providerMembers = new Map<number,GbutsOttMember[]>([[post.seq,members]]);
  for (const seq of heldPostSeqs.filter(seq => seq !== post.seq)) {
    if (posts.filter(p => p.seq === seq).length !== 1) throw Error('MEMBER_UNVERIFIED');
    const [oldPost,oldMembers] = await Promise.all([sources.getPost(seq),sources.listMembers(seq)]);
    if (oldPost.seq !== seq || oldPost.category1.seq !== GBUTS_OTT_CATEGORIES['디즈니플러스']
      || oldMembers.length < oldPost.memberCount || new Set(oldMembers.map(m => m.seq)).size !== oldMembers.length)
      throw Error('MEMBER_UNVERIFIED');
    providerMembers.set(seq,oldMembers);
  }
  for (const [seq,items] of providerMembers) for (const m of items.filter(x => x.status === 'APPLY' && x.cancelStatus !== 'REFUNDED' && ottDate(x.subscriptionEndsAt) >= koreaToday(now))) {
    const record = store.orders[`${seq}:${m.seq}`];
    if (!record || record.userSeq !== m.userSeq || record.cancelStatus === 'REFUNDED' || record.endDate !== ottDate(m.subscriptionEndsAt))
      throw Error('MEMBER_UNVERIFIED');
  }
  for (const hold of holds) {
    const m = providerMembers.get(hold.postSeq)?.find(x => x.seq === hold.memberSeq && x.userSeq === hold.userSeq);
    if (!m || m.cancelStatus === 'REFUNDED' || ottDate(m.subscriptionEndsAt) !== hold.endDate) throw Error('MEMBER_UNVERIFIED');
  }
  assertGbutsOttCredentials(credentials);
  // Existing Disney delivery policy requires a usable email-verification path
  // and PIN when applicable; evaluate privately without logging the output.
  buildGbutsDisneyDirectText(credentials, 6);
  if (norm(credentials.id) !== norm(request.accountEmail)
    || norm(decodeGbutsSubscriptionCredential(post.subscriptionPrincipal)) !== norm(credentials.id)
    || decodeGbutsSubscriptionCredential(post.subscriptionCredential) !== credentials.password) throw Error('CREDENTIALS_UNVERIFIED');
  return { accountHash, accountEndDate: request.accountEndDate, verifiedAt: now.toISOString(), accountCapacity: 6,
    committedOtherPlaces: 5, profile6Available: true, otherSourcesComplete: true, currentAdvertisementsReserved: true,
    syncReady: ready.syncReady === true, cutoffReady: ready.cutoffReady === true,
    profileDeliveryReady: ready.profileDeliveryReady === true, credentialsValidated: true };
}

/** Read-only runtime adapter. It does not issue publication, chat or profile mutations. */
export function createEveryviewDisneyPublishEvidenceAdapter(input: {
  sources: Omit<EveryviewDisneyPreflightSources,'readiness'|'everyviewNoConflict'>;
  readStore(): GbutsOttStore;
  cookie(): string | null;
  /** Omit until the live synchronization, cutoff and buyer-delivery workers are independently proven. */
  readiness?: (request: EveryviewDisneyPublishRequest) => Promise<EveryviewDisneyReadiness>;
}) {
  const readiness = input.readiness || (async () => ({ syncReady: false, cutoffReady: false, profileDeliveryReady: false }));
  return {
    preflight: (store: GbutsOttStore, request: EveryviewDisneyPublishRequest) => readEveryviewDisneyPreflight(store,request,{ ...input.sources, readiness,
      everyviewNoConflict: async current => {const cookie=input.cookie();if(!cookie)throw Error('EVERYVIEW_SOURCE_UNAVAILABLE');return noExistingEveryviewDisneyAccount(cookie,current.accountEmail);} }),
    credentials: async (request: EveryviewDisneyPublishRequest) => {
      const key=ottKey('디즈니플러스',request.accountEmail);
      const listings=Object.values(input.readStore().listings).filter(l => ottKey(l.serviceType,l.accountEmail) === key
        && l.state === 'registered' && l.deliveryMode === 'disney-numbered-password' && !l.replacedBy && l.postSeq);
      if (listings.length !== 1 || !input.sources.gbuts.listingCredentials) throw Error('CREDENTIALS_UNVERIFIED');
      const result = await input.sources.gbuts.listingCredentials(listings[0]);
      if (norm(result.id) !== norm(request.accountEmail)) throw Error('CREDENTIALS_UNVERIFIED');
      buildGbutsDisneyDirectText(result,6);
      return { id:result.id,password:result.password,emailAccessUrl:result.emailAccessUrl!,emailAccessPin:result.emailAccessPin };
    },
    verify: async (partyId: number, request: EveryviewDisneyPublishRequest, expected: {additionalInfo:string;password:string}) => {
      const cookie=input.cookie();if(!cookie)return null;
      return readEveryviewDisneyPublicationProof(cookie,partyId,request.accountEmail,expected);
    },
  };
}
