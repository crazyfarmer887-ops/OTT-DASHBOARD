import { afterEach, describe, expect, it, vi } from 'vitest';
import { everyviewRollingCutoff, hideEveryviewRecruitment, parseEveryviewRecruitmentVisibility } from '../src/lib/everyview-recruitment-safety';

const hostList = '<a class="mypg-gc host" href="/partyLeader_free_detail_type1?id=123" data-search="디즈니 s123 disney_plus 디즈니+">party</a>';
const detail = (visible: boolean, id = 123) => `<div class="pld-card-meta">파티ID : <span>s${id}</span> &nbsp;·&nbsp; 가입일</div>
<span id="recruitStatus"><span class="pld-recruit-state">${visible ? '노출' : '숨김'}</span></span>
<input type="checkbox" id="recruitToggle" ${visible ? 'checked="checked"' : ''}>`;
afterEach(() => vi.unstubAllGlobals());

describe('Everyview recruitment visibility', () => {
  it('requires an unambiguous checkbox and matching state for the correct party', () => {
    expect(parseEveryviewRecruitmentVisibility(detail(true), 123)).toBe(true);
    expect(parseEveryviewRecruitmentVisibility(detail(false), 123)).toBe(false);
    expect(() => parseEveryviewRecruitmentVisibility(detail(true, 124), 123)).toThrow('PARTY_BINDING_UNVERIFIED');
    expect(() => parseEveryviewRecruitmentVisibility(detail(true).replace('노출', '숨김'), 123)).toThrow('VISIBILITY_UNCONFIRMED');
    expect(() => parseEveryviewRecruitmentVisibility(detail(true) + '<input type="checkbox" id="recruitToggle">', 123)).toThrow('VISIBILITY_UNCONFIRMED');
    expect(() => parseEveryviewRecruitmentVisibility('<html>로그인</html>', 123)).toThrow('VISIBILITY_UNCONFIRMED');
  });
  it('submits once then confirms the saved hidden state from a new page read', async () => {
    const calls: Array<{ url: string; options: RequestInit }> = [];
    let posted = false;
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, options: RequestInit = {}) => {
      const url = String(input); calls.push({ url, options });
      if (url.endsWith('/myParty')) return new Response(hostList);
      if (url.includes('/partyLeader_free_detail_type1')) return new Response(detail(!posted));
      if (url.endsWith('/api/generalParty/updateIsVisible')) { posted = true; return new Response('{"result":"200"}'); }
      throw Error('unexpected');
    }));
    expect(await hideEveryviewRecruitment('private-session', 123)).toEqual({ ok: true, visible: false, verified: true });
    const posts = calls.filter(c => c.options.method === 'POST');
    expect(posts).toHaveLength(1);
    expect(posts[0].url).toBe('https://everyview.kr/api/generalParty/updateIsVisible');
    expect(posts[0].options.body).toBe('partyId=123&isVisible=N');
    expect(calls.filter(c => c.url.includes('partyLeader_free_detail_type1'))).toHaveLength(2);
  });
  it('recovers a timed-out submission only by checking the saved state', async () => {
    let posted = false, posts = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/myParty')) return new Response(hostList);
      if (url.includes('/partyLeader_free_detail_type1')) return new Response(detail(!posted));
      if (url.endsWith('/api/generalParty/updateIsVisible')) { posted = true; posts++; throw Error('timeout'); }
      throw Error('unexpected');
    }));
    expect(await hideEveryviewRecruitment('private-session', 123)).toEqual({ ok: true, visible: false, verified: true });
    expect(posts).toBe(1);
  });
  it('reports an actionable unknown result if the server remains visible or read-back fails', async () => {
    let posts = 0, detailReads = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/myParty')) return new Response(hostList);
      if (url.includes('/partyLeader_free_detail_type1')) { detailReads++; return new Response(detail(true)); }
      if (url.endsWith('/api/generalParty/updateIsVisible')) { posts++; return new Response('{"result":"200"}'); }
      throw Error('unexpected');
    }));
    expect(await hideEveryviewRecruitment('private-session', 123)).toEqual({ ok: false, code: 'VISIBILITY_UNCONFIRMED', needsAttention: true });
    expect(posts).toBe(1);expect(detailReads).toBe(2);
  });
  it('does not submit when the seller does not own the party or it is already hidden', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => String(input).endsWith('/myParty') ? new Response(hostList) : new Response(detail(false)));
    vi.stubGlobal('fetch', fetchMock);
    expect(await hideEveryviewRecruitment('private-session', 124)).toEqual({ ok: false, code: 'VISIBILITY_READ_UNAVAILABLE', needsAttention: true });
    expect(await hideEveryviewRecruitment('private-session', 123)).toEqual({ ok: true, visible: false, verified: true });
    expect(fetchMock.mock.calls.every(call => !String(call[0]).endsWith('updateIsVisible'))).toBe(true);
  });
  it('honors a safety pause immediately before the POST', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => String(input).endsWith('/myParty') ? new Response(hostList) : new Response(detail(true)));
    vi.stubGlobal('fetch', fetchMock);
    expect(await hideEveryviewRecruitment('private-session', 123, () => false)).toEqual({ ok: false, code: 'VISIBILITY_UNCONFIRMED', needsAttention: true });
    expect(fetchMock.mock.calls.every(call => !String(call[0]).endsWith('updateIsVisible'))).toBe(true);
  });
});

describe('Everyview rolling-term cutoff', () => {
  it('closes at Korean midnight 30 whole days before the account end date', () => {
    const before = everyviewRollingCutoff('2027-01-24', 30, new Date('2026-12-24T14:59:59Z'));
    expect(before).toEqual({ state: 'open', cutoffAt: '2026-12-24T15:00:00.000Z' });
    expect(everyviewRollingCutoff('2027-01-24', 30, new Date('2026-12-24T15:00:00Z'))).toEqual({ state: 'close', cutoffAt: '2026-12-24T15:00:00.000Z' });
    expect(everyviewRollingCutoff('2027-04-24', 30, new Date('2027-03-25T15:00:00Z'))).toEqual({ state: 'close', cutoffAt: '2027-03-24T15:00:00.000Z' });
  });
  it('blocks malformed dates, out-of-range terms and invalid clocks', () => {
    expect(everyviewRollingCutoff('2027-02-29', 30)).toMatchObject({ state: 'blocked', needsAttention: true });
    expect(everyviewRollingCutoff('2027-01-24', 0)).toMatchObject({ state: 'blocked', needsAttention: true });
    expect(everyviewRollingCutoff('2027-01-24', 731)).toMatchObject({ state: 'blocked', needsAttention: true });
    expect(everyviewRollingCutoff('2027-01-24', 30, new Date('invalid'))).toMatchObject({ state: 'blocked', needsAttention: true });
  });
});
