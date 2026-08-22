import { describe, expect, test, vi } from 'vitest';
import { buildPartyAccessPublicPayload, createPartyAccessLinkRecord } from '../src/lib/party-access';
import { loadPartyAccessStoreForPublicView } from '../src/lib/party-access-public-view';

describe('party access public view loading', () => {
  test('keeps live refresh enabled by default for non-fill records', async () => {
    const localStore = { local: true };
    const refreshedStore = { refreshed: true };
    const refresh = vi.fn(async () => refreshedStore);

    const loadedStore = await loadPartyAccessStoreForPublicView({
      localStore,
      isFillRecord: false,
      liveRefreshSetting: undefined,
      refresh,
    });

    expect(refresh).toHaveBeenCalledOnce();
    expect(loadedStore).toBe(refreshedStore);
  });

  test('keeps the fill-record local fast path even when live refresh is enabled', async () => {
    const localStore = { fill: true };
    const refresh = vi.fn(async () => ({}));

    const loadedStore = await loadPartyAccessStoreForPublicView({
      localStore,
      isFillRecord: true,
      liveRefreshSetting: 'true',
      refresh,
    });

    expect(refresh).not.toHaveBeenCalled();
    expect(loadedStore).toBe(localStore);
  });

  test('disabled live refresh returns the valid local payload without invoking the live fetch', async () => {
    const record = createPartyAccessLinkRecord({
      token: 'local-public-view-token',
      now: '2026-08-22T00:00:00.000Z',
      serviceType: '넷플릭스',
      accountEmail: 'local@example.com',
      fallbackPassword: 'local-password',
      profileName: '사과',
      member: {
        kind: 'graytag',
        memberId: 'deal-local',
        memberName: '구매자',
        status: 'Using',
        endDateTime: '2026-11-22',
      },
    });
    const localStore = { [record.tokenHash]: record };
    const refresh = vi.fn(async () => ({}));

    const loadedStore = await loadPartyAccessStoreForPublicView({
      localStore,
      isFillRecord: false,
      liveRefreshSetting: 'false',
      refresh,
    });
    const payload = buildPartyAccessPublicPayload(
      loadedStore[record.tokenHash],
      {},
      {},
      '2026-08-22T00:01:00.000Z',
      loadedStore,
    );

    expect(refresh).not.toHaveBeenCalled();
    expect(loadedStore).toBe(localStore);
    expect(payload.ok).toBe(true);
    expect(payload.credentials).toMatchObject({
      id: 'local@example.com',
      password: 'local-password',
    });
  });
});
