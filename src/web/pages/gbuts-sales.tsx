import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useSearch } from 'wouter';
import { RefreshCw, ExternalLink, ShoppingBag } from 'lucide-react';
import { makeDefaultProductTitle } from '../../lib/write-default-template';

import { makeGbutsOttDescription } from '../../lib/gbuts-ott-templates';

type Account = { key: string; serviceType: string; accountEmail: string; total: number; graytag: number; manual: number; gbuts: number; claims: number; available: number; overbooked: boolean; endDate: string; suggestedDailyPrice: number | null };
type Listing = { id: string; postSeq?: number; serviceType: string; accountEmail: string; capacity: number; dailyPrice: number; endDate: string; state: string; error?: string };
type Order = { key: string; name: string; listingId: string; profileName?: string; profileNumber?: number; profileReleasedAt?: string; endDate: string; delivery: string; status: string; cancelStatus: string | null; accessUrl?: string; error?: string };
type Data = { enabled: boolean; accounts: Account[]; listings: Listing[]; orders: Order[]; unlinked: { seq: number }[]; lastSuccess: string | null; lastError: string | null; inventory?: { status: string; updatedAt: string } | null };
const styles = { card: { background: '#fff', border: '1px solid #EDE9FE', borderRadius: 16, padding: 16, marginBottom: 14 },
  input: { display: 'block', width: '100%', padding: 10, border: '1px solid #DDD6FE', borderRadius: 9, marginTop: 5, boxSizing: 'border-box' as const, fontFamily: 'inherit' },
  button: { border: 0, borderRadius: 10, padding: '11px 14px', background: '#7C3AED', color: '#fff', fontWeight: 800, cursor: 'pointer' } };
const labels: Record<string, string> = { submitting: '등록 확인 중', registered: '판매 연결됨', uncertain: '등록 결과 확인 필요', failed: '등록 실패', closed: '모집 종료', ready: '자동 전달 대기', attempted: '발송 확인 중', confirmed: '전달 완료', blocked: '전달 보류' };
export default function GbutsSalesPage({ view = 'sales' }: { view?: 'sales' | 'orders' }) {
  const [, navigate] = useLocation(); const [data, setData] = useState<Data | null>(null);
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(false); const [busy, setBusy] = useState(false); const [message, setMessage] = useState('');
  const [key, setKey] = useState(''); const [endDate, setEndDate] = useState(''); const [price, setPrice] = useState(''); const [count, setCount] = useState('1');
  const [title, setTitle] = useState(''); const [description, setDescription] = useState(''); const requestId = useRef(crypto.randomUUID());
  const query = new URLSearchParams(useSearch());
  const requestedService = query.get('service') || '';
  const requestedAccount = query.get('account') || '';
  const selectionRequest = `${requestedService}:${requestedAccount}`;
  const previousService = useRef(selectionRequest);
  const account = data?.accounts.find(x => x.key === key && (!requestedService || x.serviceType === requestedService));
  const loadInFlight = useRef(false);
  const load = useCallback(async () => {
    if (loadInFlight.current) return;
    loadInFlight.current = true; setLoading(true);
    try { const res = await fetch(view === 'orders' ? '/api/gbuts/ott/orders' : '/api/gbuts/ott', { cache: 'no-store' }); const payload = await res.json().catch(() => { throw new Error('공동 재고 조회가 지연되고 있습니다. 잠시 후 새로고침해 주세요.'); });
      if (!res.ok || !payload.ok) throw new Error(payload.error || '판매 연결 조회 실패'); setData(payload); setLoadError('');
    } catch (e) { setLoadError(e instanceof Error ? e.message : '판매 연결 조회 실패'); } finally { loadInFlight.current = false; setLoading(false); }
  }, [view]);
  useEffect(() => {
    void load();
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 30_000);
    return () => clearInterval(timer);
  }, [load]);
  const choose = useCallback((value: string) => {
    setKey(value); const selected = data?.accounts.find(x => x.key === value);
    setEndDate(selected?.endDate || ''); setPrice(selected?.suggestedDailyPrice?.toString() || ''); setCount('1');
    setTitle(selected ? makeDefaultProductTitle(selected.serviceType) : ''); setDescription(selected ? makeGbutsOttDescription(selected.serviceType) : '');
    requestId.current = crypto.randomUUID(); setMessage('');
  }, [data?.accounts]);
  useEffect(() => {
    const serviceChanged = previousService.current !== selectionRequest;
    previousService.current = selectionRequest;
    if (serviceChanged || (!key && data && requestedService)) {
      const selected = requestedService ? data?.accounts.find(item => item.serviceType === requestedService && item.available > 0 && (!requestedAccount || item.accountEmail.toLowerCase() === requestedAccount.toLowerCase())) : undefined;
      choose(selected?.key || '');
    }
  }, [data, key, requestedService, requestedAccount, selectionRequest, choose]);
  const publish = async () => {
    if (!account || busy) return; setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/gbuts/ott/listings', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: requestId.current, serviceType: account.serviceType, accountEmail: account.accountEmail,
          endDate, dailyPrice: Number(price), capacity: Number(count), title, description }) });
      const result = await response.json(); if (!response.ok || !result.ok) throw new Error(result.error || '판매글 등록 결과를 확인해주세요.');
      setMessage('벗츠 판매글 등록 완료 · 구매 시 1:1 채팅으로 접근 링크를 자동 전달합니다.'); requestId.current = crypto.randomUUID();
      await load();
    } catch (e) { setMessage(e instanceof Error ? e.message : '판매글 등록 실패'); await load(); } finally { setBusy(false); }
  };
  const close = async (listing: Listing) => {
    if (!window.confirm('이 벗츠 판매글의 추가 모집을 종료할까요? 기존 구매자의 이용은 계속됩니다.')) return;
    setBusy(true);
    try { const response = await fetch(`/api/gbuts/ott/listings/${listing.id}/close`, { method: 'POST' }); const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error); setMessage('모집 종료를 확인했습니다.'); await load();
    } catch (e) { setMessage(e instanceof Error ? e.message : '모집 종료 실패'); } finally { setBusy(false); }
  };
  const reconcile = async (listing: Listing) => {
    setBusy(true);
    try { const response = await fetch(`/api/gbuts/ott/listings/${listing.id}/reconcile`, { method: 'POST' }); const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error); setMessage('판매글 등록 결과를 확인했습니다.'); await load();
    } catch (e) { setMessage(e instanceof Error ? e.message : '판매글 확인 실패'); } finally { setBusy(false); }
  };
  return <main style={{ maxWidth: 950, margin: 'auto', padding: 20, color: '#1E1B4B' }}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}><h1 style={{ fontSize: 23 }}><ShoppingBag size={22} /> {view === 'orders' ? '벗츠 주문·전달 관리' : '벗츠 OTT 판매글 작성'}</h1>
      <button style={styles.button} disabled={loading || busy} onClick={load}><RefreshCw size={15} /> {loading ? '확인 중' : '새로고침'}</button></div>
    <p style={{ fontSize: 13, lineHeight: 1.6 }}>넷플릭스·디즈니+·티빙·웨이브의 계정과 남은 자리를 그레이태그와 함께 관리합니다. 벗츠에서 판매할 자리를 정하면 결제한 구매자의 1:1 채팅으로 전용 계정 확인 링크가 전달됩니다.</p>
    {loadError && <p role="alert" style={{ ...styles.card, color: '#B91C1C' }}>{loadError}</p>}
    {message && <p role="status" style={{ ...styles.card, color: '#6D28D9' }}>{message}</p>}
    {data?.lastError && <p style={{ ...styles.card, color: '#B91C1C' }}>{data.lastError}</p>}
    <div style={styles.card}><strong>{data ? (data.enabled ? '자동 전달 실행 중 · 약 30초 간격' : '자동 전달 중지 상태') : '판매 연결 확인 중'}</strong>
      <p style={{ fontSize: 12 }}>최근 확인: {data?.lastSuccess ? new Date(data.lastSuccess).toLocaleString('ko-KR') : '연결된 판매글의 주문을 기다리고 있습니다.'}</p>
      <button style={styles.button} onClick={() => navigate('/spotify-invites')}>벗츠 판매자 연결 관리</button></div>
    {!!data?.unlinked.length && <p style={{ ...styles.card, color: '#B91C1C' }}>계정 연결이 없는 기존 벗츠 판매글 {data.unlinked.map(x => x.seq).join(', ')}의 재고 확인이 필요합니다.</p>}
    {view === 'sales' && data?.inventory?.status === 'stale' && <p style={{ fontSize: 12, color: '#B45309' }}>최근 확인한 재고를 표시하며 최신 내역을 조회하고 있습니다. 판매 등록 직전에 남은 자리를 다시 확인합니다. ({new Date(data.inventory.updatedAt).toLocaleString('ko-KR')})</p>}
    {view === 'sales' && loading && !data && <p role="status">공동 재고와 계정 이용 기간을 확인하고 있습니다.</p>}
    {view === 'sales' && <section style={styles.card}><h2 style={{ fontSize: 17 }}>벗츠에서 판매할 자리{requestedService && ` · ${requestedService}`}</h2>
      <button style={styles.button} onClick={() => navigate(`/gbuts-accounts${requestedService ? `?service=${encodeURIComponent(requestedService)}` : ""}`)}>계정 추가·관리</button>
      <label>계정<select style={styles.input} aria-label="판매 계정" value={key} onChange={e => choose(e.target.value)}><option value="">계정을 선택해주세요</option>
        {data?.accounts.filter(x => x.available > 0 && (!requestedService || x.serviceType === requestedService)).map(x => <option key={x.key} value={x.key}>{x.serviceType} · {x.accountEmail} · 남은 {x.available}자리</option>)}</select></label>
      {data && !data.accounts.some(x => x.available > 0 && (!requestedService || x.serviceType === requestedService)) && <p style={{ color: '#B45309', fontSize: 13 }}>현재 판매 가능한 자리가 없습니다. 기존 계정의 결제·이용 기간과 공동 재고를 확인해 주세요.</p>}
      {account?.serviceType === '넷플릭스' && <p style={{ fontSize:12, lineHeight:1.6 }}>넷플릭스 프로필 이름을 1, 2, 3, 4, 5로 미리 만들어주세요. 구매자에게 빈 프로필 번호를 순서대로 안내하며, 환불 완료·이용 종료된 번호는 재사용합니다.</p>}
      {account && <p style={{ fontSize: 12 }}>전체 {account.total}자리 · 그레이태그 {account.graytag} · 수동 {account.manual} · 벗츠 {account.gbuts} · 등록 확인 중 {account.claims} · 남은 {account.available}자리</p>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginTop: 15 }}>
        <label>이용 종료일<input aria-label="이용 종료일" type="date" style={styles.input} max={account?.endDate} value={endDate} onChange={e => { setEndDate(e.target.value); requestId.current = crypto.randomUUID(); }} /></label>
        <label>하루 요금 (원)<input aria-label="하루 요금" type="number" min="1" style={styles.input} value={price} onChange={e => { setPrice(e.target.value); requestId.current = crypto.randomUUID(); }} /></label>
        <label>모집 인원<input aria-label="모집 인원" type="number" min="1" max={account?.available || 0} style={styles.input} value={count} onChange={e => { setCount(e.target.value); requestId.current = crypto.randomUUID(); }} /></label>
      </div>
      <label style={{ display: 'block', marginTop: 15 }}>판매글 제목<input style={styles.input} value={title} maxLength={80} onChange={e => { setTitle(e.target.value); requestId.current = crypto.randomUUID(); }} /></label>
      <label style={{ display: 'block', marginTop: 15 }}>이용 안내<textarea style={{ ...styles.input, minHeight: 120 }} value={description} onChange={e => { setDescription(e.target.value); requestId.current = crypto.randomUUID(); }} /></label>
      <p style={{ fontSize: 12 }}>등록 시 벗츠 판매글이 공개되며, 모집 인원만큼 공동 재고에서 자리가 확보됩니다. 요금·기간의 기본값은 기존 그레이태그 정보로 채워집니다.</p>
      <button style={styles.button} disabled={busy || !data?.enabled || !account || account.available < Number(count) || Number(count) < 1 || Number(price) < 1 || !endDate || !!data?.unlinked.length} onClick={publish}>{busy ? '처리 중' : '벗츠 판매글 등록'}</button>
    </section>}
    <section style={styles.card}><h2 style={{ fontSize: 17 }}>연결된 판매글</h2>{!data?.listings.length && <p>아직 연결된 판매글이 없습니다.</p>}
      {data?.listings.map(x => <div key={x.id} style={{ borderTop: '1px solid #EDE9FE', padding: '13px 0' }}><strong>{x.serviceType} · {labels[x.state] || x.state}</strong>
        <p style={{ fontSize: 12 }}>{x.accountEmail} · {x.capacity}명 · {x.dailyPrice}원/일 · {x.endDate}까지</p>
        {x.postSeq && <a href={`https://gbuts.com/seller/subscriptions/${x.postSeq}`} target="_blank" rel="noreferrer">판매글 보기 <ExternalLink size={12} /></a>}
        {x.state === 'registered' && <button disabled={busy} style={{ ...styles.button, marginLeft: 12, background: '#64748B' }} onClick={() => close(x)}>모집 종료</button>}
        {['submitting', 'uncertain'].includes(x.state) && <button disabled={busy} style={{ ...styles.button, marginLeft: 12, background: '#64748B' }} onClick={() => reconcile(x)}>판매글 확인 다시</button>}
        {x.error && <p style={{ color: '#B91C1C' }}>{x.error}</p>}
        {data.orders.filter(o => o.listingId === x.id).map(o => <p key={o.key} style={{ fontSize: 12 }}>{o.name} · {o.profileNumber ? `${o.profileNumber}번 프로필${o.profileReleasedAt ? ' (자리 반환)' : ''}` : o.profileName || '프로필 배정 대기'} · {o.cancelStatus === 'REFUNDED' ? '환불' : labels[o.delivery]} · {o.endDate}까지 {o.error && `· ${o.error}`}</p>)}
      </div>)}
    </section>
  </main>;
}
