import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { ArrowUpRight, RefreshCw, Trash2, Users } from 'lucide-react';
import ListingPeriodPresets from '../components/listing-period-presets';
import { LISTING_PERIODS, listingPeriodEnd } from '../lib/listing-period';
import type { SpotifyListing, SpotifyListingInput } from '../../lib/gbuts-spotify-listings';

type Data = { enabled: boolean; template: SpotifyListingInput & { sourcePostSeq: number }; listings: SpotifyListing[] };
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
  const changeStartDate = (value: string) => {
    setForm(current => {
      if (!current) return current;
      const active = LISTING_PERIODS.find(period => listingPeriodEnd(current.startDate, period.months) === current.endDate);
      return { ...current, startDate: value, endDate: active ? listingPeriodEnd(value, active.months) || current.endDate : current.endDate };
    });
    requestId.current = crypto.randomUUID();
  };
  const days = form ? Math.round((Date.parse(form.endDate) - Date.parse(form.startDate)) / 86400000) + 1 : 0;
  return <main className="spotify-sales-page">
    <header className="ops-page-heading">
      <div><p className="ops-eyebrow">SALES / SPOTIFY</p><h1>스포티파이 판매</h1><p>판매 조건을 정하고, 초대와 구매자 안내까지 한 곳에서 관리하세요.</p></div>
      <div className="ops-heading-actions">
        <button className="ops-button ops-button-secondary" onClick={() => navigate('/spotify-invites')}><Users size={14} />초대·연결 관리</button>
        <button className="ops-button ops-button-secondary" disabled={busy} onClick={() => { setError(''); void load(!form).catch(e => setError(e.message)); }}><RefreshCw size={14} />새로고침</button>
      </div>
    </header>
    {error && <p role="alert" className="ops-notice ops-notice-error">{error}</p>}
    {message && <p role="status" className="ops-notice">{message}</p>}
    <div className="ops-summary-grid">
      <div className="ops-summary-card"><span>하루 판매 요금</span><strong>{form ? form.dailyPrice.toLocaleString() : '—'}<small>원 / 일</small></strong></div>
      <div className="ops-summary-card"><span>모집 인원</span><strong>{form?.capacity ?? '—'}<small>명</small></strong></div>
      <div className="ops-summary-card"><span>구매자 자동 안내</span><strong className="ops-summary-text">{!data ? '확인 중' : data.enabled ? '연결됨' : '연결 확인 필요'}</strong></div>
    </div>
    {data && !data.enabled && <p role="alert" className="ops-notice ops-notice-error">스포티파이 자동 안내 연결을 확인해주세요.</p>}
    <div className="spotify-sales-layout">
      <section className="ops-panel">
        <div className="ops-panel-heading"><h2>새 판매글</h2>{data && <a href={`https://gbuts.com/seller/subscriptions/${data.template.sourcePostSeq}`} target="_blank" rel="noreferrer">이전 판매글 보기 ↗</a>}</div>
        {!form ? <p className="ops-empty">이전 판매글의 내용을 불러오고 있습니다.</p> : <form onSubmit={publish}>
          <fieldset disabled={busy} className="ops-form-body">
            <label className="ops-field">판매글 제목<input aria-label="제목" required maxLength={100} value={form.title} onChange={e => change('title', e.target.value)} /></label>
            <div><p className="ops-period-label">이용 기간</p>
              <ListingPeriodPresets startDate={form.startDate} endDate={form.endDate} disabled={busy} onChange={value => change('endDate', value)} />
              <div className="ops-field-grid">
                <label className="ops-field">시작일<input aria-label="이용 시작일" type="date" required value={form.startDate} onChange={e => changeStartDate(e.target.value)} /></label>
                <label className="ops-field">종료일<input aria-label="이용 종료일" type="date" required value={form.endDate} onChange={e => change('endDate', e.target.value)} /></label>
              </div>
            </div>
            <div className="ops-field-grid">
              <label className="ops-field">하루 요금 (원)<input aria-label="하루 요금" type="number" min={1} max={100000} required value={form.dailyPrice} onChange={e => change('dailyPrice', Number(e.target.value))} /></label>
              <label className="ops-field">모집 인원<input aria-label="모집 인원" type="number" min={1} max={5} required value={form.capacity} onChange={e => change('capacity', Number(e.target.value))} /></label>
            </div>
            <label className="ops-field">판매 내용<textarea aria-label="판매 내용" required maxLength={5000} value={form.description} onChange={e => change('description', e.target.value)} /></label>
            <details className="ops-form-details"><summary>구매 전·후 안내 문구</summary>
              <label className="ops-field">구매 전 안내<textarea aria-label="구매 전 안내" maxLength={5000} value={form.noticeBeforeOrder || ''} onChange={e => change('noticeBeforeOrder', e.target.value || null)} /></label>
              <label className="ops-field">구매 후 안내 (선택)<textarea aria-label="구매 후 안내" maxLength={5000} value={form.noticeAfterOrder || ''} onChange={e => change('noticeAfterOrder', e.target.value || null)} /></label>
            </details>
            <div className="ops-form-footer"><p>{Number.isFinite(days) && days > 0 ? `${days}일 이용 · ` : ''}초대형 상품으로 공개됩니다. 구매 후 기존 1:1 자동 안내가 적용됩니다.</p>
              <button type="submit" className="ops-button ops-button-wide" disabled={busy || !data?.enabled}>{busy ? '등록 결과 확인 중' : '스포티파이 판매글 등록'}<ArrowUpRight size={15} /></button>
            </div>
          </fieldset>
        </form>}
      </section>
      <aside>
        <section className="ops-panel"><div className="ops-panel-heading"><h2>등록한 판매글</h2><span className="ops-count">{data?.listings.length ?? 0}</span></div>
          {!data?.listings.length && <p className="ops-empty">등록한 판매글이 여기에 표시됩니다.</p>}
          {[...(data?.listings || [])].reverse().map(listing => <article key={listing.id} className="ops-listing">
            <h3>{listing.title}</h3><span className="ops-status">{listing.state === 'registered' ? '자동 안내 연결됨' : '등록 결과 확인 필요'}</span>
            <div className="ops-listing-meta"><span>{listing.dailyPrice.toLocaleString()}원/일</span><span>{listing.capacity}명 모집</span></div>
            <p className="ops-listing-period">{listing.endDate}까지</p>
            <div className="ops-listing-actions">
              {listing.postSeq && <a href={`https://gbuts.com/seller/subscriptions/${listing.postSeq}`} target="_blank" rel="noreferrer">벗츠 판매글<ArrowUpRight size={13} /></a>}
              {listing.state === 'registered' ? <button className="ops-button ops-button-danger" disabled={busy} onClick={() => void remove(listing)}><Trash2 size={13} />삭제</button>
                : <button className="ops-button ops-button-secondary" disabled={busy} onClick={() => void reconcile(listing.id)}>등록 결과 확인</button>}
            </div>
            {listing.error && <p className="ops-listing-error">{listing.error}</p>}
          </article>)}
        </section>
        <div className="ops-help"><strong>구매 후에는 이렇게 진행돼요</strong><ol><li>구매자에게 1:1 이용 방법을 안내합니다.</li><li>계정 정보나 새 계정 발급 요청을 노션에 기록합니다.</li><li>Registered / Invited 체크에 따라 결과를 전달합니다.</li></ol></div>
      </aside>
    </div>
  </main>;
}
