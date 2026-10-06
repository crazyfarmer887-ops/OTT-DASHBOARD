import { useCallback, useEffect, useState } from 'react';
import { useLocation, useSearch } from 'wouter';
import { REGISTERABLE_OTT_SERVICES, getGeneratedAccountCreationCopy, registeredAccountSalesTargets, type GeneratedAccount } from '../../lib/generated-accounts';
import { buildQuickAccountClipboard } from '../lib/quick-generated-account-flow';

const styles = {
  card: { background: '#fff', border: '1px solid #EDE9FE', borderRadius: 16, padding: 18, marginBottom: 16 },
  input: { display: 'block', width: '100%', boxSizing: 'border-box' as const, padding: 11, border: '1px solid #DDD6FE', borderRadius: 9, margin: '6px 0 14px', fontFamily: 'inherit' },
  button: { border: 0, borderRadius: 10, padding: '11px 14px', background: '#7C3AED', color: '#fff', fontWeight: 800, cursor: 'pointer' },
};
async function requestAccount(url: string, method: string, body: unknown): Promise<GeneratedAccount> {
  const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok || !result.account) throw new Error(result.error || '계정 저장 실패');
  return result.account;
}
function RegisteredAccountCard({ account, onSaved, expanded }: { account: GeneratedAccount; onSaved(account: GeneratedAccount): void; expanded: boolean }) {
  const [, navigate] = useLocation();
  const [expiry, setExpiry] = useState(account.expiryDate || '');
  const [paid, setPaid] = useState(account.paymentStatus === 'paid');
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState('');
  const tvingLoginId = account.serviceType === '티빙+웨이브' ? registeredAccountSalesTargets({ ...account, paymentStatus: 'paid' }).find(target => target.serviceType === '티빙')?.email : '';
  const ready = account.paymentStatus === 'paid' && !!account.expiryDate && account.expiryDate > new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
  const save = async () => {
    setBusy(true); setMessage('');
    try { onSaved(await requestAccount(`/api/generated-accounts/${encodeURIComponent(account.id)}`, 'PATCH', { expiryDate: expiry || null, paymentStatus: paid ? 'paid' : 'pending' })); setMessage('결제·이용 기간을 저장했습니다.'); }
    catch (error) { setMessage(error instanceof Error ? error.message : '저장 실패'); }
    finally { setBusy(false); }
  };
  const write = (service: string, email = account.email) => navigate(`/gbuts-sales?service=${encodeURIComponent(service)}&account=${encodeURIComponent(email)}`);
  return <article style={styles.card}>
    <h3 style={{ fontSize: 16, margin: '0 0 8px' }}>{account.serviceType} · {account.email}</h3>
    <p style={{ fontSize: 13 }}>{account.paymentStatus === 'paid' ? '결제 완료' : '결제 대기'} · {account.expiryDate ? `${account.expiryDate}까지` : '이용 종료일 미입력'}</p>
    <details open={expanded || undefined}>
      <summary style={{ cursor: 'pointer', padding: '8px 0' }}>계정 정보·이용 기간</summary>
      <label>로그인 ID<input style={styles.input} readOnly value={account.email} /></label>
      {tvingLoginId && <label>티빙 로그인 ID<input style={styles.input} readOnly value={tvingLoginId} /></label>}
      <label>비밀번호<input style={styles.input} type="password" readOnly value={account.password} /></label>
      {account.pin && <p style={{ fontSize: 13 }}>이메일 PIN: {account.pin}</p>}
      <button style={styles.button} onClick={async () => {
        try { await navigator.clipboard.writeText(buildQuickAccountClipboard(account) + (tvingLoginId ? `\n티빙 ID: ${tvingLoginId}` : '')); setMessage('계정 정보를 복사했습니다.'); }
        catch { setMessage('복사 권한을 확인하거나 입력 칸에서 직접 복사해주세요.'); }
      }}>계정 정보 복사</button>
      <fieldset disabled={busy} style={{ border: 0, padding: '15px 0 0', margin: 0 }}>
        <label>계정 이용 종료일<input style={styles.input} type="date" value={expiry} onChange={e => setExpiry(e.target.value)} /></label>
        <label style={{ display: 'block', marginBottom: 14 }}><input type="checkbox" checked={paid} onChange={e => setPaid(e.target.checked)} /> OTT 서비스의 실제 결제를 완료했습니다</label>
        <button style={styles.button} onClick={save}>{busy ? '저장 중' : '결제·기간 저장'}</button>
      </fieldset>
      <p style={{ fontSize: 12, color: '#6B7280' }}>계정 가입과 서비스 결제를 마친 뒤 체크하세요. 실제 결제는 각 서비스에서 직접 진행합니다.</p>
    </details>
    {message && <p role="status" style={{ fontSize: 13 }}>{message}</p>}
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
      {registeredAccountSalesTargets(account).map(target => <button key={target.serviceType} style={styles.button} disabled={!ready} onClick={() => write(target.serviceType, target.email)}>{account.serviceType === '티빙+웨이브' ? `${target.serviceType} 판매글 작성` : '판매글 작성'}</button>)}
    </div>
    {!ready && <p style={{ fontSize: 12, color: '#B45309' }}>결제 완료와 앞으로의 이용 종료일을 저장하면 판매를 시작할 수 있습니다.</p>}
  </article>;
}
export default function GbutsAccountsPage() {
  const [, navigate] = useLocation();
  const requestedService = new URLSearchParams(useSearch()).get('service');
  const [service, setService] = useState(REGISTERABLE_OTT_SERVICES.includes(requestedService || '') ? requestedService! : '넷플릭스');
  const [mode, setMode] = useState<'register' | 'generate'>('register');
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [prefix, setPrefix] = useState('');
  const [tvingLoginId, setTvingLoginId] = useState('');
  const [expiry, setExpiry] = useState(''); const [paid, setPaid] = useState(false);
  const [accounts, setAccounts] = useState<GeneratedAccount[]>([]); const [expanded, setExpanded] = useState('');
  const [busy, setBusy] = useState(false); const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(''); const [loadError, setLoadError] = useState('');
  const copy = getGeneratedAccountCreationCopy(service);
  const load = useCallback(async () => {
    setLoading(true); setLoadError('');
    try { const response = await fetch('/api/generated-accounts', { cache: 'no-store' }); const result = await response.json();
      if (!response.ok || !Array.isArray(result.accounts)) throw new Error(result.error || '계정 조회 실패');
      setAccounts(result.accounts.filter((item: GeneratedAccount) => REGISTERABLE_OTT_SERVICES.includes(item.serviceType)));
    } catch (error) { setLoadError(error instanceof Error ? error.message : '계정 조회 실패'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const saved = (account: GeneratedAccount) => setAccounts(previous => [account, ...previous.filter(item => item.id !== account.id)]);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); if (busy) return; setBusy(true); setMessage('');
    try {
      const account = await requestAccount(mode === 'register' ? '/api/generated-accounts/register' : '/api/generated-accounts/create', 'POST',
        mode === 'register' ? { serviceType: service, email, password, tvingLoginId, expiryDate: expiry || null, paymentStatus: paid ? 'paid' : 'pending' } : { serviceType: service, aliasPrefix: prefix });
      saved(account); setExpanded(account.id); setEmail(''); setPassword(''); setTvingLoginId(''); setPrefix(''); setExpiry(''); setPaid(false);
      setMessage(mode === 'register' ? '계정을 추가했습니다. 아래 목록에서 확인하세요.' : '이메일·비밀번호·PIN을 생성했습니다. 이 정보로 OTT 가입·결제를 진행하세요.');
    } catch (error) { setMessage(error instanceof Error ? error.message : '계정 추가 실패'); }
    finally { setBusy(false); }
  };
  return <main style={{ maxWidth: 850, padding: 20, margin: 'auto', color: '#1E1B4B' }}>
    <h1 style={{ fontSize: 24 }}>벗츠 계정 관리</h1>
    <p style={{ fontSize: 13, lineHeight: 1.7 }}>계정 추가 → 가입·결제 확인 → 판매글 작성. 등록한 계정은 그레이태그와 재고를 함께 관리합니다.</p>
    <section style={styles.card}>
      <h2 style={{ fontSize: 18 }}>계정 추가</h2>
      <form onSubmit={submit}><fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0 }}>
        <label>서비스<select style={styles.input} value={service} onChange={e => setService(e.target.value)}>{REGISTERABLE_OTT_SERVICES.map(value => <option key={value}>{value}</option>)}</select></label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
          <button type="button" aria-pressed={mode === 'register'} style={{ ...styles.button, background: mode === 'register' ? '#7C3AED' : '#64748B' }} onClick={() => setMode('register')}>보유 계정 등록</button>
          <button type="button" aria-pressed={mode === 'generate'} style={{ ...styles.button, background: mode === 'generate' ? '#7C3AED' : '#64748B' }} onClick={() => setMode('generate')}>새 이메일·비밀번호 생성</button>
        </div>
        {mode === 'register' ? <>
          <label>{service === '티빙+웨이브' ? '웨이브 이메일' : '로그인 ID / 이메일'}<input autoComplete="off" style={styles.input} required value={email} onChange={e => setEmail(e.target.value)} placeholder="OTT 로그인에 쓰는 ID" /></label>
          {service === '티빙+웨이브' && <label>티빙 로그인 ID<input style={styles.input} required value={tvingLoginId} onChange={e => setTvingLoginId(e.target.value)} placeholder="실제 티빙 로그인 ID" /></label>}
          <label>비밀번호<input autoComplete="new-password" type="password" style={styles.input} required value={password} onChange={e => setPassword(e.target.value)} /></label>
          <label>계정 이용 종료일 (나중에 입력 가능)<input style={styles.input} type="date" value={expiry} onChange={e => setExpiry(e.target.value)} /></label>
          <label style={{ display: 'block', marginBottom: 16 }}><input type="checkbox" checked={paid} onChange={e => setPaid(e.target.checked)} /> OTT 서비스의 실제 결제를 완료했습니다</label>
          {service === '티빙+웨이브' && <p style={{ fontSize: 12 }}>웨이브 이메일과 티빙 로그인 ID를 각각 입력하세요. 두 서비스의 비밀번호가 다르면 각각 등록하세요.</p>}
        </> : <>
          <label>이메일 앞부분 (선택)<input style={styles.input} value={prefix} onChange={e => setPrefix(e.target.value)} placeholder={copy.prefixPlaceholder} /></label>
          <p style={{ fontSize: 12, lineHeight: 1.6 }}>{copy.prefixHelp}</p>
          <p style={{ fontSize: 12 }}>이메일·비밀번호·PIN을 준비합니다. OTT 서비스 가입과 결제는 직접 완료해주세요.</p>
        </>}
        <button style={styles.button} type="submit">{busy ? '처리 중…' : mode === 'register' ? '계정 추가' : '바로 생성'}</button>
      </fieldset></form>
      {message && <p role="status" style={{ lineHeight: 1.6 }}>{message}</p>}
    </section>
    <h2 style={{ fontSize: 18 }}>등록한 계정 {accounts.length}개</h2>
    <button style={styles.button} disabled={loading || busy} onClick={load}>{loading ? '조회 중' : '목록 새로고침'}</button>
    {loadError && <p role="alert">{loadError}</p>}
    {!loading && !loadError && accounts.length === 0 && <p>아직 등록한 계정이 없습니다. 위에서 계정을 먼저 추가하세요.</p>}
    <div style={{ marginTop: 16 }}>{accounts.map(account => <RegisteredAccountCard key={account.id} account={account} onSaved={saved} expanded={expanded === account.id} />)}</div>
    <p style={{ fontSize: 13 }}>스포티파이는 기존 <button style={styles.button} onClick={() => navigate('/spotify-invites')}>Spotify 초대 관리</button>에서 처리합니다.</p>
  </main>;
}
