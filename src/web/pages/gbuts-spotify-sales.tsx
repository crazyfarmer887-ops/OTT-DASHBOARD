import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import type { SpotifyListing, SpotifyListingInput } from '../../lib/gbuts-spotify-listings';

type Data = { enabled: boolean; template: SpotifyListingInput & { sourcePostSeq: number }; listings: SpotifyListing[] };
const card = { background: '#fff', border: '1px solid #EDE9FE', borderRadius: 16, padding: 18, marginBottom: 16 };
const field = { display: 'block', width: '100%', boxSizing: 'border-box' as const, padding: 11, marginTop: 6, border: '1px solid #DDD6FE', borderRadius: 9, font: 'inherit' };
const button = { padding: '12px 16px', border: 0, borderRadius: 10, background: '#7C3AED', color: '#fff', fontWeight: 800, cursor: 'pointer' };
export default function GbutsSpotifySalesPage() {
  const [, navigate] = useLocation();
  const [data, setData] = useState<Data | null>(null);
  const [form, setForm] = useState<SpotifyListingInput | null>(null);
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState(''); const [error, setError] = useState('');
  const requestId = useRef(crypto.randomUUID());
  const load = useCallback(async (defaults = false) => {
    const response = await fetch('/api/gbuts/spotify/listings', { cache: 'no-store' });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || '스포티파이 판매글 조회 실패');
    setData(result);
    if (defaults) { setForm(result.template); requestId.current = crypto.randomUUID(); }
  }, []);
  useEffect(() => { void load(true).catch(e => setError(e.message)); }, [load]);
  const change = <K extends keyof SpotifyListingInput>(key: K, value: SpotifyListingInput[K]) => {
    setForm(current => current ? { ...current, [key]: value } : current); requestId.current = crypto.randomUUID();
  };
  const publish = async (event: React.FormEvent) => {
    event.preventDefault(); if (!form || busy || !data?.enabled) return;
    setBusy(true); setError(''); setMessage('벗츠에 등록하고 실제 판매글을 확인하고 있습니다.');
    try {
      const response = await fetch('/api/gbuts/spotify/listings', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, requestId: requestId.current }) });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || '판매글 등록 결과를 확인해주세요.');
      setMessage(`판매글 ${result.listing.postSeq} 등록 완료 · 구매 후 기존 스포티파이 자동 안내가 적용됩니다.`);
      await load().catch(() => setError('등록은 완료됐습니다. 목록을 다시 불러와주세요.'));
    } catch (e) { setMessage(''); setError(e instanceof Error ? e.message : '등록 실패'); await load().catch(() => {}); }
    finally { setBusy(false); }
  };
  const reconcile = async (id: string) => {
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/gbuts/spotify/listings/${encodeURIComponent(id)}/reconcile`, { method: 'POST' });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || '등록 확인 실패');
      setMessage('판매글 등록을 확인했습니다. 구매자 자동 안내 대상에 포함됐습니다.'); await load();
    } catch (e) { setError(e instanceof Error ? e.message : '등록 확인 실패'); } finally { setBusy(false); }
  };
  const remove = async (listing: SpotifyListing) => {
    if (busy || !window.confirm('이 판매글의 모집을 마감하고 대시보드 목록에서 삭제할까요? 이미 결제한 구매자의 노션 처리와 자동 안내는 계속됩니다.')) return;
    setBusy(true); setError(''); setMessage('벗츠 모집 마감 상태를 확인하고 있습니다.');
    try {
      const response = await fetch(`/api/gbuts/spotify/listings/${encodeURIComponent(listing.id)}`, { method: 'DELETE' });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || '판매글 삭제 실패');
      requestId.current = crypto.randomUUID();
      setMessage('모집을 마감하고 대시보드 목록에서 삭제했습니다. 기존 구매자 자동 안내는 계속됩니다.');
      await load().catch(() => setError('삭제는 완료됐습니다. 목록을 다시 불러와주세요.'));
    } catch (e) { setMessage(''); setError(e instanceof Error ? e.message : '판매글 삭제 실패'); }
    finally { setBusy(false); }
  };
  return <main style={{ maxWidth: 950, margin: 'auto', padding: 20, color: '#1E1B4B' }}>
    <h1 style={{ fontSize: 23 }}>벗츠 스포티파이 판매글 작성</h1>
    <p style={{ fontSize: 13, lineHeight: 1.7 }}>이전에 판매한 스포티파이 글의 내용을 불러옵니다. 구매자가 결제하면 기존 1:1 안내와 노션 Registered / Invited 처리로 연결됩니다.</p>
    <p style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}><button style={button} onClick={() => navigate('/spotify-invites')}>초대·판매자 연결 관리</button>
      <button style={button} disabled={busy} onClick={() => { setError(''); void load(!form).catch(e => setError(e.message)); }}>다시 불러오기</button></p>
    {error && <p role="alert" style={{ ...card, color: '#B91C1C' }}>{error}</p>}
    {message && <p role="status" style={card}>{message}</p>}
    {!form && <p>이전 판매글을 불러오는 중입니다.</p>}
    {data && !data.enabled && <p role="alert">스포티파이 자동 안내 연결을 확인해주세요.</p>}
    {form && <form onSubmit={publish} style={card}>
      <p style={{ fontSize: 12 }}>기준 판매글: <a href={`https://gbuts.com/seller/subscriptions/${data?.template.sourcePostSeq}`} target="_blank" rel="noreferrer">이전 스포티파이 판매글</a></p>
      <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0, display: 'grid', gap: 16 }}>
        <label>제목<input aria-label="제목" required maxLength={100} style={field} value={form.title} onChange={e => change('title', e.target.value)} /></label>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
          <label>이용 시작일<input aria-label="이용 시작일" type="date" required style={field} value={form.startDate} onChange={e => change('startDate', e.target.value)} /></label>
          <label>이용 종료일<input aria-label="이용 종료일" type="date" required style={field} value={form.endDate} onChange={e => change('endDate', e.target.value)} /></label>
          <label>하루 요금 (원)<input aria-label="하루 요금" type="number" min={1} max={100000} required style={field} value={form.dailyPrice} onChange={e => change('dailyPrice', Number(e.target.value))} /></label>
          <label>모집 인원<input aria-label="모집 인원" type="number" min={1} max={5} required style={field} value={form.capacity} onChange={e => change('capacity', Number(e.target.value))} /></label>
        </div>
        <label>판매 내용<textarea aria-label="판매 내용" required maxLength={5000} style={{ ...field, minHeight: 300 }} value={form.description} onChange={e => change('description', e.target.value)} /></label>
        <label>구매 전 안내<textarea aria-label="구매 전 안내" maxLength={5000} style={{ ...field, minHeight: 140 }} value={form.noticeBeforeOrder || ''} onChange={e => change('noticeBeforeOrder', e.target.value || null)} /></label>
        <label>구매 후 안내 (선택)<textarea aria-label="구매 후 안내" maxLength={5000} style={{ ...field, minHeight: 80 }} value={form.noticeAfterOrder || ''} onChange={e => change('noticeAfterOrder', e.target.value || null)} /></label>
        <p style={{ margin: 0, fontSize: 12 }}>등록하면 벗츠에 판매글이 공개됩니다. 결제 후 안내는 기존 자동 메시지로 발송됩니다.</p>
        <button type="submit" style={button} disabled={busy || !data?.enabled}>{busy ? '등록 결과 확인 중' : '스포티파이 판매글 등록'}</button>
      </fieldset>
    </form>}
    {!!data?.listings.length && <section style={card}><h2 style={{ fontSize: 18 }}>등록한 스포티파이 판매글</h2>
      {[...data.listings].reverse().map(listing => <div key={listing.id} style={{ borderTop: '1px solid #EDE9FE', padding: '12px 0' }}>
        <strong>{listing.title}</strong><p>{listing.dailyPrice}원/일 · {listing.capacity}명 · {listing.endDate}까지</p>
        <p>{listing.state === 'registered' ? '등록 확인 완료 · 구매자 자동 안내 연결됨' : '등록 결과 확인 필요'}</p>
        {listing.postSeq && <a href={`https://gbuts.com/seller/subscriptions/${listing.postSeq}`} target="_blank" rel="noreferrer">벗츠 판매글 보기</a>}
        {listing.state === 'registered' && <button style={{ ...button, marginLeft: 12, background: '#B91C1C' }} disabled={busy} onClick={() => void remove(listing)}>삭제</button>}
        {listing.state !== 'registered' && <button style={button} disabled={busy} onClick={() => void reconcile(listing.id)}>등록 결과 확인</button>}
        {listing.error && <p style={{ color: '#B91C1C' }}>{listing.error}</p>}
      </div>)}
    </section>}
  </main>;
}
