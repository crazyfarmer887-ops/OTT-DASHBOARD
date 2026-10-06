import { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { ArrowRight, RefreshCw, ShoppingBag } from 'lucide-react';

type Service = { serviceType: string; listings: number; recruiting: number; members: number; confirmed: number; pending: number; invitationFlow: boolean };
type Overview = { services: Service[]; enabled: boolean; updatedAt: string; lastError: string | null; listings: Array<{ seq: number; serviceType: string; memberCount: number; memberLimit: number; status: string; endDate: string; dailyPrice: number | null }> };
const serviceNames = ['넷플릭스', '디즈니플러스', '티빙', '웨이브', '스포티파이'];
const card = { background: '#fff', border: '1px solid #EDE9FE', borderRadius: 16, padding: 18 };
const button = { border: 0, borderRadius: 10, background: '#7C3AED', color: '#fff', padding: '11px 14px', fontFamily: 'inherit', fontWeight: 800, cursor: 'pointer' };

export default function GbutsHomePage() {
  const [, navigate] = useLocation();
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const response = await fetch('/api/gbuts/sales/overview', { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || '판매 현황을 불러오지 못했습니다.');
      setData(result);
    } catch (e) { setError(e instanceof Error ? e.message : '판매 현황 조회 실패'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  return <main style={{ maxWidth: 950, margin: 'auto', padding: 20, color: '#1E1B4B' }}>
    <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
      <h1 style={{ fontSize: 24 }}><ShoppingBag size={23} /> 벗츠 판매 관리</h1>
      <button style={button} disabled={loading} onClick={load}><RefreshCw size={14} /> {loading ? '확인 중' : '새로고침'}</button>
    </header>
    <p style={{ fontSize: 13, lineHeight: 1.6 }}>서비스를 선택하고 계정·이용 기간·하루 요금을 정해 판매하세요. 구매 후 계정 확인 링크가 1:1 채팅으로 전달됩니다.</p>
    {error && <p role="alert" style={{ ...card, color: '#B91C1C' }}>{error}</p>}
    {data?.lastError && <p role="alert" style={{ ...card, color: '#B91C1C' }}>자동 전달 확인 필요: {data.lastError}</p>}
    <section style={{ ...card, marginBottom: 18 }}>
      <strong>계정 추가 → 판매 시작 → 자동 전달</strong>
      <p style={{ fontSize: 13, lineHeight: 1.6 }}>넷플릭스·디즈니·티빙·웨이브는 기존 계정과 재고를 함께 사용합니다. 스포티파이는 Notion의 Registered / Invited 체크로 초대·계정 전달을 처리합니다.</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        <button style={button} onClick={() => navigate('/gbuts-accounts')}>계정 추가·관리</button>
        <button style={button} onClick={() => navigate('/gbuts-sales')}>OTT 판매글 작성</button>
        <button style={{ ...button, background: '#F3F0FF', color: '#6D28D9' }} onClick={() => navigate('/gbuts-orders')}>주문·전달 관리</button>
      </div>
    </section>
    <section aria-label="서비스별 판매 현황" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 14 }}>
      {serviceNames.map(serviceType => {
        const service = data?.services.find(item => item.serviceType === serviceType);
        const spotify = serviceType === '스포티파이';
        return <article key={serviceType} style={card}>
          <h2 style={{ fontSize: 18, margin: '0 0 12px' }}>{serviceType}</h2>
          <p style={{ fontSize: 13 }}>진행 중 판매글 <strong>{service?.listings ?? '—'}</strong>개 · 참여 표시 <strong>{service?.members ?? '—'}</strong>명</p>
          <p style={{ fontSize: 12, color: '#6B7280' }}>판매글의 모집 잔여 <strong>{service?.recruiting ?? '—'}</strong>자리</p>
          {!spotify && service && <p style={{ fontSize: 12 }}>전달 완료 {service.confirmed}건 · 대기/확인 필요 {service.pending}건</p>}
          <button style={button} onClick={() => navigate(spotify ? '/spotify-invites' : `/gbuts-sales?service=${encodeURIComponent(serviceType)}`)}>{spotify ? '초대·판매자 연결 관리' : '판매글 작성'} <ArrowRight size={13} /></button>
        </article>;
      })}
    </section>
    <section style={{ ...card, marginTop: 18 }}>
      <h2 style={{ fontSize: 17 }}>현재 벗츠 판매글</h2>
      {data && !data.listings.length && <p style={{ fontSize: 13 }}>새 서비스의 판매글을 작성해 주세요.</p>}
      {data?.listings.map(listing => <div key={listing.seq} style={{ padding: '12px 0', borderTop: '1px solid #EDE9FE', fontSize: 13 }}>
        <strong>{listing.serviceType}</strong> · {listing.dailyPrice == null ? '요금 확인 필요' : `${listing.dailyPrice}원/일`} · {listing.memberCount}/{listing.memberLimit}명 · {listing.endDate}까지
        <p style={{ marginBottom: 0 }}><a href={`https://gbuts.com/seller/subscriptions/${listing.seq}`} target="_blank" rel="noreferrer">벗츠에서 판매글·채팅 확인</a></p>
      </div>)}
      <p style={{ fontSize: 11, color: '#6B7280', lineHeight: 1.6 }}>참여 표시는 벗츠 판매글 기준이며 최종 정산액과 다를 수 있습니다. 모집 잔여는 해당 판매글의 남은 인원으로, 신규 판매 가능한 공동 재고는 판매글 작성에서 확인합니다.{data && ` 최근 조회: ${new Date(data.updatedAt).toLocaleString('ko-KR')}`}</p>
    </section>
  </main>;
}
