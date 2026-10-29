// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Router } from 'wouter';
import BottomNav from '../src/web/components/bottom-nav';
import { dashboardWorkspaceHome, dashboardWorkspaceRedirect, getDashboardWorkspace, getGraytagAccountId, setDashboardWorkspace, setGraytagAccountId } from '../src/web/lib/dashboard-workspace';

beforeEach(() => {
  const values = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    clear: () => values.clear(),
  } });
});
afterEach(() => { window.localStorage.clear(); document.body.innerHTML = ''; });

describe('dashboard workspace selection', () => {
  test('migrates the existing YouTube preference and retains GButs after reopening the preference', () => {
    window.localStorage.setItem('aio.graytagAccount', 'youtube-invite-sales');
    expect(getDashboardWorkspace()).toBe('youtube-invite-sales');
    setDashboardWorkspace('gbuts');
    expect(getDashboardWorkspace()).toBe('gbuts');
    expect(getGraytagAccountId()).toBe('primary');
    expect(window.localStorage.getItem('aio.graytagAccount')).toBe('youtube-invite-sales');
    setGraytagAccountId('youtube-invite-sales');
    expect(getDashboardWorkspace()).toBe('youtube-invite-sales');
    expect(getGraytagAccountId()).toBe('youtube-invite-sales');
  });

  test('renders the new selector and only GButs operations, with both previous account choices available', () => {
    setDashboardWorkspace('gbuts');
    document.body.innerHTML = renderToStaticMarkup(<Router ssrPath="/gbuts-sales"><BottomNav /></Router>);
    const select = document.querySelector('select')!;
    expect(select.value).toBe('gbuts');
    expect(Array.from(select.options, option => option.text)).toEqual(['기본 GrayTag 계정', '그레이태그 2호기', '유튜브 판매 전용', '벗츠 전용', '링키드 전용']);
    const text = Array.from(document.querySelectorAll('button'), button => button.textContent?.trim());
    expect(text).toContain('벗츠 홈');
    expect(text).toContain('OTT 판매글 작성');
    expect(text).toContain('주문·전달 관리');
    expect(text).toContain('Spotify 초대');
    expect(text).not.toContain('유튜브 초대');
    expect(text).not.toContain('글 작성');
    setDashboardWorkspace('primary');
    document.body.innerHTML = renderToStaticMarkup(<Router ssrPath="/"><BottomNav /></Router>);
    expect(document.body.textContent).toContain('글 작성');
  });

  test('keeps unsupported dashboard pages out of GButs mode and preserves public buyer access', () => {
    expect(dashboardWorkspaceHome('gbuts')).toBe('/gbuts');
    expect(dashboardWorkspaceHome('primary')).toBe('/');
    expect(dashboardWorkspaceHome('youtube-invite-sales')).toBe('/youtube-invites');
    for (const path of ['/', '/manage', '/chat', '/write', '/profit', '/youtube-invites']) {
      expect(dashboardWorkspaceRedirect('gbuts', path)).toBe('/gbuts');
      expect(dashboardWorkspaceRedirect('primary', path)).toBeNull();
    }
    for (const path of ['/gbuts', '/gbuts-sales', '/gbuts-accounts', '/gbuts-orders', '/spotify-invites', '/access/buyer-token', '/dashboard/access/buyer-token']) {
      expect(dashboardWorkspaceRedirect('gbuts', path)).toBeNull();
    }
  });
  test('isolates Linkid navigation and preserves the GrayTag preference', () => {
    setGraytagAccountId('youtube-invite-sales'); setDashboardWorkspace('linkid');
    expect(getDashboardWorkspace()).toBe('linkid'); expect(getGraytagAccountId()).toBe('primary');
    expect(window.localStorage.getItem('aio.graytagAccount')).toBe('youtube-invite-sales');
    expect(dashboardWorkspaceHome('linkid')).toBe('/linkid');
    expect(dashboardWorkspaceRedirect('gbuts', '/linkid')).toBeNull();
    expect(dashboardWorkspaceRedirect('linkid', '/manage')).toBe('/linkid');
    expect(dashboardWorkspaceRedirect('linkid', '/linkid')).toBeNull();
    expect(dashboardWorkspaceRedirect('linkid', '/access/buyer')).toBeNull();
    document.body.innerHTML = renderToStaticMarkup(<Router ssrPath="/linkid"><BottomNav /></Router>);
    expect(document.body.textContent).toContain('링키드 판매·채팅');
    expect(document.body.textContent).not.toContain('OTT 판매글 작성');
  });

});

test('retains the separate second GrayTag workspace',()=>{setGraytagAccountId('secondary');expect(getDashboardWorkspace()).toBe('secondary');expect(getGraytagAccountId()).toBe('secondary');expect(dashboardWorkspaceHome('secondary')).toBe('/');});
