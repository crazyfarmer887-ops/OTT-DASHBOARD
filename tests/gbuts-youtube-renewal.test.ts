import { describe, expect, it, vi } from 'vitest';
import { createCipheriv, createHash } from 'node:crypto';
import { bindYouTubeRenewal, renewYouTubeInvites, validateYouTubeRenewals, youtubeOccupied, type YouTubeRenewalStore, type InviteClient, type InvitePayload } from '../src/scheduler/gbuts-youtube-renewal';

function encrypted(value: string) {
  const ascii = Buffer.from(createHash('sha512').update('kkmouke0917').digest('hex'));
  const key = Buffer.alloc(16);
  for (let i = 0; i < ascii.length; i++) key[i % 16] ^= ascii[i];
  const cipher = createCipheriv('aes-128-ecb', key, null);
  return Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]).toString('hex');
}

function fixture() {
  let now = new Date('2026-10-27T05:00:00Z');
  const post: any = { seq: 1, category1: { seq: 7 }, subscriptionType: 'INVITE', priceType: 'DAY', price: 190, memberLimit: 5, memberCount: 1,
    status: 'ON_SALE', subscriptionStartsAt: '2026-10-26 00:00:00', subscriptionEndsAt: '2026-11-26 23:59:59', countries: ['KR'],
    title: JSON.stringify({ ko: '[유튜브] 광고X 음악' }), description: '초대장을 받으실 Google 이메일을 남겨주세요.', noticeBeforeOrder: '구매 전 안내', noticeAfterOrder: '기존 계정 그대로 초대' };
  let rows: any[] = [{ seq: 10, userSeq: 20, status: 'APPLY', cancelStatus: null, createdAt: '2026-10-27 12:00:00', subscriptionEndsAt: post.subscriptionEndsAt }];
  const s: YouTubeRenewalStore = { version: 1, policies: {} }; const p = bindYouTubeRenewal(s, post, true, new Date(now.getTime() - 600_000));
  const posts: Record<number, any> = { 1: post }; const saved: YouTubeRenewalStore[] = [];
  const client = { getPost: vi.fn(async (seq: number) => structuredClone(posts[seq])), listOttMembers: vi.fn(async () => structuredClone(rows)),
    listOttPublicRanking: vi.fn(async () => [2,3,4,5,6,1].map((seq,i) => ({ seq, sellerSeq: i === 0 ? 200 : 100 }))), sellerAccountSeq: vi.fn(async () => 100),
    latestPostSeq: vi.fn(async () => 10), listPostsAfter: vi.fn(async () => Object.values(posts).filter(x => x.seq > 10)),
    closePost: vi.fn(async (seq: number) => { posts[seq].status = 'CLOSED'; }),
    createYouTubeInvitePost: vi.fn(async (payload: InvitePayload) => { posts[11] = { ...payload, seq: 11, category1: { seq: 7 }, memberCount: 0, status: 'ON_SALE', title: JSON.stringify({ ko: payload.title }) }; return 11; }) };
  const run = () => renewYouTubeInvites(client as InviteClient, { read: () => s, write: value => { validateYouTubeRenewals(value); saved.push(structuredClone(value)); }, now });
  return { s, p, post, client, posts, saved, run, setRows(value: any[]) { rows = value; }, advance(ms = 60_000) { now = new Date(now.getTime() + ms); } };
}
describe('YouTube INVITE rank renewal', () => {
  it('reposts encrypted empty invitation credentials and adopts the encrypted result', async () => {
    const f = fixture();
    f.post.subscriptionPrincipal = encrypted('');
    f.post.subscriptionCredential = encrypted('');
    const create = f.client.createYouTubeInvitePost.getMockImplementation()!;
    f.client.createYouTubeInvitePost.mockImplementation(async payload => {
      const seq = await create(payload);
      f.posts[seq].subscriptionPrincipal = encrypted('');
      f.posts[seq].subscriptionCredential = encrypted('');
      return seq;
    });
    await f.run();
    expect(f.client.createYouTubeInvitePost).toHaveBeenCalledOnce();
    expect(f.client.createYouTubeInvitePost).toHaveBeenCalledWith(expect.objectContaining({ memberLimit: 4, subscriptionPrincipal: '', subscriptionCredential: '' }));
    f.advance(); await f.run();
    expect(f.p.currentPostSeq).toBe(11);
    expect(f.p.pending).toBeUndefined();
    expect(f.p.lastError).toBeUndefined();
    expect(f.p.members['1:10']).toMatchObject({ postSeq: 1, seq: 10 });
  });
  it('still blocks corrupt encrypted credentials before closing the original post', async () => {
    const f = fixture();
    f.post.subscriptionPrincipal = encrypted('');
    f.post.subscriptionCredential = '0'.repeat(32);
    await f.run();
    expect(f.client.closePost).not.toHaveBeenCalled();
    expect(f.client.createYouTubeInvitePost).not.toHaveBeenCalled();
    expect(f.p.lastError).toBeTruthy();
    expect(f.p.pending).toBeUndefined();
  });
  it('keeps INVITE terms and only unsold seats, retaining buyer bindings on their old post', async () => {
    const f = fixture(); await f.run();
    expect(f.client.createYouTubeInvitePost).toHaveBeenCalledOnce();
    expect(f.client.createYouTubeInvitePost).toHaveBeenCalledWith(expect.objectContaining({ category: 7, subscriptionType: 'INVITE', subscriptionPrincipal: '', subscriptionCredential: '', price: 190, memberLimit: 4,
      description: f.post.description, noticeAfterOrder: f.post.noticeAfterOrder, subscriptionEndsAt: f.post.subscriptionEndsAt }));
    expect(f.saved.some(s => s.policies['1'].pending?.phase === 'closing')).toBe(true);
    expect(f.saved.some(s => s.policies['1'].pending?.phase === 'publishing' && !s.policies['1'].pending?.postSeq)).toBe(true);
    f.advance(); await f.run(); expect(f.p.currentPostSeq).toBe(11); expect(f.p.pending).toBeUndefined();
    expect(f.p.members['1:10']).toMatchObject({ postSeq: 1, seq: 10, userSeq: 20 }); expect(youtubeOccupied(f.p)).toBe(1);
  });
  it('does not churn for own posts or inside the five-minute cooldown', async () => {
    const f = fixture(); f.client.listOttPublicRanking.mockResolvedValue([2,3,4,5,6,1].map(seq => ({ seq, sellerSeq: 100 })));
    await f.run(); expect(f.client.closePost).not.toHaveBeenCalled();
    const g = fixture(); g.p.lastRepostedAt = '2026-10-27T04:59:00Z'; await g.run(); expect(g.client.closePost).not.toHaveBeenCalled();
  });
  it('reads the final roster after closing and subtracts a last-second sale', async () => {
    const f = fixture(); const first = await f.client.listOttMembers();
    f.client.closePost.mockImplementation(async () => { f.post.status = 'CLOSED'; f.post.memberCount = 2; f.setRows([...first, { ...first[0], seq: 12, userSeq: 22 }]); });
    await f.run(); expect(f.client.createYouTubeInvitePost.mock.calls[0][0].memberLimit).toBe(3);
  });
  it('preserves missing unrefunded seats instead of overselling them', async () => {
    const f = fixture(); f.p.members['1:9'] = { postSeq: 1, seq: 9, userSeq: 19, status: 'APPLY', cancelStatus: null, endDate: f.p.endDate };
    await f.run(); expect(f.p.members['1:9'].status).toBe('MISSING'); expect(f.client.createYouTubeInvitePost.mock.calls[0][0].memberLimit).toBe(3);
  });
  it('never repeats a CREATE whose response was lost; paused recovery adopts the one existing result', async () => {
    const f = fixture(); const create = f.client.createYouTubeInvitePost.getMockImplementation()!;
    f.client.createYouTubeInvitePost.mockImplementation(async payload => { await create(payload); throw Error('lost response'); });
    await f.run(); expect(f.p.pending?.phase).toBe('publishing'); f.p.enabled = false; f.advance(); await f.run();
    expect(f.p.currentPostSeq).toBe(11); expect(f.client.createYouTubeInvitePost).toHaveBeenCalledOnce(); expect(f.p.enabled).toBe(false);
  });
  it('holds ambiguous or absent submitted results without publishing again', async () => {
    const f = fixture(); f.client.createYouTubeInvitePost.mockImplementation(async () => { throw Error('unknown'); });
    await f.run(); f.advance(); await f.run(); f.advance(); await f.run(); expect(f.p.pending?.phase).toBe('publishing'); expect(f.client.createYouTubeInvitePost).toHaveBeenCalledOnce();
  });
  it('rejects identity/condition changes and incomplete rosters before closure', async () => {
    const f = fixture(); f.post.memberCount = 2; await f.run(); expect(f.client.closePost).not.toHaveBeenCalled(); expect(f.p.lastError).toBeTruthy();
    const g = fixture(); g.post.subscriptionType = 'SHARE'; await g.run(); expect(g.client.closePost).not.toHaveBeenCalled();
  });
  it('does not publish when the final sale fills the chain', async () => {
    const f = fixture(); f.client.closePost.mockImplementation(async () => { f.post.status = 'CLOSED'; f.post.memberCount = 5;
      f.setRows(Array.from({ length: 5 }, (_,i) => ({ seq: 10+i, userSeq: 20+i, status: 'APPLY', cancelStatus: null, createdAt: '2026-10-27 12:00:00', subscriptionEndsAt: f.post.subscriptionEndsAt }))); });
    await f.run(); expect(f.client.createYouTubeInvitePost).not.toHaveBeenCalled(); expect(f.p.pending).toBeUndefined();
  });
  it('does not publish if safety is enabled during final closure lookup',async()=>{
    const f=fixture();let allowed=true;f.client.closePost.mockImplementation(async()=>{f.post.status='CLOSED';allowed=false;});
    await renewYouTubeInvites(f.client as InviteClient,{read:()=>f.s,write:()=>{},now:new Date('2026-10-27T05:00:00Z'),allowed:()=>allowed});
    expect(f.client.createYouTubeInvitePost).not.toHaveBeenCalled();expect(f.p.pending?.phase).toBe('closing');
  });
  it('rejects duplicate chain bindings and never enrolls a SHARE product', () => {
    const f = fixture(); expect(() => bindYouTubeRenewal({ version: 1, policies: {} }, { ...f.post, subscriptionType: 'SHARE' }, true)).toThrow();
    f.p.posts.push({ seq: 1, capacity: 5 }); expect(() => validateYouTubeRenewals(f.s)).toThrow();
  });
});
