import { describe, expect, test, vi } from 'vitest';
import { syncYouTubeBuyerGuides, type GuideJournal } from '../src/scheduler/youtube-buyer-guide';
import type { NotionDeliveryDeal } from '../src/scheduler/notion-invitation-sync';

const deal = (id: string): NotionDeliveryDeal => ({
  dealUsid: id, chatRoomUuid: `room-${id}`, dealStatus: 'Delivering',
  productTypeString: '유튜브', productName: '광고X ✅ 음악 ✅',
});

describe('YouTube buyer guide', () => {
  test('baselines existing orders and sends once for a future order with no provider timestamp', async () => {
    let current = [deal('existing')];
    let journal: GuideJournal | null = null;
    const sendGuide = vi.fn(async () => true);
    const deps = {
      listDeals: async () => current,
      buyerEmails: async () => [],
      validateChat: async () => {}, sendGuide,
      readJournal: () => journal,
      writeJournal: (value: GuideJournal) => { journal = structuredClone(value); },
    };
    expect(await syncYouTubeBuyerGuides(deps)).toMatchObject({ baselined: 1, sent: 0 });
    current = [deal('existing'), deal('new')];
    expect(await syncYouTubeBuyerGuides(deps)).toMatchObject({ sent: 1, attempted: 1 });
    expect(await syncYouTubeBuyerGuides(deps)).toMatchObject({ sent: 0, attempted: 0 });
    expect(sendGuide).toHaveBeenCalledExactlyOnceWith(deal('new'));
  });

  test('does not initialize on a failed listing or retry an uncertain send', async () => {
    let current: NotionDeliveryDeal[] | null = null;
    let journal: GuideJournal | null = null;
    const sendGuide = vi.fn(async () => { throw new Error('timeout'); });
    const deps = {
      listDeals: async () => current,
      buyerEmails: async () => [],
      validateChat: async () => {}, sendGuide,
      readJournal: () => journal,
      writeJournal: (value: GuideJournal) => { journal = structuredClone(value); },
    };
    await expect(syncYouTubeBuyerGuides(deps)).rejects.toThrow('unavailable');
    expect(journal).toBeNull();
    current = [deal('old')];
    await syncYouTubeBuyerGuides(deps);
    current = [deal('old'), deal('new')];
    expect(await syncYouTubeBuyerGuides(deps)).toMatchObject({ attempted: 1, sent: 0 });
    expect(await syncYouTubeBuyerGuides(deps)).toMatchObject({ attempted: 0 });
    expect(sendGuide).toHaveBeenCalledTimes(1);
    expect(journal?.records.new.state).toBe('attempted');
  });

  test('waits when chat cannot be read and skips an order whose buyer already supplied an email', async () => {
    let journal: GuideJournal | null = { version: 1, records: {} };
    const buyerEmails = vi.fn(async () => null as string[] | null);
    const sendGuide = vi.fn(async () => true);
    const deps = {
      listDeals: async () => [deal('new')], buyerEmails,
      validateChat: async () => {}, sendGuide,
      readJournal: () => journal,
      writeJournal: (value: GuideJournal) => { journal = structuredClone(value); },
    };
    expect(await syncYouTubeBuyerGuides(deps)).toMatchObject({ attempted: 0 });
    buyerEmails.mockImplementation(async () => ['buyer@example.com']);
    expect(await syncYouTubeBuyerGuides(deps)).toMatchObject({ skipped: 1 });
    expect(sendGuide).not.toHaveBeenCalled();
  });
});
