import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, KeyRound, Loader2, RefreshCw, ShieldCheck } from 'lucide-react';

type SessionAccount = {
  id: string;
  label: string;
  purpose: string;
  connected: boolean;
  status?: 'ok' | 'expired' | 'unknown' | 'missing';
  detail?: string;
  updatedAt?: string | null;
};

function formatUpdatedAt(value?: string | null): string {
  if (!value) return '확인 기록 없음';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '확인 기록 없음' : parsed.toLocaleString('ko-KR');
}

export default function YouTubeSalesSessionCard() {
  const [account, setAccount] = useState<SessionAccount | null>(null);
  const [cookieJson, setCookieJson] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/session/accounts', { cache: 'no-store' });
      const body = await response.json().catch(() => null) as { accounts?: SessionAccount[]; error?: string } | null;
      if (!response.ok) throw new Error(body?.error || '전용 세션 상태를 불러오지 못했습니다.');
      setAccount(body?.accounts?.find((item) => item.id === 'youtube-invite-sales') || null);
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : '전용 세션 상태를 불러오지 못했습니다.' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadStatus(); }, [loadStatus]);

  async function saveSession() {
    setMessage(null);
    let cookies: unknown;
    try {
      cookies = JSON.parse(cookieJson);
    } catch {
      setMessage({ kind: 'error', text: '브라우저에서 내보낸 쿠키 JSON을 그대로 붙여넣어 주세요.' });
      return;
    }

    setSaving(true);
    try {
      const response = await fetch('/api/session/accounts/youtube-invite-sales/cookies', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cookies }),
      });
      const body = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(body?.error || '전용 세션을 저장하지 못했습니다.');
      setCookieJson('');
      setMessage({ kind: 'success', text: '전용 판매 계정이 확인되어 서버에 안전하게 저장됐습니다.' });
      await loadStatus();
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : '전용 세션을 저장하지 못했습니다.' });
    } finally {
      setSaving(false);
    }
  }

  const healthy = account?.connected && account.status === 'ok';
  return (
    <section className="youtube-sales-session-card" aria-labelledby="youtube-sales-session-title">
      <div className="youtube-sales-session-heading">
        <div className="youtube-sales-session-icon" aria-hidden="true"><ShieldCheck size={20} /></div>
        <div>
          <div className="youtube-sales-session-badge">유튜브 초대장 판매 전용</div>
          <h3 id="youtube-sales-session-title">GrayTag 판매자 세션</h3>
          <p>이 계정은 유튜브 초대장 상품 등록·판매 감지·전달 처리에만 사용하며, 기본 GrayTag 계정과 섞지 않습니다.</p>
        </div>
        <button type="button" className="youtube-session-refresh" onClick={() => void loadStatus()} disabled={loading} aria-label="전용 세션 상태 새로고침">
          <RefreshCw size={14} className={loading ? 'is-spinning' : ''} />
        </button>
      </div>

      <div className={`youtube-sales-session-status ${healthy ? 'is-healthy' : 'needs-attention'}`} role="status">
        {loading ? <Loader2 size={16} className="is-spinning" /> : healthy ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
        <div>
          <strong>{loading ? '상태 확인 중' : healthy ? '전용 계정 연결됨' : account?.connected ? '세션 확인 필요' : '전용 세션 미등록'}</strong>
          <span>{account?.detail || '쿠키 JSON을 등록하면 서버 재시작 후에도 유지됩니다.'}</span>
        </div>
        <time>{formatUpdatedAt(account?.updatedAt)}</time>
      </div>

      <details className="youtube-sales-session-import">
        <summary><KeyRound size={14} /> 전용 세션 등록 또는 교체</summary>
        <div className="youtube-sales-session-form">
          <label htmlFor="youtube-sales-cookie-json">브라우저 쿠키 JSON</label>
          <textarea
            id="youtube-sales-cookie-json"
            value={cookieJson}
            onChange={(event) => setCookieJson(event.target.value)}
            placeholder='[{"domain":"graytag.co.kr","name":"JSESSIONID","value":"…"}]'
            spellCheck={false}
            autoComplete="off"
          />
          <div className="youtube-sales-session-help">인증에 필요한 3개 쿠키만 서버에 저장하고 분석용 쿠키는 버립니다. GrayTag 로그인이 만료되면 새 JSON으로 교체해야 합니다.</div>
          <button type="button" onClick={() => void saveSession()} disabled={saving || !cookieJson.trim()}>
            {saving ? <Loader2 size={14} className="is-spinning" /> : <ShieldCheck size={14} />}
            {saving ? '연결 확인 중' : '전용 세션 저장'}
          </button>
        </div>
      </details>
      {message && <div className={`youtube-sales-session-message ${message.kind}`} role={message.kind === 'error' ? 'alert' : 'status'}>{message.text}</div>}
    </section>
  );
}
