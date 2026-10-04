import { useEffect, useState } from 'react';

type SessionStatus = {
  connected: boolean;
  expired?: boolean;
  sellerLabel?: string | null;
  connectedAt?: string | null;
  memberCount?: number;
  syncEnabled: boolean;
  autoMessageEnabled?: boolean;
  chatAlertEnabled?: boolean;
};

const field = { width: '100%', padding: '12px 14px', border: '1px solid #cbd5e1', borderRadius: 10,
  fontSize: 15, boxSizing: 'border-box' as const };

export default function SpotifyInvitesPage() {
  const [status, setStatus] = useState<SessionStatus | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [token, setToken] = useState('');
  const [advanced, setAdvanced] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const load = async () => {
    const response = await fetch('/api/gbuts/session');
    if (!response.ok) throw new Error('연결 상태를 읽지 못했습니다. 관리자 인증을 확인해 주세요.');
    setStatus(await response.json() as SessionStatus);
  };
  useEffect(() => { void load().catch((error) => setMessage(error.message)); }, []);

  const connect = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/gbuts/session', { method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(advanced ? { token } : { email, password }),
      });
      const result = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !result.ok) throw new Error(result.error || 'GButs 계정 연결에 실패했습니다.');
      setPassword('');
      setToken('');
      setMessage('GButs 판매자 계정이 연결됐습니다.');
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'GButs 계정 연결에 실패했습니다.');
    } finally { setBusy(false); }
  };

  return <main style={{ maxWidth: 720, margin: '0 auto', padding: '24px 18px 100px', color: '#0f172a' }}>
    <h1 style={{ fontSize: 29, marginBottom: 6 }}>Spotify 초대</h1>
    <p style={{ color: '#475569', lineHeight: 1.6 }}>GButs 구매자 대화에서 받은 Spotify 계정을 노션 초대 표로 옮깁니다.</p>

    <section style={{ marginTop: 26, padding: 20, background: '#f8fafc', borderRadius: 14,
      border: '1px solid #e2e8f0' }}>
      <h2 style={{ margin: '0 0 12px', fontSize: 20 }}>판매자 연결</h2>
      <p style={{ margin: '0 0 16px', color: status?.connected ? '#047857' : '#b45309', fontWeight: 700 }}>
        {status?.connected ? `${status.sellerLabel || 'GButs'} 연결됨 · 현재 파티원 ${status.memberCount ?? 0}명`
          : status?.expired ? '로그인 연결이 만료됐습니다.' : 'GButs 판매자 계정 연결이 필요합니다.'}
      </p>
      <form onSubmit={connect} style={{ display: 'grid', gap: 12 }}>
        {!advanced ? <>
          <label>GButs 로그인 이메일<input aria-label="GButs 로그인 이메일" type="email" autoComplete="username"
            value={email} onChange={(event) => setEmail(event.target.value)} required style={field} /></label>
          <label>GButs 비밀번호<input aria-label="GButs 비밀번호" type="password" autoComplete="current-password"
            value={password} onChange={(event) => setPassword(event.target.value)} required style={field} /></label>
        </> : <label>GButs 로그인 토큰<input aria-label="GButs 로그인 토큰" type="password" autoComplete="off"
          value={token} onChange={(event) => setToken(event.target.value)} required style={field} /></label>}
        <button type="submit" disabled={busy} style={{ padding: '12px 16px', border: 0, borderRadius: 10,
          background: '#1d4ed8', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>
          {busy ? '확인 중...' : status?.connected ? 'GButs 다시 연결' : 'GButs 연결'}
        </button>
        <button type="button" onClick={() => setAdvanced(!advanced)} style={{ background: 'none', border: 0,
          color: '#475569', textDecoration: 'underline', cursor: 'pointer' }}>
          {advanced ? 'GButs 비밀번호 로그인으로 연결' : 'Google 로그인 토큰으로 연결'}
        </button>
      </form>
      {message && <p role="status" style={{ marginBottom: 0, color: '#b45309' }}>{message}</p>}
      <p style={{ color: '#64748b', fontSize: 13, lineHeight: 1.5 }}>비밀번호는 저장하지 않습니다. 판매자 확인 후 로그인 토큰만 서버에 보관합니다.</p>
    </section>

    <section style={{ marginTop: 24, padding: 20, background: '#f8fafc', borderRadius: 14,
      border: '1px solid #e2e8f0' }}>
      <h2 style={{ margin: '0 0 12px', fontSize: 20 }}>초대 진행</h2>
      <p style={{ margin: '0 0 12px' }}>자동 입력: <strong>{!status ? '확인 중'
        : !status.syncEnabled ? '준비 중' : status.connected ? '실행 중 · 약 30초 간격' : 'GButs 연결 대기'}</strong></p>
      <p style={{ margin: '0 0 12px' }}>구매자 자동 안내: <strong>{!status ? '확인 중'
        : !status.autoMessageEnabled ? '준비 중' : status.connected ? '실행 중' : 'GButs 연결 대기'}</strong></p>
      <p style={{ margin: '0 0 12px' }}>채팅 텔레그램 알림: <strong>{!status ? '확인 중'
        : !status.chatAlertEnabled ? '준비 중' : status.connected ? '실행 중' : 'GButs 연결 대기'}</strong></p>
      <p style={{ color: '#475569', lineHeight: 1.6 }}>구매자가 1:1 채팅에 Spotify 아이디와 비밀번호를 남기면 노션 표에 기록합니다. 동업자가 새 계정 생성 후 Registered와 Invited를 체크하면 새 계정 ID·비밀번호를, 기존 계정에 Invited만 체크하면 초대 완료 안내를 구매자 채팅에 보냅니다.</p>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <a href="https://app.notion.com/p/Spotify-Family-Invitation-Checklist-3edff936cc9b81dda097cc7f352152ed" target="_blank" rel="noreferrer">Spotify 노션 표 열기</a>
        <a href="https://gbuts.com/seller/subscriptions/15557/members" target="_blank" rel="noreferrer">GButs 파티원 보기</a>
        <a href="https://gbuts.com/seller/chats" target="_blank" rel="noreferrer">GButs 채팅 보기</a>
      </div>
    </section>
  </main>;
}
