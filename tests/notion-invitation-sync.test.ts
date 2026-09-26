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
      updateRowEmail: vi.fn(), cancelRow: vi.fn(),
      listDeals: async () => [deal('order-1')],
      buyerEmails: async () => ['buyer@example.com'],
    };
    expect(await syncNotionBuyerEmails(deps)).toEqual({ created: 0, bound: 1, updated: 0, cancelled: 0 });
    expect(bindRow).toHaveBeenCalledWith('manual', 'order-1');
    rows[0] = row('manual', 'buyer@example.com', false, 'order-1');
    expect(await syncNotionBuyerEmails(deps)).toEqual({ created: 0, bound: 0, updated: 0, cancelled: 0 });
    expect(createRow).not.toHaveBeenCalled();
  });

  test('clears a premature Invited check while binding a manual row to its order', async () => {
    const manual = row('manual', 'buyer@example.com', true);
    const bindRow = vi.fn(async (id: string, dealUsid: string) => row(id, manual.email, false, dealUsid));
    expect(await syncNotionBuyerEmails({
      listRows: async () => [manual], getRow: async () => manual,
      createRow: vi.fn(), bindRow, updateRowEmail: vi.fn(), cancelRow: vi.fn(),
      listDeals: async () => [deal('order-1')], buyerEmails: async () => ['buyer@example.com'],
    })).toEqual({ created: 0, bound: 1, updated: 0, cancelled: 0 });
    expect(bindRow).toHaveBeenCalledExactlyOnceWith('manual', 'order-1');
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
      bindRow: vi.fn(), updateRowEmail: vi.fn(), cancelRow: vi.fn(), listDeals: async () => [deal('order-1'), deal('order-2')],
      buyerEmails: async (room: string) => room === 'order-1' ? ['buyer@example.com'] : ['a@example.com', 'b@example.com'],
    };
    expect(await syncNotionBuyerEmails(deps)).toEqual({ created: 1, bound: 0, updated: 0, cancelled: 0 });
    expect(await syncNotionBuyerEmails(deps)).toEqual({ created: 0, bound: 0, updated: 0, cancelled: 0 });
    expect(createRow).toHaveBeenCalledTimes(1);
  });

  test('does not bind a manual email when two open orders claim it', async () => {
    const bindRow = vi.fn();
    const createRow = vi.fn();
    const result = await syncNotionBuyerEmails({
      listRows: async () => [row('manual', 'same@example.com')], getRow: async () => null, bindRow, createRow,
      updateRowEmail: vi.fn(), cancelRow: vi.fn(),
      listDeals: async () => [deal('one'), deal('two')], buyerEmails: async () => ['same@example.com'],
    });
    expect(result).toEqual({ created: 0, bound: 0, updated: 0, cancelled: 0 });
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

  test('replaces a corrected email on the same order and clears an earlier Invited check', async () => {
    const rows = [row('r1', 'old@example.com', true, 'order-1')];
    const original = rows[0];
    const updateRowEmail = vi.fn(async (current: NotionInvitationRow, email: string) => ({
      ...row(current.id, email, false, 'order-1'), emailHistory: [current.email], cancelled: false,
    }));
    const result = await syncNotionBuyerEmails({
      listRows: async () => rows,
      getRow: async () => rows[0], createRow: vi.fn(), bindRow: vi.fn(), updateRowEmail, cancelRow: vi.fn(),
      listDeals: async () => [deal('order-1')], buyerEmails: async () => ['new@example.com'],
    });
    expect(result).toEqual({ created: 0, bound: 0, updated: 1, cancelled: 0 });
    expect(updateRowEmail).toHaveBeenCalledExactlyOnceWith(original, 'new@example.com');
  });

  test('shows a blank line, down arrow, blank line and new-invite label while keeping only the latest address eligible', async () => {
    let page: any = { id: 'notion-row', properties: {
      'Customer email': { title: [{ text: { content: 'old@example.com' } }] },
      Invited: { checkbox: true }, 'Deal USID': { rich_text: [{ text: { content: 'order-1' } }] },
    } };
    const requests: any[] = [];
    const transport = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body));
        requests.push(body);
        page = { ...page, properties: { ...page.properties, ...body.properties } };
      }
      return Response.json(page);
    }) as typeof fetch;
    const client = createNotionInvitationClient('token', 'data-source-id', transport);
    const old = await client.getRow('notion-row');
    expect(old?.email).toBe('old@example.com');
    const changed = await client.updateRowEmail(old!, 'new@example.com');
    expect(requests[0].properties['Customer email'].title).toEqual([
      { text: { content: 'old@example.com' }, annotations: { strikethrough: true } },
      { text: { content: '\n\n↓\n\n' } },
      { text: { content: 'new@example.com' }, annotations: { strikethrough: false } },
      { text: { content: ' (new invite)' } },
    ]);
    expect(changed).toMatchObject({ email: 'new@example.com', emailHistory: ['old@example.com'],
      cancelled: false, invited: false, newInviteMarked: true });
    page.properties['Customer email'].title = [
      page.properties['Customer email'].title[0],
      { text: { content: '\n\n↓\n\nnew@example.com (new invite)' }, annotations: { strikethrough: false } },
    ];
    expect(await client.getRow('notion-row')).toMatchObject({ email: 'new@example.com', emailHistory: ['old@example.com'] });
    page.properties['Customer email'].title[1].text.content = ' → new@example.com';
    expect(await client.getRow('notion-row')).toMatchObject({ email: 'new@example.com', emailHistory: ['old@example.com'] });
    expect(resolveUniqueDeliveryMatches([{ ...changed, invited: true }], [deal('order-1')],
      new Map([['order-1', ['old@example.com']]])).size).toBe(0);
    expect(resolveUniqueDeliveryMatches([{ ...changed, invited: true }], [deal('order-1')],
      new Map([['order-1', ['new@example.com']]])).size).toBe(1);
    page.properties.Invited = { checkbox: true };
    const struck = await client.cancelRow({ ...changed, invited: true });
    expect(struck).toMatchObject({ email: '', emailHistory: ['old@example.com', 'new@example.com'],
      cancelled: true, invited: false, refundMarked: true });
    expect(requests[1].properties['Customer email'].title[2].annotations.strikethrough).toBe(true);
    expect(requests[1].properties['Customer email'].title.at(-1)).toEqual({ text: { content: ' (refund)' } });
    expect(requests[1].properties.Invited).toEqual({ checkbox: false });
    expect(resolveUniqueDeliveryMatches([{ ...struck, invited: true }], [deal('order-1')],
      new Map([['order-1', ['new@example.com']]])).size).toBe(0);
  });

  test('strikes an invited email and clears its checkbox after the order is cancelled', async () => {
    const invited = row('invited', 'buyer@example.com', true, 'order-1');
    const cancelRow = vi.fn(async (current: NotionInvitationRow) => ({
      ...current, email: '', emailHistory: [current.email], cancelled: true,
      invited: false, refundMarked: true,
    }));
    const result = await syncNotionBuyerEmails({
      listRows: async () => [invited], getRow: async () => invited,
      createRow: vi.fn(), bindRow: vi.fn(), updateRowEmail: vi.fn(), cancelRow,
      listDeals: async () => [{ ...deal('order-1'), dealStatus: 'CancelByInspectionRejection' }],
      buyerEmails: async () => null,
    });
    expect(result).toMatchObject({ cancelled: 1 });
    expect(cancelRow).toHaveBeenCalledExactlyOnceWith(invited);
  });

  test('adds the refund label to a previously struck cancelled row and clears a stale check', async () => {
    const old: NotionInvitationRow = { ...row('old', '', true, 'order-1'),
      emailHistory: ['buyer@example.com'], cancelled: true, refundMarked: false };
    const cancelRow = vi.fn(async () => ({ ...old, invited: false, refundMarked: true }));
    expect(await syncNotionBuyerEmails({
      listRows: async () => [old], getRow: async () => old,
      createRow: vi.fn(), bindRow: vi.fn(), updateRowEmail: vi.fn(), cancelRow,
      listDeals: async () => [{ ...deal('order-1'), dealStatus: 'CancelByInspectionRejection' }],
      buyerEmails: async () => null,
    })).toMatchObject({ cancelled: 1 });
    expect(cancelRow).toHaveBeenCalledExactlyOnceWith(old);
  });

  test('strikes an uninvited address after cancellation and creates a struck row if cancellation came first', async () => {
    const existing = row('existing', 'old@example.com', false, 'order-1');
    const cancelRow = vi.fn(async (current: NotionInvitationRow) => ({
      ...current, email: '', emailHistory: [current.email], cancelled: true,
      refundMarked: true, invited: false,
    }));
    const createRow = vi.fn(async (email: string, dealUsid: string, cancelled = false) => ({
      ...row('new', cancelled ? '' : email, false, dealUsid),
      emailHistory: cancelled ? [email] : [], cancelled, refundMarked: cancelled,
    }));
    const cancellation = (id: string) => ({ ...deal(id), dealStatus: 'CancelByInspectionRejection' });
    const result = await syncNotionBuyerEmails({
      listRows: async () => [existing], getRow: async () => existing,
      createRow, bindRow: vi.fn(), updateRowEmail: vi.fn(), cancelRow,
      listDeals: async () => [cancellation('order-1'), cancellation('order-2')],
      buyerEmails: async (room: string) => room === 'order-2' ? ['second@example.com'] : [],
    });
    expect(result).toEqual({ created: 1, bound: 0, updated: 0, cancelled: 2 });
    expect(cancelRow).toHaveBeenCalledExactlyOnceWith(existing);
    expect(createRow).toHaveBeenCalledExactlyOnceWith('second@example.com', 'order-2', true);
  });

  test('does not create a refund row when the cancelled chat has no clear email', async () => {
    const cancelRow = vi.fn();
    const createRow = vi.fn();
    const result = await syncNotionBuyerEmails({
      listRows: async () => [], getRow: async () => null,
      createRow, bindRow: vi.fn(), updateRowEmail: vi.fn(), cancelRow,
      listDeals: async () => [
        { ...deal('order-2'), dealStatus: 'CancelByNoShow' },
      ],
      buyerEmails: async () => null,
    });
    expect(result).toEqual({ created: 0, bound: 0, updated: 0, cancelled: 0 });
    expect(cancelRow).not.toHaveBeenCalled();
    expect(createRow).not.toHaveBeenCalled();
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
    await client.bindRow('notion-row', 'order-1');
    expect(requests[2].body.properties.Invited).toEqual({ checkbox: false });
  });
});
