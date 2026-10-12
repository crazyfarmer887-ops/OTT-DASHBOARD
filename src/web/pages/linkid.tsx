import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ExternalLink, RefreshCw, Bell, Users, MessageCircle } from 'lucide-react';
import type { LinkidSnapshot, LinkidProfile } from '../../lib/linkid-client';

type Account = { id: string; label: string; enabled: boolean; connectedAt: string; profiles: LinkidProfile[];
  snapshots: Record<string, LinkidSnapshot>; lastSuccess?: string; lastError?: string; retryAfter?: number;
  pendingAlerts: number; profileErrors?: Record<string, string> };
type Overview = { enabled: boolean; accounts: Account[]; syncing: boolean; intervalSeconds: number };
const card = { background: '#fff', border: '1px solid #EDE9FE', borderRadius: 16, padding: 18 };
const button = { border: 0, borderRadius: 10, background: '#7C3AED', color: '#fff', padding: '10px 14px', fontFamily: 'inherit', fontWeight: 800, cursor: 'pointer' };
const secondary = { ...button, background: '#F3F0FF', color: '#6D28D9' };
const field = { width: '100%', padding: 11, border: '1px solid #DDD6FE', borderRadius: 9, font: 'inherit', boxSizing: 'border-box' as const };
function displayedEndDate(exclusive: string): string {
  const date = Date.parse(`${exclusive.slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(date) ? new Date(date - 86400000).toISOString().slice(0, 10) : exclusive;
}
function date(value?: string): string { return value ? new Date(value).toLocaleString('ko-KR') : '아직 확인 전'; }
function PartyLink({ partyId, children }: { partyId: number; children: ReactNode }) {
  return <a href={`https://linkid.pw/myparty/${partyId}`} target="_blank" rel="noreferrer" style={{ color: '#6D28D9' }}>{children} <ExternalLink size={12} /></a>;
}
export default function LinkidPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [accountId, setAccountId] = useState(() => new URLSearchParams(window.location.search).get('account') || '');
  const [profileIndex, setProfileIndex] = useState(() => Number(new URLSearchParams(window.location.search).get('profile')) || 1);
  const [selectedRoom, setSelectedRoom] = useState('');
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [label, setLabel] = useState(''); const [cookies, setCookies] = useState('');
  const account = data?.accounts.find(x => x.id === accountId) || data?.accounts[0];
  const profile = account?.profiles.find(x => x.index === profileIndex) || account?.profiles[0];
  const snapshot = profile && account?.snapshots[String(profile.index)];
  const room = snapshot?.rooms.find(x => `${account?.id}:${profile?.index}:${x.id}` === selectedRoom);
  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch('/api/linkid', { cache: 'no-store', signal }); const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || '링키드를 불러오지 못했습니다.');
      setData(result); setError('');
    } catch (e) { if (!(e instanceof DOMException && e.name === 'AbortError')) setError(e instanceof Error ? e.message : '조회 실패'); }
  }, []);
  useEffect(() => {
    const controller = new AbortController(); void load(controller.signal);
    const interval = window.setInterval(() => { void load(controller.signal); }, 10000);
    return () => { controller.abort(); window.clearInterval(interval); };
  }, [load]);
  const mutate = async (path: string, body: unknown, method = 'POST') => {
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/linkid${path}`, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const result = await response.json(); if (!response.ok || !result.ok) throw new Error(result.error || '처리하지 못했습니다.');
      if (path === '/connect') { setCookies(''); setLabel(''); setAccountId(result.accountId); setProfileIndex(1); }
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : '요청 실패'); }
    finally { setBusy(false); }
  };
  return <main style={{ maxWidth: 1060, margin: 'auto', padding: 20, color: '#1E1B4B' }}>
    <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
      <h1 style={{ fontSize: 24 }}>링키드 판매·채팅</h1>
      <button style={button} disabled={busy || data?.syncing || !account} onClick={() => mutate('/sync', { accountId: account?.id })}>
        <RefreshCw size={14} /> {data?.syncing ? '조회 중' : '새로고침'}
      </button>
    </header>
    <p style={{ fontSize: 13, lineHeight: 1.6 }}>로그인 계정별 프로필을 선택해 판매 파티와 1:1 채팅을 확인하세요. 새 알림은 계정·프로필 이름과 함께 텔레그램으로 전달됩니다.</p>
    {error && <p role="alert" style={{ ...card, color: '#B91C1C' }}>{error}</p>}
    {data && !data.enabled && <p role="alert" style={card}>링키드 자동 감시가 꺼져 있습니다.</p>}
    <details style={{ ...card, marginBottom: 18 }} open={data?.accounts.length === 0}>
      <summary style={{ fontWeight: 800, cursor: 'pointer' }}>로그인 계정 연결·추가</summary>
      <p style={{ fontSize: 13, lineHeight: 1.7 }}>링키드에 로그인한 후 Cookie-Editor에서 해당 사이트의 쿠키를 JSON으로 내보내 아래에 붙여넣으세요. 계정 하나를 연결하면 최대 5개 프로필을 함께 확인합니다.</p>
      <form onSubmit={event => { event.preventDefault(); void mutate('/connect', { label, cookies }); }}>
        <label>계정 이름<input style={{ ...field, margin: '8px 0 12px' }} value={label} onChange={e => setLabel(e.target.value)} placeholder="예: 링키드 1호기" maxLength={80} autoComplete="off" /></label>
        <label>링키드 연결 정보<textarea style={{ ...field, margin: '8px 0 12px' }} rows={3} value={cookies} onChange={e => setCookies(e.target.value)} placeholder="링키드 쿠키 JSON" autoComplete="off" spellCheck={false} /></label>
        <button style={button} disabled={busy || !cookies.trim()}>{busy ? '연결 확인 중' : '연결하기'}</button>
      </form>
      <p style={{ fontSize: 11, color: '#6B7280' }}>서버용 로그인 세션으로 연결합니다. 연결 정보는 화면에 다시 표시하지 않습니다.</p>
    </details>
    {account && <>
      <section style={{ ...card, marginBottom: 16 }} aria-label="링키드 로그인 계정">
        <label style={{ fontWeight: 800 }}>로그인 계정<select aria-label="링키드 로그인 계정" style={{ ...field, margin: '8px 0' }} value={account.id} onChange={e => { setAccountId(e.target.value); setProfileIndex(1); setSelectedRoom(''); }}>
          {data?.accounts.map(x => <option key={x.id} value={x.id}>{x.label}</option>)}
        </select></label>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', fontSize: 12 }}>
          <span><Bell size={13} /> 텔레그램 감시: {data?.enabled && account.enabled ? '켜짐' : '꺼짐'} · {data?.intervalSeconds}초마다 순차 확인</span>
          <button style={secondary} disabled={busy} onClick={() => mutate(`/accounts/${account.id}`, { enabled: !account.enabled }, 'PUT')}>{account.enabled ? '이 계정 감시 끄기' : '이 계정 감시 켜기'}</button>
        </div>
        <p style={{ fontSize: 12, color: '#6B7280' }}>파티·채팅이 많으면 확인이 더 걸릴 수 있습니다. 전체 프로필 최근 확인: {date(account.lastSuccess)} · 알림 전송 대기 {account.pendingAlerts}건</p>
        {account.lastError && <p role="alert" style={{ color: '#B91C1C', fontSize: 13 }}>{account.lastError}</p>}
      </section>
      <section aria-label="링키드 서브 프로필" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 18 }}>
        {account.profiles.map(p => {
          const s = account.snapshots[String(p.index)];
          return <button key={p.index} aria-pressed={p.index === profile?.index} onClick={() => { setProfileIndex(p.index); setSelectedRoom(''); }} style={{ ...card, cursor: 'pointer', textAlign: 'left', font: 'inherit', borderColor: p.index === profile?.index ? '#7C3AED' : '#EDE9FE', background: p.index === profile?.index ? '#F5F3FF' : '#fff' }}>
            <strong style={{ display: 'block', fontSize: 14 }}>{p.index}. {p.name}</strong>
            <p style={{ fontSize: 12 }}>판매 파티 {s?.parties.filter(x => x.owner).length ?? '—'} · 채팅방 {s?.rooms.length ?? '—'}</p>
            <span style={{ fontSize: 11, color: '#6B7280' }}>보유 머니 {p.money.toLocaleString()}원</span>
          </button>;
        })}
      </section>
      {profile && <h2 style={{ fontSize: 19 }}><Users size={18} /> 프로필 {profile.index} · {profile.name}</h2>}
      {profile && account.profileErrors?.[String(profile.index)] && <p role="alert" style={{ ...card, color: '#B91C1C' }}>{account.profileErrors[String(profile.index)]}</p>}
      {!snapshot && <p style={card}>이 프로필의 파티와 채팅을 확인하고 있습니다. 잠시 후 자동으로 표시됩니다.</p>}
      {snapshot && <>
        <p style={{ fontSize: 11, color: '#6B7280' }}>프로필 최근 확인: {date(snapshot.updatedAt)} · 원본 사이트에서는 같은 프로필을 선택해주세요.</p>
        <section style={{ ...card, marginBottom: 18 }} aria-label="링키드 파티 현황">
          <h3 style={{ marginTop: 0 }}>파티 현황</h3>
          {!snapshot.parties.length && <p>현재 이용 중인 파티가 없습니다.</p>}
          {snapshot.parties.map(p => <article key={p.id} style={{ padding: '14px 0', borderTop: '1px solid #EDE9FE', fontSize: 13 }}>
            <strong>{p.service}</strong> · {p.owner ? '판매 파티장' : '이용 파티원'} · 파티 #{p.id}
            <p>{p.startDate} ~ {displayedEndDate(p.endDate)} · 구성원 {p.members}/{p.capacity}명 (파티장 포함)</p>
            <p>파티원: {p.participants.filter(x => x.uid !== profile?.uid).map(x => x.name).join(', ') || '아직 없음'}</p>
            <PartyLink partyId={p.id}>파티 관리·모집</PartyLink>
          </article>)}
          <a href="https://linkid.pw/party" target="_blank" rel="noreferrer" style={{ color: '#6D28D9', fontSize: 13 }}>링키드에서 새 판매 파티 개설 <ExternalLink size={12} /></a>
        </section>
        <section style={{ ...card, marginBottom: 18 }} aria-label="링키드 1대1 채팅">
          <h3 style={{ marginTop: 0 }}><MessageCircle size={16} /> 1:1 채팅</h3>
          {!snapshot.rooms.length && <p style={{ fontSize: 13 }}>아직 생성된 1:1 채팅방이 없습니다.</p>}
          {snapshot.rooms.map(r => <button key={r.id} style={{ ...secondary, display: 'block', width: '100%', textAlign: 'left', marginBottom: 8 }} onClick={() => setSelectedRoom(`${account.id}:${profile?.index}:${r.id}`)}>
            {r.name} · 파티 #{r.partyId} <span style={{ fontWeight: 400, fontSize: 12 }}>{r.messages[0]?.date}</span>
          </button>)}
          {room && <div style={{ marginTop: 16 }}>
            <PartyLink partyId={room.partyId}>링키드에서 채팅 답장</PartyLink>
            <p style={{ fontSize: 11, color: '#6B7280' }}>파티 화면의 ‘채팅’에서 {room.name}님을 선택해주세요. 최근 대화 최대 100개를 표시합니다.</p>
            {[...room.messages].reverse().map(m => <div key={m.id} style={{ margin: '8px 0', padding: 12, borderRadius: 10, background: m.writer === profile?.uid ? '#F3F0FF' : '#F9FAFB', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 13 }}>
              <strong>{m.writer === profile?.uid ? '나' : m.writer <= 0 ? '시스템' : room.name}</strong><small style={{ display: 'block', color: '#6B7280', margin: '5px 0' }}>{m.date}</small>{m.text}
            </div>)}
          </div>}
        </section>
        <section style={card} aria-label="링키드 알림">
          <h3 style={{ marginTop: 0 }}><Bell size={16} /> 링키드 알림</h3>
          {!snapshot.notices.length && <p style={{ fontSize: 13 }}>도착한 알림이 없습니다.</p>}
          {snapshot.notices.slice(0, 100).map(n => <div key={n.id} style={{ padding: '12px 0', borderTop: '1px solid #EDE9FE', fontSize: 13 }}>
            <strong>{n.title}</strong><p style={{ color: '#6B7280', fontSize: 12 }}>{n.date}</p>{n.partyId > 0 && <PartyLink partyId={n.partyId}>해당 파티 보기</PartyLink>}
          </div>)}
        </section>
      </>}
    </>}
  </main>;
}
