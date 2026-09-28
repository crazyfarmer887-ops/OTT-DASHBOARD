import { useEffect, useState } from 'react';
import { getAdminToken } from '../lib/admin-auth';

type Status = {
  enabled: boolean;
  queue: Array<{ id: string; managerEmailMasked: string; addedAt: string }>;
  batch: { label: string; completed: number } | null;
  lastBatch: { label: string; completedAt: string } | null;
  lastCheck: { at: string; available: number | null; onSale: number | null; reason: string } | null;
};

const reasonText: Record<string, string> = {
  existing_listings_for_sale: '기존 판매글이 판매 중입니다.',
  notion_slots_below_five: '노션 잔여 슬롯이 5개 미만입니다.',
  no_queued_manager: '다음 호기의 관리자 이메일을 등록해 주세요.',
  template_unavailable: '기존 판매글 양식을 확인할 수 없습니다.',
  ambiguous_template: '기존 판매글 양식이 서로 달라 자동 등록을 보류했습니다.',
  seller_unavailable: '판매 현황을 확인하지 못해 등록을 보류했습니다.',
  sale_unconfirmed: '기존 판매글의 판매 완료를 확인하는 중입니다.',
  registration_uncertain: '글 등록 결과 확인이 필요합니다.',
  group_conflict: '다음 호기 관리자 계정이 기존 그룹과 겹칩니다.',
  batch_completed: '새 호기와 판매글 5개를 등록했습니다.',
};

export default function YouTubeAutoListingCard() {
  const [status, setStatus] = useState<Status | null>(null);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const headers = (json = false) => ({ ...(json ? { 'Content-Type': 'application/json' } : {}),
    ...(getAdminToken() ? { 'x-admin-token': getAdminToken()! } : {}) });
  const refresh = async () => {
    try {
      const response = await fetch('/api/youtube/auto-listings', { headers: headers() });
      const body = await response.json();
      if (!response.ok || body.ok !== true) throw new Error();
      setStatus(body);
    } catch { setMessage('자동 등록 상태를 불러오지 못했습니다.'); }
  };
  useEffect(() => { void refresh(); const timer = setInterval(() => { void refresh(); }, 60_000);
    return () => clearInterval(timer); }, []);
  const mutate = async (url: string, method: 'POST' | 'DELETE', body?: object) => {
    setBusy(true); setMessage('');
    try {
      const response = await fetch(url, { method, headers: headers(Boolean(body)),
        ...(body ? { body: JSON.stringify(body) } : {}) });
      const payload = await response.json();
      if (!response.ok || payload.ok !== true) throw new Error(payload.error || '등록하지 못했습니다.');
      setEmail('');
      await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : '처리하지 못했습니다.'); }
    finally { setBusy(false); }
  };
  return <section className="youtube-service-notice" aria-label="유튜브 판매글 자동 등록" style={{ display: 'block', marginBottom: 12 }}>
    <strong>판매글 자동 등록 {status?.enabled ? '켜짐' : '꺼짐'}</strong>
    <p style={{ margin: '5px 0' }}>기존 글이 모두 판매되고 노션 슬롯이 5개 이상 남으면, 다음 호기 5자리와 판매글 5개를 만듭니다. 가격은 하루 150원입니다.</p>
    {status?.lastCheck && <p style={{ margin: '5px 0' }}>잔여 슬롯 {status.lastCheck.available ?? '확인 불가'}개 · 판매 중 {status.lastCheck.onSale ?? '확인 불가'}개 · {reasonText[status.lastCheck.reason] || status.lastCheck.reason}</p>}
    {status?.batch && <p style={{ margin: '5px 0' }}>{status.batch.label} 등록 중 · {status.batch.completed}/5개 완료</p>}
    {status?.enabled && <form onSubmit={(event) => { event.preventDefault(); void mutate('/api/youtube/auto-listings/queue', 'POST', { managerEmail: email }); }} style={{ display:'flex', gap: 6, marginTop: 8 }}>
      <input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="다음 호기 관리자 Google 이메일" style={{ flex: 1, minWidth: 0, padding: 8, border: '1px solid #ddd6fe', borderRadius: 8 }} />
      <button type="submit" disabled={busy}>대기 등록</button>
    </form>}
    {status?.queue.map((item) => <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 5 }}>
      <span>{item.managerEmailMasked} · 대기 중</span>
      <button type="button" disabled={busy || status.batch !== null} onClick={() => { void mutate(`/api/youtube/auto-listings/queue/${encodeURIComponent(item.id)}`, 'DELETE'); }}>삭제</button>
    </div>)}
    {message && <p role="alert" style={{ margin: '6px 0', color: '#b91c1c' }}>{message}</p>}
  </section>;
}
