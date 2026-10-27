import { describe, it, expect, vi } from 'vitest';
import { FAMILY_MANAGER, FAMILY_SEED, canonicalGoogleEmail, collectFamilyOrders, runFamilyInvites, type FamilyJournal, type FamilyView, type InviteOrder } from '../src/monitoring/gbuts-google-invites';
import { googleCookieImport, membershipBenefitsDate } from '../src/monitoring/google-family-steel';
import { createGbutsOttSellerClient } from '../src/lib/gbuts-ott-client';
import type { YouTubeRenewalStore } from '../src/scheduler/gbuts-youtube-renewal';
const now = () => new Date('2026-10-27T08:00:00Z');
function setup() {
  const journal: FamilyJournal = { version: 1, enabled: true, target: FAMILY_MANAGER, seedPostSeq: FAMILY_SEED, orders: {} };
  const order: InviteOrder = { key: '18864:50180', email: 'buyer@gmail.com', endDate: '2026-11-26' };
  let view: FamilyView = { manager: FAMILY_MANAGER, members: [], remaining: 5, subscribed: true, benefitsThrough: '2026-11-26' };
  const save = vi.fn(), allowed = vi.fn(() => true), scan = vi.fn(async () => [order]), inspect = vi.fn(async () => view);
  const invite = vi.fn(async (email: string, before: () => Promise<void>) => { await before(); view = { ...view, members: [email], remaining: 4 }; });
  return { journal, order, save, allowed, scan, driver: { inspect, invite }, now, setView: (value: Partial<FamilyView>) => { view = { ...view, ...value }; } };
}
describe('verified paid buyer invitation transaction', () => {
  it('persists an attempt before sending and confirms one recipient only', async () => {
    const f = setup();
    f.driver.invite.mockImplementation(async (email, before) => {
      expect(f.journal.orders[f.order.key]).toBeUndefined(); await before();
      expect(f.save).toHaveBeenCalled(); expect(f.journal.orders[f.order.key].state).toBe('attempted');
      f.setView({ members: [email], remaining: 4 });
    });
    expect(await runFamilyInvites(f)).toMatchObject({ sent: 1, state: 'invited' });
    expect(f.journal.orders[f.order.key].state).toBe('confirmed');
    expect(f.scan).toHaveBeenCalledTimes(2);
  });
  it('does not replay an uncertain send even when Google cannot find it', async () => {
    const f = setup(); f.driver.invite.mockImplementation(async (_, before) => { await before(); throw Error('NETWORK'); });
    await expect(runFamilyInvites(f)).rejects.toThrow('NETWORK');
    await expect(runFamilyInvites(f)).rejects.toThrow('INVITATION_UNCERTAIN');
    expect(f.driver.invite).toHaveBeenCalledTimes(1);
  });
  it('recovers an uncertain transaction by observing the exact Google recipient', async () => {
    const f = setup(); f.journal.orders[f.order.key] = { email: f.order.email!, state: 'attempted', updatedAt: now().toISOString() };
    f.setView({ members: ['b.u.yer+tag@googlemail.com'], remaining: 4 });
    expect(await runFamilyInvites(f)).toMatchObject({ adopted: 1, sent: 0 });
    expect(f.journal.orders[f.order.key].state).toBe('confirmed'); expect(f.driver.invite).not.toHaveBeenCalled();
  });
  it('adopts an already joined recipient without sending', async () => {
    const f = setup(); f.setView({ members: ['buyer@gmail.com'], remaining: 4 });
    expect(await runFamilyInvites(f)).toMatchObject({ adopted: 1, sent: 0 });
    expect(f.journal.orders[f.order.key].state).toBe('observed_existing');
  });
  it.each(['cancelled', 'different-email', 'safety'])('blocks a %s change detected immediately before sending', async mode => {
    const f = setup();
    if (mode === 'cancelled') f.scan.mockResolvedValueOnce([f.order]).mockResolvedValueOnce([]);
    if (mode === 'different-email') f.scan.mockResolvedValueOnce([f.order]).mockResolvedValueOnce([{ ...f.order, email: 'other@gmail.com' }]);
    if (mode === 'safety') f.allowed.mockReturnValueOnce(true).mockReturnValue(false);
    await expect(runFamilyInvites(f)).rejects.toThrow(); expect(f.save).not.toHaveBeenCalled();
  });
  it('does not click send when durable reservation fails', async () => {
    const f = setup(), click = vi.fn(); f.save.mockImplementation(() => { throw Error('DISK'); });
    f.driver.invite.mockImplementation(async (_, before) => { await before(); click(); });
    await expect(runFamilyInvites(f)).rejects.toThrow('DISK'); expect(click).not.toHaveBeenCalled();
  });
  it.each([{ remaining: 0, members: ['1@a.com', '2@a.com', '3@a.com', '4@a.com', '5@a.com'] }, { manager: 'other@gmail.com' }, { subscribed: false }, { benefitsThrough: '2026-11-25' }])('blocks a wrong/full/expired family', async change => {
    const f = setup(); f.setView(change); await expect(runFamilyInvites(f)).rejects.toThrow(); expect(f.driver.invite).not.toHaveBeenCalled();
  });
  it('refuses changed recipients on a recorded order', async () => {
    const f = setup(); f.journal.orders[f.order.key] = { email: 'old@gmail.com', state: 'confirmed', updatedAt: now().toISOString() };
    await expect(runFamilyInvites(f)).rejects.toThrow('BUYER_EMAIL_CHANGED');
  });
  it('prevents Gmail alias reuse on another order', async () => {
    const f = setup(); f.journal.orders['18864:1'] = { email: 'b.u.yer+old@googlemail.com', state: 'confirmed', updatedAt: now().toISOString() };
    await expect(runFamilyInvites(f)).rejects.toThrow('RECIPIENT_ALREADY_RESERVED');
  });
  it('does not send in check-only mode, or inspect Google for unchanged orders', async () => {
    const f = setup(); expect(await runFamilyInvites({ ...f, checkOnly: true })).toMatchObject({ state: 'checked', sent: 0 });
    expect(f.save).not.toHaveBeenCalled(); expect(f.driver.invite).not.toHaveBeenCalled();
    f.journal.orders[f.order.key] = { email: f.order.email!, state: 'observed_existing', updatedAt: now().toISOString() };
    f.driver.inspect.mockClear(); expect(await runFamilyInvites(f)).toMatchObject({ state: 'idle' }); expect(f.driver.inspect).not.toHaveBeenCalled();
  });
  it('sends at most one of multiple paid requests per run', async () => {
    const f = setup(); f.scan.mockResolvedValue([f.order, { ...f.order, key: '18864:50181', email: 'second@gmail.com' }]);
    expect(await runFamilyInvites(f)).toMatchObject({ sent: 1 }); expect(f.driver.invite).toHaveBeenCalledTimes(1);
  });
});
describe('live GButs order intake boundaries', () => {
  function fixture() {
    const client = createGbutsOttSellerClient('private-test-token');
    const policy = { seedPostSeq: FAMILY_SEED, currentPostSeq: 18864, capacity: 5, categorySeq: 7, subscriptionType: 'INVITE', endDate: '2026-11-26', enabled: true, trigger: 'rank', rankThreshold: 5, nextAt: now().toISOString(), posts: [{ seq: 18864, capacity: 5 }], members: {} };
    const policies = { version: 1, policies: { [FAMILY_SEED]: policy } } as YouTubeRenewalStore;
    client.sellerAccountSeq = vi.fn(async () => 1);
    client.getPost = vi.fn(async seq => ({ seq, seller: { seq: 1 }, category1: { seq: 7 }, subscriptionType: 'INVITE', subscriptionEndsAt: '2026-11-26 23:59:59', memberLimit: 5, memberCount: 1, status: 'ON_SALE' }));
    client.listOttMembers = vi.fn(async () => [{ seq: 5, userSeq: 2, productId: 'paid', nickname: 'buyer', status: 'APPLY', cancelStatus: null, createdAt: '2026-10-27 12:00:00', subscriptionEndsAt: '2026-11-26 23:59:59' }]);
    client.openPrivateRoom = vi.fn(async () => 'ROOM');
    const message = (message: string, senderSeq = 2, createdAt = '2026-10-27 13:00:00') => ({ message, senderSeq, messageType: 'TEXT', createdAt });
    client.getChat = vi.fn(async () => ({ roomId: 'ROOM', members: [{ seq: 1 }, { seq: 2 }], messages: [message('buyer@gmail.com'), message('seller@gmail.com', 1)] }));
    return { client, policies, message };
  }
  it('takes email only from the actual buyer, ignoring seller/account emails', async () => {
    const f = fixture(); expect(await collectFamilyOrders(f.client, f.policies, now())).toEqual([{ key: '18864:5', email: 'buyer@gmail.com', conflict: false, endDate: '2026-11-26' }]);
  });
  it.each(['REFUNDED', 'REFUND_REQUESTED'])('excludes a %s order', async cancelStatus => {
    const f = fixture(), rows = await f.client.listOttMembers(18864); rows[0].cancelStatus = cancelStatus;
    f.client.listOttMembers = vi.fn(async () => rows); f.client.getPost = vi.fn(async seq => ({ ...(await fixture().client.getPost(seq)), memberCount: 0 }));
    expect(await collectFamilyOrders(f.client, f.policies, now())).toEqual([]); expect(f.client.openPrivateRoom).not.toHaveBeenCalled();
  });
  it('blocks ambiguous or later cancelled email requests', async () => {
    const f = fixture(); f.client.getChat = vi.fn(async () => ({ roomId: 'ROOM', members: [{ seq: 1 }, { seq: 2 }], messages: [f.message('buyer@gmail.com'), f.message('초대 보내지 마세요', 2, '2026-10-27 14:00:00')] }));
    expect((await collectFamilyOrders(f.client, f.policies, now()))[0].conflict).toBe(true);
  });
  it('fails closed on wrong seller, room, unknown chain or uncertain rank transaction', async () => {
    const f = fixture(); f.client.sellerAccountSeq = vi.fn(async () => 99); await expect(collectFamilyOrders(f.client, f.policies, now())).rejects.toThrow('POST_BINDING');
    await expect(collectFamilyOrders(fixture().client, { version: 1, policies: {} }, now())).rejects.toThrow('CHAIN_BINDING');
    const g = fixture(); g.client.getChat = vi.fn(async () => ({ roomId: 'ROOM', members: [{ seq: 1 }], messages: [] })); await expect(collectFamilyOrders(g.client, g.policies, now())).rejects.toThrow('ROOM_BINDING');
  });
});
describe('cloud authentication and membership parsing', () => {
  it('preserves cookie domains and refuses unrelated imports', () => {
    expect(googleCookieImport([{ name: 'test', value: 'private', domain: '.google.com', path: '/', sameSite: 'no_restriction', expirationDate: 1800000000 }])[0]).toMatchObject({ domain: '.google.com', sameSite: 'None', expires: 1800000000 });
    expect(() => googleCookieImport([{ name: 'test', value: 'private', domain: '.evil.com', path: '/' }])).toThrow();
  });
  it('takes the earlier visible benefit date and requires family membership', () => {
    expect(membershipBenefitsDate('Langganan keluarga: CA$22,99/bln\nWaktu akhir manfaat: 27 Nov\nWaktu berakhir manfaat: 26 Nov', now())).toBe('2026-11-26');
    expect(membershipBenefitsDate('Benefits end: Nov 27\nFamily membership: CA$22.99/month', now())).toBe('2026-11-27');
    expect(membershipBenefitsDate('Benefits end: Nov 27', now())).toBeUndefined();
    expect(canonicalGoogleEmail('B.u.yer+tag@googlemail.com')).toBe('buyer@gmail.com');
  });
});
