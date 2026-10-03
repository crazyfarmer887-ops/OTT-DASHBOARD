import { describe, expect, test, vi } from 'vitest';
import {
  createNotionInvitationClient,
  createNotionSlotLedgerClient,
  createNotionSlotSummaryClient,
  calculateNotionSlotCapacity,
  formatNotionSlotSummary,
  occupiedNotionSlots,
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
    expect(await syncNotionBuyerEmails(deps)).toEqual({ created: 0, bound: 1, updated: 0, cancelled: 0, capacityBlocked: 0 });
    expect(bindRow).toHaveBeenCalledWith('manual', 'order-1');
    rows[0] = row('manual', 'buyer@example.com', false, 'order-1');
    expect(await syncNotionBuyerEmails(deps)).toEqual({ created: 0, bound: 0, updated: 0, cancelled: 0, capacityBlocked: 0 });
    expect(createRow).not.toHaveBeenCalled();
  });

  test('clears a premature Invited check while binding a manual row to its order', async () => {
    const manual = row('manual', 'buyer@example.com', true);
    const bindRow = vi.fn(async (id: string, dealUsid: string) => row(id, manual.email, false, dealUsid));
    expect(await syncNotionBuyerEmails({
      listRows: async () => [manual], getRow: async () => manual,
      createRow: vi.fn(), bindRow, updateRowEmail: vi.fn(), cancelRow: vi.fn(),
      listDeals: async () => [deal('order-1')], buyerEmails: async () => ['buyer@example.com'],
    })).toEqual({ created: 0, bound: 1, updated: 0, cancelled: 0, capacityBlocked: 0 });
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
    expect(await syncNotionBuyerEmails(deps)).toEqual({ created: 1, bound: 0, updated: 0, cancelled: 0, capacityBlocked: 0 });
    expect(await syncNotionBuyerEmails(deps)).toEqual({ created: 0, bound: 0, updated: 0, cancelled: 0, capacityBlocked: 0 });
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
    expect(result).toEqual({ created: 0, bound: 0, updated: 0, cancelled: 0, capacityBlocked: 0 });
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
    expect(result).toEqual({ created: 0, bound: 0, updated: 1, cancelled: 0, capacityBlocked: 0 });
    expect(updateRowEmail).toHaveBeenCalledExactlyOnceWith(original, 'new@example.com');
  });

  test('shows a blank line, down arrow, blank line and new-invite label while keeping only the latest address eligible', async () => {
    let page: any = { id: 'notion-row', properties: {
      'Customer email': { title: [{ text: { content: 'old@example.com' } }] },
      Invited: { checkbox: true }, 'Cancel waitlist': { checkbox: false },
      'Deal USID': { rich_text: [{ text: { content: 'order-1' } }] },
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
      cancelled: true, invited: false, cancelWaitlist: true });
    expect(requests[1].properties['Customer email'].title[2].annotations.strikethrough).toBe(true);
    expect(requests[1].properties['Customer email'].title.at(-1)).toEqual({
      text: { content: 'new@example.com' }, annotations: { strikethrough: true },
    });
    expect(requests[1].properties['Cancel waitlist']).toEqual({ checkbox: true });
    expect(requests[1].properties.Invited).toEqual({ checkbox: false });
    expect(resolveUniqueDeliveryMatches([{ ...struck, invited: true }], [deal('order-1')],
      new Map([['order-1', ['new@example.com']]])).size).toBe(0);
  });

  test('strikes an invited email and clears its checkbox after the order is cancelled', async () => {
    const invited = row('invited', 'buyer@example.com', true, 'order-1');
    const cancelRow = vi.fn(async (current: NotionInvitationRow) => ({
      ...current, email: '', emailHistory: [current.email], cancelled: true,
      invited: false, cancelWaitlist: true,
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

  test('appends a replacement below a manually struck email awaiting a new invitation', async () => {
    let page: any = { id: 'pending-row', properties: {
      'Customer email': { title: [{ text: { content: 'old@example.com' }, annotations: { strikethrough: true } }] },
      Invited: { checkbox: true }, 'Cancel waitlist': { checkbox: false },
      'Deal USID': { rich_text: [{ text: { content: 'order-1' } }] },
    } };
    const transport = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body));
        page = { ...page, properties: { ...page.properties, ...body.properties } };
      }
      return Response.json(page);
    }) as typeof fetch;
    const client = createNotionInvitationClient('token', 'data-source-id', transport);
    const pending = await client.getRow('pending-row');
    expect(pending).toMatchObject({ cancelled: true, cancelWaitlist: false,
      emailHistory: ['old@example.com'], invited: true });
    const replacement = await client.updateRowEmail(pending!, 'new@example.com');
    expect(replacement).toMatchObject({ email: 'new@example.com', invited: false,
      cancelled: false, newInviteMarked: true, emailHistory: ['old@example.com'] });
    const body = JSON.parse(String(transport.mock.calls[1][1]?.body));
    expect(body.properties['Customer email'].title.map((part: any) => part.text.content).join(''))
      .toBe('old@example.com\n\n↓\n\nnew@example.com (new invite)');
  });

  test('fills a pending replacement row when the buyer supplies one clear new email', async () => {
    const pending: NotionInvitationRow = { ...row('pending', '', false, 'order-1'),
      emailHistory: ['old@example.com'], cancelled: true, cancelWaitlist: false };
    const updateRowEmail = vi.fn(async (_current: NotionInvitationRow, email: string) => ({
      ...pending, email, cancelled: false, emailHistory: ['old@example.com'], newInviteMarked: true,
    }));
    expect(await syncNotionBuyerEmails({
      listRows: async () => [pending], getRow: async () => pending,
      createRow: vi.fn(), bindRow: vi.fn(), updateRowEmail, cancelRow: vi.fn(),
      listDeals: async () => [deal('order-1')], buyerEmails: async () => ['new@example.com'],
    })).toMatchObject({ updated: 1 });
    expect(updateRowEmail).toHaveBeenCalledExactlyOnceWith(pending, 'new@example.com');
  });

  test('does not reopen a row marked refund when another email appears', async () => {
    const refunded: NotionInvitationRow = { ...row('refunded', '', false, 'order-1'),
      emailHistory: ['old@example.com'], cancelled: true, cancelWaitlist: true };
    const updateRowEmail = vi.fn();
    expect(await syncNotionBuyerEmails({
      listRows: async () => [refunded], getRow: async () => refunded,
      createRow: vi.fn(), bindRow: vi.fn(), updateRowEmail, cancelRow: vi.fn(),
      listDeals: async () => [deal('order-1')], buyerEmails: async () => ['new@example.com'],
    })).toMatchObject({ updated: 0, created: 0 });
    expect(updateRowEmail).not.toHaveBeenCalled();
  });

  test('keeps a refund request in the cancel waitlist without striking its email or delivering it', async () => {
    const requested: NotionInvitationRow = { ...row('requested', 'buyer@example.com', true, 'order-1'),
      cancelWaitlist: true, cancelled: false, inviteRemoved: true };
    const updateRowEmail = vi.fn();
    const cancelRow = vi.fn(async (current: NotionInvitationRow) => ({
      ...current, email: '', emailHistory: [current.email], cancelled: true,
      invited: false, inviteRemoved: false,
    }));
    expect(occupiedNotionSlots([requested])).toBe(1);
    expect(resolveUniqueDeliveryMatches([requested], [deal('order-1')],
      new Map([['order-1', ['buyer@example.com']]])).size).toBe(0);
    expect(await syncNotionBuyerEmails({
      listRows: async () => [requested], getRow: async () => requested,
      createRow: vi.fn(), bindRow: vi.fn(), updateRowEmail, cancelRow,
      listDeals: async () => [deal('order-1')], buyerEmails: async () => ['changed@example.com'],
    })).toMatchObject({ updated: 0, created: 0 });
    expect(updateRowEmail).not.toHaveBeenCalled();
    expect(await syncNotionBuyerEmails({
      listRows: async () => [requested], getRow: async () => requested,
      createRow: vi.fn(), bindRow: vi.fn(), updateRowEmail, cancelRow,
      listDeals: async () => [{ ...deal('order-1'), dealStatus: 'CancelByInspectionRejection' }],
      buyerEmails: async () => ['buyer@example.com'],
    })).toMatchObject({ cancelled: 1 });
    expect(cancelRow).toHaveBeenCalledExactlyOnceWith(requested);
  });

  test('moves a previously struck cancelled row to the cancel waitlist and clears a stale check', async () => {
    const old: NotionInvitationRow = { ...row('old', '', true, 'order-1'),
      emailHistory: ['buyer@example.com'], cancelled: true, cancelWaitlist: false };
    const cancelRow = vi.fn(async () => ({ ...old, invited: false, cancelWaitlist: true }));
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
      cancelWaitlist: true, invited: false,
    }));
    const createRow = vi.fn(async (email: string, dealUsid: string, cancelled = false) => ({
      ...row('new', cancelled ? '' : email, false, dealUsid),
      emailHistory: cancelled ? [email] : [], cancelled, cancelWaitlist: cancelled,
    }));
    const cancellation = (id: string) => ({ ...deal(id), dealStatus: 'CancelByInspectionRejection' });
    const result = await syncNotionBuyerEmails({
      listRows: async () => [existing], getRow: async () => existing,
      createRow, bindRow: vi.fn(), updateRowEmail: vi.fn(), cancelRow,
      listDeals: async () => [cancellation('order-1'), cancellation('order-2')],
      buyerEmails: async (room: string) => room === 'order-2' ? ['second@example.com'] : [],
    });
    expect(result).toEqual({ created: 1, bound: 0, updated: 0, cancelled: 2, capacityBlocked: 0 });
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
    expect(result).toEqual({ created: 0, bound: 0, updated: 0, cancelled: 0, capacityBlocked: 0 });
    expect(cancelRow).not.toHaveBeenCalled();
    expect(createRow).not.toHaveBeenCalled();
  });

  test('counts paid capacity from dated Notion ledger entries and rejects incomplete adjustments', async () => {
    const entries = [
      { change: 60, reason: '9월 26일 초기 등록 / 결제 확인', effectiveDate: '2026-09-26' },
      { change: 10, reason: '10월 1일 10자리 추가 / 결제 완료', effectiveDate: '2026-10-01' },
      { change: -5, reason: '10월 2일 계정 회수 / vendor 확인', effectiveDate: '2026-10-02' },
    ];
    expect(calculateNotionSlotCapacity(entries, '2026-09-26')).toBe(60);
    expect(calculateNotionSlotCapacity(entries, '2026-10-01')).toBe(70);
    expect(calculateNotionSlotCapacity(entries, '2026-10-02')).toBe(65);
    expect(() => calculateNotionSlotCapacity([...entries, { change: 3, reason: '', effectiveDate: '2026-10-03' }], '2026-10-03'))
      .toThrow('entry invalid');
    const transport = vi.fn(async () => Response.json({ results: entries.map((entry, index) => ({
      id: `ledger-${index}`, properties: {
        'Change / reason': { title: [{ plain_text: entry.reason }] },
        'Slot change': { number: entry.change },
        'Effective date': { date: { start: entry.effectiveDate } },
      },
    })), has_more: false })) as typeof fetch;
    expect(await createNotionSlotLedgerClient('token', 'ledger-id', transport).readSlotCapacity('2026-10-01')).toBe(70);
  });

  test('shows available and occupied slots and only updates a changed Notion summary', async () => {
    expect(formatNotionSlotSummary(60, 36)).toBe('Available slots: 24  |  Current slots: 36/60');
    expect(formatNotionSlotSummary(60, 61)).toBe('Available slots: 0  |  Current slots: 61/60');
    expect(() => formatNotionSlotSummary(-1, 0)).toThrow('counts invalid');
    const blockId = 'summary-block';
    let block: any = { id: blockId, type: 'paragraph', paragraph: {
      rich_text: [{ plain_text: 'Available slots: 24  |  Current slots: 36/60' }],
    } };
    const transport = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body));
        block = { ...block, paragraph: { rich_text: body.paragraph.rich_text } };
      }
      return Response.json(block);
    }) as typeof fetch;
    const client = createNotionSlotSummaryClient('token', blockId, transport);
    expect(await client.update(60, 36)).toBe(false);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(await client.update(60, 37)).toBe(true);
    expect(transport.mock.calls[2][1]?.method).toBe('PATCH');
    expect(JSON.parse(String(transport.mock.calls[2][1]?.body))).toEqual({ paragraph: {
      rich_text: [{ text: { content: 'Available slots: 23  |  Current slots: 37/60' } }],
    } });
    expect(await client.update(60, 37)).toBe(false);
    expect(transport).toHaveBeenCalledTimes(4);
  });

  test('does not write a slot summary when the Notion block is unavailable or invalid', async () => {
    const missing = vi.fn(async () => new Response('', { status: 404 })) as typeof fetch;
    await expect(createNotionSlotSummaryClient('token', 'block', missing).update(60, 36))
      .rejects.toThrow('read failed: HTTP 404');
    const wrongBlock = vi.fn(async () => Response.json({ id: 'block', type: 'heading_1' })) as typeof fetch;
    await expect(createNotionSlotSummaryClient('token', 'block', wrongBlock).update(60, 36))
      .rejects.toThrow('block invalid');
    expect(wrongBlock).toHaveBeenCalledTimes(1);
  });

  test('blocks new buyer rows at capacity but permits a replacement in an existing row', async () => {
    const rows = [row('occupied', 'old@example.com', true, 'order-1')];
    const createRow = vi.fn();
    const updateRowEmail = vi.fn(async (current: NotionInvitationRow, email: string) => ({
      ...current, email, emailHistory: [current.email], invited: false, cancelled: false,
    }));
    const result = await syncNotionBuyerEmails({
      listRows: async () => [...rows], readSlotCapacity: async () => 1,
      getRow: async () => rows[0], createRow, bindRow: vi.fn(), updateRowEmail, cancelRow: vi.fn(),
      listDeals: async () => [deal('order-1'), deal('order-2')],
      buyerEmails: async (room: string) => room === 'order-1' ? ['new@example.com'] : ['buyer@example.com'],
    });
    expect(result).toMatchObject({ updated: 1, created: 0, capacityBlocked: 1 });
    expect(updateRowEmail).toHaveBeenCalledOnce();
    expect(createRow).not.toHaveBeenCalled();
  });

  test('refunds release a place only after invite removal is confirmed; missing ledger blocks creation', async () => {
    const refunded: NotionInvitationRow = { ...row('refund', '', false, 'old-order'),
      emailHistory: ['old@example.com'], cancelled: true, cancelWaitlist: true, inviteRemoved: false };
    const rows = [refunded];
    const createRow = vi.fn(async (email: string, dealUsid: string) => {
      const created = row('new', email, false, dealUsid);
      rows.push(created);
      return created;
    });
    const deps = {
      listRows: async () => [...rows], readSlotCapacity: async (): Promise<number | null> => 1,
      getRow: async () => null, createRow, bindRow: vi.fn(), updateRowEmail: vi.fn(), cancelRow: vi.fn(),
      listDeals: async () => [deal('new-order')], buyerEmails: async () => ['buyer@example.com'],
    };
    expect(occupiedNotionSlots(rows)).toBe(1);
    expect((await syncNotionBuyerEmails(deps)).capacityBlocked).toBe(1);
    refunded.inviteRemoved = true;
    expect(occupiedNotionSlots(rows)).toBe(0);
    expect((await syncNotionBuyerEmails(deps)).created).toBe(1);
    expect(createRow).toHaveBeenCalledOnce();
    rows.pop();
    expect((await syncNotionBuyerEmails({ ...deps, readSlotCapacity: async () => null })).capacityBlocked).toBe(1);
    expect(createRow).toHaveBeenCalledOnce();
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
