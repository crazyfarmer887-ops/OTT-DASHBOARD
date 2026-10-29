import { useEffect, useRef, useState } from 'react';
import { useLocation, useSearch } from 'wouter';
import { Home, BarChart2, PenLine, LayoutGrid, User, Calculator, MessageCircle, Settings2, Info, Menu, X, RefreshCw, Youtube, Users, Music2, ArrowUpRight } from 'lucide-react';
import { dashboardWorkspaceHome, getDashboardWorkspace, setDashboardWorkspace, type DashboardWorkspace } from '../lib/dashboard-workspace';

const navGroups = [
  { label: '워크스페이스', items: [{ path: '/', label: '홈', Icon: Home }] },
  { label: '판매 · 운영', items: [
    { path: '/manage', label: '관리', Icon: LayoutGrid },
    { path: '/write', label: '글 작성', Icon: PenLine },
    { path: '/edit-price', label: '게시물', Icon: Settings2 },
    { path: '/chat', label: '채팅', Icon: MessageCircle },
    { path: '/renewals', label: '연장 관리', Icon: RefreshCw },
    { path: '/party-info', label: '파티정보', Icon: Info },
  ] },
  { label: '서비스 연결', items: [
    { path: '/linkid', label: '링키드', Icon: Users },
    { path: '/everyview', label: '에브리뷰', Icon: Users },
    { path: '/youtube-invites', label: '유튜브 초대', Icon: Youtube },
    { path: '/spotify-invites', label: 'Spotify 초대', Icon: Music2 },
    { path: '/gbuts-sales', label: '벗츠 판매 연결', Icon: LayoutGrid },
  ] },
  { label: '수익 · 설정', items: [
    { path: '/profit', label: '수익', Icon: Calculator },
    { path: '/price', label: '가격', Icon: BarChart2 },
    { path: '/my', label: '내계정', Icon: User },
  ] },
];

export default function BottomNav() {
  const [location, navigate] = useLocation(); const search = useSearch();
  const [open, setOpen] = useState(false);
  const [workspace, setWorkspace] = useState<DashboardWorkspace>(() => getDashboardWorkspace());
  const sidebar = useRef<HTMLElement>(null); const menuButton = useRef<HTMLButtonElement>(null);
  const visibleGroups = workspace === 'linkid'
    ? [{ label: '링키드 운영', items: [{ path: '/linkid', label: '링키드 판매·채팅', Icon: Users }] }]
    : workspace === 'gbuts' ? [{ label: '벗츠 운영', items: [
      { path: '/gbuts', label: '벗츠 홈', Icon: Home },
      { path: '/gbuts-accounts', label: '계정 관리', Icon: LayoutGrid },
      { path: '/gbuts-sales', label: 'OTT 판매글 작성', Icon: PenLine },
      { path: '/gbuts-sales?service=스포티파이', label: '스포티파이 판매글', Icon: Music2 },
      { path: '/gbuts-orders', label: '주문·전달 관리', Icon: LayoutGrid },
      { path: '/spotify-invites', label: 'Spotify 초대', Icon: Users },
    ] }] : navGroups;
  const isActive = (path: string) => {
    const [base, query] = path.split('?');
    if (base === '/gbuts-sales') return location === base && (new URLSearchParams(search).get('service') === '스포티파이') === Boolean(query);
    return location === base || (base !== '/' && location.startsWith(`${base}/`));
  };
  const currentTab = visibleGroups.flatMap(group => group.items).find(tab => isActive(tab.path));
  const close = () => { setOpen(false); menuButton.current?.focus(); };
  useEffect(() => {
    if (!open) return;
    const first = sidebar.current?.querySelector<HTMLButtonElement>('nav button'); first?.focus();
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpen(false); menuButton.current?.focus(); }
      if (event.key === 'Tab') {
        const items = [...(sidebar.current?.querySelectorAll<HTMLElement>('button, a[href]') || [])];
        if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items[items.length - 1]?.focus(); }
        else if (!event.shiftKey && document.activeElement === items[items.length - 1]) { event.preventDefault(); items[0]?.focus(); }
      }
    };
    window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler);
  }, [open]);
  useEffect(() => {
    setOpen(false);
    if (location === '/linkid') { setWorkspace('linkid'); setDashboardWorkspace('linkid'); }
  }, [location, search]);
  return <>
    <header className="dashboard-topbar">
      <button ref={menuButton} className="dashboard-menu-toggle" aria-label={open ? '메뉴 닫기' : '메뉴 열기'} aria-expanded={open} aria-controls="dashboard-sidebar" onClick={() => setOpen(value => !value)}><Menu size={20} /></button>
      <div className="dashboard-breadcrumb"><span>운영 대시보드</span><span className="dashboard-slash">/</span><strong>{currentTab?.label || '판매 · 관리'}</strong></div>
      <label className="dashboard-workspace-select"><span>사용 계정</span><select aria-label="대시보드 사용 계정" value={workspace} onChange={event => {
        const value = event.target.value;
        const next: DashboardWorkspace = value === 'secondary' || value === 'gbuts' || value === 'linkid' || value === 'youtube-invite-sales' ? value : 'primary';
        setWorkspace(next); setDashboardWorkspace(next);
        if (workspace === 'gbuts' || next === 'gbuts' || workspace === 'linkid' || next === 'linkid') window.location.assign(`/dashboard${dashboardWorkspaceHome(next)}`);
        else window.location.reload();
      }}>
        <option value="primary">기본 GrayTag 계정</option><option value="secondary">그레이태그 2호기</option><option value="youtube-invite-sales">유튜브 판매 전용</option><option value="gbuts">벗츠 전용</option><option value="linkid">링키드 전용</option>
      </select></label>
    </header>
    {open && <button className="dashboard-nav-backdrop" aria-label="메뉴 배경 닫기" onClick={close} />}
    <aside ref={sidebar} id="dashboard-sidebar" className={`dashboard-sidebar${open ? ' is-open' : ''}`}>
      <div className="dashboard-brand"><a href="/dashboard"><span className="dashboard-logo">j.</span><span>잠깐구독<small>OPERATIONS DASHBOARD</small></span></a><button className="dashboard-menu-close" aria-label="메뉴 닫기" onClick={close}><X size={18} /></button></div>
      <div className="dashboard-sidebar-caption">판매 · 계정 · 자동화</div>
      <nav aria-label="대시보드 메뉴">{visibleGroups.map(group => <div className="dashboard-nav-group" key={group.label}>
        <p>{group.label}</p>{group.items.map(({ path, label, Icon }) => <button key={path} className={isActive(path) ? 'is-active' : ''} aria-current={isActive(path) ? 'page' : undefined} onClick={() => { navigate(path); setOpen(false); }}><Icon size={17} strokeWidth={1.7} /><span>{label}</span>{isActive(path) && <span className="dashboard-nav-dot" />}</button>)}
      </div>)}</nav>
      <div className="dashboard-sidebar-footer"><a href="/dashboard/finance">수익 대시보드<ArrowUpRight size={15} /></a><small>잠깐구독 워크스페이스</small></div>
    </aside>
  </>;
}
