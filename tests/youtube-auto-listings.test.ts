import { describe, expect, test, vi } from 'vitest';
import {
  emptyYouTubeAutoListingState,
  enqueueYouTubeAutoListingManager,
  syncYouTubeAutoListings,
  type YouTubeAutoListingState,
} from '../src/scheduler/youtube-auto-listings';

const now = new Date('2026-09-28T03:00:00.000Z');
const guide = '기존 유튜브 초대 안내';
const oldListing = (id: string) => ({
  dealStatus: 'OnSale', productTypeString: '유튜브', productUsid: id,
  productName: '광고X ✅ 음악 ✅', sellingGuide: guide,
});
const group = (label: string, email = `${label}@gmail.com`) => ({
  id: `group-${label}`, label, managerEmail: email, subscriptionEndDate: '2027-09-27',
  sellableSeats: 5, enabled: true, createdAt: now.toISOString(), updatedAt: now.toISOString(),
});

function harness() {
  let clock = now;
  let state = emptyYouTubeAutoListingState();
  let onSale: Record<string, unknown>[] = [oldListing('old-1'), oldListing('old-2')];
  let available = 23;
  const sold = new Set(['old-1', 'old-2']);
  const groups = [group('13호기', 'manager13@gmail.com')];
  const createdGroups: Array<{ label: string; managerEmail: string; subscriptionEndDate: string; sellableSeats: number }> = [];
  const published: Array<{ familyGroupId: string; endDate: string; price: number; name: string; sellingGuide: string; idempotencyKey: string }> = [];
  const deps = {
    now: () => clock,
    makeId: () => 'batch-1',
    readState: () => structuredClone(state),
    writeState: (next: YouTubeAutoListingState) => { state = structuredClone(next); },
    readNotionSlots: async () => ({ available }),
    listGroups: async () => structuredClone(groups),
    listSellerProducts: async () => ({ authoritative: true, rows: structuredClone(onSale) }),
    listProductStatuses: async () => ({ authoritative: true, rows: [...sold].map((productUsid) => ({ productUsid, status: 'Using' })) }),
    createGroup: vi.fn(async (input: typeof createdGroups[number]) => {
      createdGroups.push(input);
      const created = { ...group(input.label, input.managerEmail),
        id: 'new-group', subscriptionEndDate: input.subscriptionEndDate };
      groups.push(created);
      return created;
    }),
    registerProduct: vi.fn(async (input: typeof published[number]) => {
      published.push(input);
      const productUsid = `new-${published.length}`;
      onSale.push(oldListing(productUsid));
      return { status: 'registered' as const, productUsid };
    }),
  };
  return {
    deps, createdGroups, published,
    get state() { return state; },
    setOnSale(value: Record<string, unknown>[]) { onSale = value; },
    setAvailable(value: number) { available = value; },
    setNow(value: Date) { clock = value; },
    setSold(id: string, value: boolean) { if (value) sold.add(id); else sold.delete(id); },
    queue(email: string) { state = enqueueYouTubeAutoListingManager(state, email, groups, now); },
  };
}

describe('automatic YouTube listing replenishment', () => {
  test('keeps the existing listing template but waits while any listing is still for sale', async () => {
    const h = harness();
    h.queue('next.manager@gmail.com');
    const result = await syncYouTubeAutoListings(h.deps);
    expect(result.reason).toBe('existing_listings_for_sale');
    expect(h.state.template).toEqual({ name: '광고X ✅ 음악 ✅', sellingGuide: guide });
    expect(h.createdGroups).toHaveLength(0);
    expect(h.published).toHaveLength(0);
  });

  test('after sellout, creates the next numbered five-seat group and five posts at 150 won per day', async () => {
    const h = harness();
    h.queue('next.manager@gmail.com');
    await syncYouTubeAutoListings(h.deps);
    h.setOnSale([]);
    const result = await syncYouTubeAutoListings(h.deps);
    expect(result).toMatchObject({ createdGroup: true, registered: 5, reason: 'batch_completed' });
    expect(h.createdGroups).toEqual([{ label: '14호기', managerEmail: 'next.manager@gmail.com',
      subscriptionEndDate: '2027-09-28', sellableSeats: 5 }]);
    expect(h.published).toHaveLength(5);
    expect(h.published.every((post) => post.familyGroupId === 'new-group'
      && post.endDate === '20270928T2359' && post.price === 54_750
      && post.name === '광고X ✅ 음악 ✅' && post.sellingGuide === guide)).toBe(true);
    expect(new Set(h.published.map((post) => post.idempotencyKey)).size).toBe(5);
    expect(h.state.queue).toHaveLength(0);
    expect(h.state.lastBatch?.productUsids).toHaveLength(5);
    expect((await syncYouTubeAutoListings(h.deps)).registered).toBe(0);
  });

  test('does not allocate a group when fewer than five Notion seats remain', async () => {
    const h = harness();
    h.queue('next.manager@gmail.com');
    await syncYouTubeAutoListings(h.deps);
    h.setOnSale([]);
    h.setAvailable(4);
    expect((await syncYouTubeAutoListings(h.deps)).reason).toBe('notion_slots_below_five');
    expect(h.createdGroups).toHaveLength(0);
  });

  test('waits if a previous post vanished without verified sale', async () => {
    const h = harness();
    h.queue('next.manager@gmail.com');
    await syncYouTubeAutoListings(h.deps);
    h.setOnSale([]);
    h.setSold('old-2', false);
    expect((await syncYouTubeAutoListings(h.deps)).reason).toBe('sale_unconfirmed');
    expect(h.createdGroups).toHaveLength(0);
  });

  test('resumes an interrupted batch with the same group and product keys', async () => {
    const h = harness();
    h.queue('next.manager@gmail.com');
    await syncYouTubeAutoListings(h.deps);
    h.setOnSale([]);
    let calls = 0;
    const original = h.deps.registerProduct;
    h.deps.registerProduct = vi.fn(async (input) => {
      calls += 1;
      if (calls === 3) throw new Error('uncertain network');
      return original(input);
    });
    expect((await syncYouTubeAutoListings(h.deps)).registered).toBe(2);
    expect(h.state.batch?.productUsids).toHaveLength(2);
    expect(h.state.queue).toHaveLength(1);
    h.setNow(new Date('2026-09-29T03:00:00.000Z'));
    h.deps.registerProduct = original;
    expect((await syncYouTubeAutoListings(h.deps)).registered).toBe(3);
    expect(h.createdGroups).toHaveLength(1);
    expect(h.published).toHaveLength(5);
    expect(h.published.every((post) => post.price === 54_750)).toBe(true);
  });

  test('rejects duplicate manager accounts and refuses an ambiguous existing template', async () => {
    const h = harness();
    expect(() => h.queue('manager13@gmail.com')).toThrow(/already|duplicate/i);
    h.queue('next.manager@gmail.com');
    h.setOnSale([oldListing('old-1'), { ...oldListing('old-2'), sellingGuide: '다른 안내' }]);
    expect((await syncYouTubeAutoListings(h.deps)).reason).toBe('ambiguous_template');
    h.setOnSale([]);
    expect((await syncYouTubeAutoListings(h.deps)).reason).toBe('sale_unconfirmed');
    expect(h.createdGroups).toHaveLength(0);
  });
});
