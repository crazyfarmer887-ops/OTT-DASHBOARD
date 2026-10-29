import { parseFragment, type DefaultTreeAdapterMap } from 'parse5';
import { everyviewFetch, fetchEveryviewHostParties, parsePartyDetail } from './everyview-api';

/** Provider identities stay bound to a particular owned party. */
export interface EveryviewDisneyMember { memberSeq: number; userSeq: number }
export interface EveryviewDisneyObservation {
  partyId: number;
  observedAt: string;
  members: EveryviewDisneyMember[];
  visibleEmptySlots: number;
}
export interface EveryviewDisneyBinding { partyId: number; accountEmail: string }

type Node = DefaultTreeAdapterMap['node'];
const children = (node: Node): Node[] => 'childNodes' in node ? node.childNodes : [];
const all = (node: Node): Node[] => [node, ...children(node).flatMap(all)];
const attr = (node: Node, name: string) => 'attrs' in node ? node.attrs.find(a => a.name === name)?.value || '' : '';
const hasClass = (node: Node, name: string) => attr(node, 'class').split(/\s+/).includes(name);
const isPositiveId = (n: number) => Number.isSafeInteger(n) && n > 0;
const account = (value: string) => value.trim().toLowerCase();

/**
 * Do not persist page content, account passwords, names, or cookies. If markup
 * or identity is incomplete, reject the whole snapshot rather than silently
 * treating buyers as vacant. A disappeared member is NOT a verified refund.
 */
export function parseEveryviewDisneyObservation(html: string, binding: EveryviewDisneyBinding, now = new Date()): EveryviewDisneyObservation {
  if (!isPositiveId(binding.partyId) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(binding.accountEmail)) throw Error('BINDING_INVALID');
  const detail = parsePartyDetail(html, binding.partyId);
  if (!detail.hostName || !detail.serviceName || !/디즈니|disney/i.test(detail.serviceName)
    || !detail.loginInfo.length || detail.loginInfo.length !== 1 || detail.loginInfo[0].shareType !== 'ACCOUNT'
    || !detail.loginInfo[0].accountId || account(detail.loginInfo[0].accountId) !== account(binding.accountEmail)
    || detail.totalSlots < 1) throw Error('PARTY_BINDING_UNVERIFIED');
  const nodes = all(parseFragment(html));
  const slots = nodes.filter(n => hasClass(n, 'pld-slot') && attr(n, 'data-user-id'));
  const members = slots.map(node => {
    const match = attr(node, 'onclick').match(/^openGeneralPartyChat\((\d+),\s*(\d+)\)$/);
    const userSeq = Number(attr(node, 'data-user-id'));
    const memberSeq = Number(match?.[2]);
    if (!match || Number(match[1]) !== binding.partyId || !isPositiveId(userSeq) || !isPositiveId(memberSeq)) throw Error('MEMBER_IDENTITY_UNVERIFIED');
    return { memberSeq, userSeq };
  });
  const detailCount = detail.members.filter(m => m.state === 'member').length;
  if (members.length !== detailCount || detail.members.filter(m => m.state === 'host').length !== 1
    || new Set(members.map(x => x.memberSeq)).size !== members.length || new Set(members.map(x => x.userSeq)).size !== members.length)
    throw Error('ROSTER_INCOMPLETE');
  return { partyId: binding.partyId, observedAt: now.toISOString(), members, visibleEmptySlots: detail.emptySlots };
}

/** Reads only parties demonstrably owned by the authenticated seller. */
export async function collectEveryviewDisneyObservation(cookie: string, binding: EveryviewDisneyBinding, now = new Date()): Promise<EveryviewDisneyObservation> {
  if (!cookie) throw Error('SESSION_REQUIRED');
  const owned = (await fetchEveryviewHostParties(cookie)).filter(p => p.partyId === binding.partyId && p.partyType === 'free'
    && /디즈니|disney/i.test(p.serviceName || p.title));
  if (owned.length !== 1) throw Error('OWNED_PARTY_UNAVAILABLE');
  const response = await everyviewFetch(`https://everyview.kr/partyLeader_free_detail_type1?id=${binding.partyId}`, { cookieStr: cookie });
  if (!response.ok || response.redirected) throw Error('PARTY_READ_UNAVAILABLE');
  return parseEveryviewDisneyObservation(await response.text(), binding, now);
}

/**
 * Recruitment changes intentionally remain blocked until the provider's
 * recruitCnt meaning, zero-seat behaviour and read-back are proven for Disney.
 */
export function everyviewDisneyRecruitmentAction(): { state: 'blocked'; reason: 'RECRUITMENT_SEMANTICS_UNVERIFIED' } {
  return { state: 'blocked', reason: 'RECRUITMENT_SEMANTICS_UNVERIFIED' };
}
