import { parseFragment, type DefaultTreeAdapterMap } from 'parse5';
import { EVERYVIEW_BASE, everyviewFetch, fetchEveryviewHostParties } from './everyview-api';

type Node = DefaultTreeAdapterMap['node'];
const descendants = (node: Node): Node[] => [node, ...('childNodes' in node ? node.childNodes.flatMap(descendants) : [])];
const attribute = (node: Node, name: string) => 'attrs' in node ? node.attrs.find(a => a.name === name)?.value : undefined;
const text = (node: Node): string => (node.nodeName === '#text' && 'value' in node ? node.value : '')
  + ('childNodes' in node ? node.childNodes.map(text).join('') : '');
const hasClass = (node: Node, name: string) => (attribute(node, 'class') || '').split(/\s+/).includes(name);
const positiveId = (value: number) => Number.isSafeInteger(value) && value > 0;

/** Returns only a server-rendered visibility state bound to the requested party. */
export function parseEveryviewRecruitmentVisibility(html: string, partyId: number): boolean {
  if (!positiveId(partyId)) throw Error('PARTY_ID_INVALID');
  const nodes = descendants(parseFragment(html));
  const meta = nodes.filter(node => hasClass(node, 'pld-card-meta'));
  const toggles = nodes.filter(node => node.nodeName === 'input' && attribute(node, 'id') === 'recruitToggle');
  const statuses = nodes.filter(node => hasClass(node, 'pld-recruit-state'));
  if (meta.length !== 1 || toggles.length !== 1 || statuses.length !== 1
    || attribute(toggles[0], 'type') !== 'checkbox') throw Error('VISIBILITY_UNCONFIRMED');
  const matched = text(meta[0]).match(/파티ID\s*:\s*s(\d+)(?:\s|·|$)/);
  if (!matched || Number(matched[1]) !== partyId) throw Error('PARTY_BINDING_UNVERIFIED');
  const status = text(statuses[0]).trim();
  const visible = attribute(toggles[0], 'checked') !== undefined;
  if ((status !== '노출' && status !== '숨김') || (status === '노출') !== visible) throw Error('VISIBILITY_UNCONFIRMED');
  return visible;
}

/** Uses the seller's owned-party list and a fresh server response, not optimistic UI state. */
export async function readEveryviewRecruitmentVisibility(cookie: string, partyId: number): Promise<boolean> {
  if (!cookie || !positiveId(partyId)) throw Error('VISIBILITY_READ_UNAVAILABLE');
  const matches = (await fetchEveryviewHostParties(cookie)).filter(p => p.partyId === partyId && p.partyType === 'free');
  if (matches.length !== 1) throw Error('PARTY_BINDING_UNVERIFIED');
  const response = await everyviewFetch(`${EVERYVIEW_BASE}/partyLeader_free_detail_type1?id=${partyId}`, { cookieStr: cookie, cache: 'no-store' });
  if (!response.ok || response.redirected) throw Error('VISIBILITY_READ_UNAVAILABLE');
  return parseEveryviewRecruitmentVisibility(await response.text(), partyId);
}

export type EveryviewHideResult = { ok: true; visible: false; verified: true }
  | { ok: false; code: 'VISIBILITY_READ_UNAVAILABLE' | 'VISIBILITY_UNCONFIRMED'; needsAttention: true };

/** One POST at most. An uncertain response is recovered through a fresh read only. */
export async function hideEveryviewRecruitment(cookie: string, partyId: number, maySubmit: () => boolean = () => true): Promise<EveryviewHideResult> {
  let initial: boolean;
  try { initial = await readEveryviewRecruitmentVisibility(cookie, partyId); }
  catch { return { ok: false, code: 'VISIBILITY_READ_UNAVAILABLE', needsAttention: true }; }
  if (!initial) return { ok: true, visible: false, verified: true };
  // Re-check the live safety switch immediately before issuing the mutation.
  try { if (!maySubmit()) return { ok: false, code: 'VISIBILITY_UNCONFIRMED', needsAttention: true }; }
  catch { return { ok: false, code: 'VISIBILITY_UNCONFIRMED', needsAttention: true }; }
  try {
    await everyviewFetch(`${EVERYVIEW_BASE}/api/generalParty/updateIsVisible`, {
      cookieStr: cookie, referer: `/partyLeader_free_detail_type1?id=${partyId}`,
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ partyId: String(partyId), isVisible: 'N' }).toString(),
    });
  } catch { /* A timeout may occur after submission. Read back; do not repeat POST. */ }
  try {
    if (!await readEveryviewRecruitmentVisibility(cookie, partyId)) return { ok: true, visible: false, verified: true };
  } catch { /* Missing or ambiguous read-back must not be treated as success. */ }
  return { ok: false, code: 'VISIBILITY_UNCONFIRMED', needsAttention: true };
}

export type EveryviewCutoff = { state: 'open' | 'close'; cutoffAt: string }
  | { state: 'blocked'; reason: 'INVALID_END_DATE' | 'INVALID_USAGE_DAYS' | 'INVALID_TIME'; needsAttention: true };

/** Close no later than Korean midnight, usageDays whole days before account expiry. */
export function everyviewRollingCutoff(accountEndDate: string, usageDays: number, now = new Date()): EveryviewCutoff {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(accountEndDate)) return { state: 'blocked', reason: 'INVALID_END_DATE', needsAttention: true };
  const [year,month,day] = accountEndDate.split('-').map(Number);
  const date = new Date(Date.UTC(year,month-1,day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month-1 || date.getUTCDate() !== day)
    return { state: 'blocked', reason: 'INVALID_END_DATE', needsAttention: true };
  if (!Number.isSafeInteger(usageDays) || usageDays < 1 || usageDays > 730)
    return { state: 'blocked', reason: 'INVALID_USAGE_DAYS', needsAttention: true };
  if (!Number.isFinite(now.getTime())) return { state: 'blocked', reason: 'INVALID_TIME', needsAttention: true };
  const cutoff = Date.UTC(year,month-1,day) - 9 * 60 * 60 * 1000 - usageDays * 24 * 60 * 60 * 1000;
  return { state: now.getTime() >= cutoff ? 'close' : 'open', cutoffAt: new Date(cutoff).toISOString() };
}
