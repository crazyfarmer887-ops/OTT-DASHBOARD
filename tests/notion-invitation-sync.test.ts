import { describe, expect, test, vi } from 'vitest';
import {
  createNotionInvitationClient,
  resolveUniqueDeliveryMatches,
  syncNotionBuyerEmails,
  syncNotionInvitationDeliveries,
  type NotionInvitationRow,
  type NotionDeliveryDeal,
} from '../src/scheduler/notion-invitation-sync';

const deal = (id: string, room = id): NotionDeliveryDeal => ({
  dealUsid: id, chatRoomUuid: room, dealStatus: 'Delivering',
  productTypeString: '유튜브', productName: '광고X ✅ 음악 ✅',
});
const row = (id: string, email: string, invited = false, dealUsid = ''): NotionInvitationRow => ({
  id, email, invited, dealUsid,
});

describe('Notion invitation synchronization', () => {
  test('records a buyer email once and binds an existing manual row', async () => {
    const rows = [row('manual', 'buyer@example.com')];
    const createRow = vi.fn(async (email: string, dealUsid: string) => row('created', email, false, dealUsid));
    const bindRow = vi.fn(async (id: string, dealUsid: string) => row(id, 'buyer@example.com', false, dealUsid));
    const deps = {
      listRows: async () => [...rows], getRow: async () => rows[0], createRow, bindRow,
      listDeals: async () => [deal('order-1')],
      buyerEmails: async () => ['buyer@example.com'],
    };
    expect(await syncNotionBuyerEmails(deps)).toEqual({ created: 0, bound: 1 });
    expect(bindRow).toHaveBeenCalledWith('manual', 'order-1');
    rows[0] = row('manual', 'buyer@example.com', false, 'order-1');
    expect(await syncNotionBuyerEmails(deps)).toEqual({ created: 0, bound: 0 });
    expect(createRow).not.toHaveBeenCalled();
  });

  test('creates one row for an unrepresented order and ignores ambiguous buyer emails', async () => {
    const rows: NotionInvitationRow[] = [];
    const createRow = vi.fn(async (email: string, dealUsid: string) => {
      const added = row('created', email, false, dealUsid);
      rows.push(added);
      return added;
    });
    const deps = {
      listRows: async () => [...rows], getRow: async () => null, createRow,
      bindRow: vi.fn(), listDeals: async () => [deal('order-1'), deal('order-2')],
      buyerEmails: async (room: string) => room === 'order-1' ? ['buyer@example.com'] : ['a@example.com', 'b@example.com'],
    };
    expect(await syncNotionBuyerEmails(deps)).toEqual({ created: 1, bound: 0 });
    expect(await syncNotionBuyerEmails(deps)).toEqual({ created: 0, bound: 0 });
    expect(createRow).toHaveBeenCalledTimes(1);
  });

  test('does not bind a manual email when two open orders claim it', async () => {
    const bindRow = vi.fn();
    const createRow = vi.fn();
    const result = await syncNotionBuyerEmails({
      listRows: async () => [row('manual', 'same@example.com')], getRow: async () => null, bindRow, createRow,
      listDeals: async () => [deal('one'), deal('two')], buyerEmails: async () => ['same@example.com'],
    });
    expect(result).toEqual({ created: 0, bound: 0 });
    expect(bindRow).not.toHaveBeenCalled();
    expect(createRow).not.toHaveBeenCalled();
  });

  test('uses the order ID to distinguish two purchases with one email', () => {
    const matches = resolveUniqueDeliveryMatches(
      [row('a', 'same@example.com', true, 'one'), row('b', 'same@example.com', true, 'two')],
      [deal('one'), deal('two')],
      new Map([['one', ['same@example.com']], ['two', ['same@example.com']]]),
    );
    expect(matches.get('a')?.dealUsid).toBe('one');
    expect(matches.get('b')?.dealUsid).toBe('two');
  });

  test('rechecks the checkbox and journals before finishing, then never retries an uncertain finish', async () => {
    let live = row('r1', 'buyer@example.com', true, 'order-1');
    let journal: any = { version: 1, records: {} };
    const finishDelivery = vi.fn(async () => { throw new Error('timeout'); });
    const deps = {
      listCheckedRows: async () => [row('r1', 'buyer@example.com', true, 'order-1')],
      getRow: async () => live,
      listDeals: async () => [deal('order-1')],
      buyerEmails: async () => ['buyer@example.com'],
      providerStatus: async () => 'Delivering', finishDelivery,
      readJournal: () => journal,
      writeJournal: (value: any) => { journal = structuredClone(value); },
    };
    live = row('r1', 'buyer@example.com', false, 'order-1');
    expect((await syncNotionInvitationDeliveries(deps)).attempted).toBe(0);
    expect(finishDelivery).not.toHaveBeenCalled();
    live = row('r1', 'buyer@example.com', true, 'order-1');
    expect((await syncNotionInvitationDeliveries(deps)).attempted).toBe(1);
    expect(journal.records.r1.state).toBe('attempted');
    expect((await syncNotionInvitationDeliveries(deps)).attempted).toBe(0);
    expect(finishDelivery).toHaveBeenCalledTimes(1);
  });

  test('uses Notion data source query and creates a page with the order ID unchecked', async () => {
    const requests: Array<{ url: string; body: any }> = [];
    const transport = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      requests.push({ url, body });
      if (url.endsWith('/query')) return Response.json({ results: [], has_more: false });
      return Response.json({ id: 'notion-row', properties: {
        'Customer email': { title: [{ plain_text: 'buyer@example.com' }] },
        Invited: { checkbox: false }, 'Deal USID': { rich_text: [{ plain_text: 'order-1' }] },
      } });
    }) as typeof fetch;
    const client = createNotionInvitationClient('token', 'data-source-id', transport);
    expect(await client.listRows()).toEqual([]);
    expect(await client.createRow('buyer@example.com', 'order-1')).toMatchObject({
      email: 'buyer@example.com', invited: false, dealUsid: 'order-1',
    });
    expect(requests[0].url).toContain('/v1/data_sources/data-source-id/query');
    expect(requests[1].body).toMatchObject({
      parent: { type: 'data_source_id', data_source_id: 'data-source-id' },
      properties: { Invited: { checkbox: false }, 'Deal USID': { rich_text: [{ text: { content: 'order-1' } }] } },
    });
  });
});
