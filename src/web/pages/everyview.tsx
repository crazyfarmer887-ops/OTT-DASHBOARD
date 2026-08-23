import { useEffect, useState } from "react";

/**
 * 에브리뷰 파티 관리 — 그레이태그 manage.tsx의 에브리뷰 로컬라이즈 버전
 *
 * 그레이태그와 동일한 개념 매핑:
 * - 계정 카드      → 에브리뷰 파티 (파티ID 기반, 공유계정 이메일 비노출)
 * - 이용중 파티원  → 파티 슬롯의 참여중 멤버
 * - 빈자리/모집중  → emptySlots (모집 ON/OFF는 recruitCnt)
 * - 계정 ID/PW     → 파티별 로그인 정보 (updateLoginInfo)
 *
 * 차이(로컬라이징):
 * - 판매글(OnSale) 개념 없음 → 모집중 슬롯으로 대체
 * - 정산은 getSettlementHistory 별도 조회
 * - 세션 만료 시 쿠키 수동 import 필요 (구글 IP차단으로 자동재로그인 불가)
 */

interface EvParty {
  partyId: number;
  partyType: 'free' | 'general';
  title: string;
  serviceCode: string | null;
  serviceName: string | null;
}

interface EvMember {
  memberId: string;
  productUsid: string;
  name: string | null;
  profileName: string | null;
  status: string;
  statusName: string;
  startDateTime: string | null;
  endDateTime: string | null;
  remainderDays: number;
}

interface EvAccount {
  email: string;
  serviceType: string;
  members: EvMember[];
  usingCount: number;
  activeCount: number;
  totalSlots: number;
  keepPasswd?: string;
  expiryDate?: string | null;
  partyId: number;
  partyType: 'free' | 'general';
  title: string;
  expectedSettlement?: number;
  expectedSettlementLabel?: string | null;
  settlementPeriod?: string | null;
  depositDate?: string | null;
}

interface EvService {
  serviceType: string;
  accounts: EvAccount[];
  totalUsingMembers: number;
  totalActiveMembers: number;
}

interface EvManagement {
  provider: 'everyview';
  services: EvService[];
  parties: EvParty[];
  summary: {
    totalUsingMembers: number;
    totalActiveMembers: number;
    totalIncome: number;
    totalRealized: number;
    totalAccounts: number;
  };
  updatedAt: string;
}

const CARD = '#FFFFFF', INK = '#191622', MUTED = '#716D80', LINE = '#E6E2DA',
  GREEN = '#10B981', RED = '#EF4444', VIOLET = '#7C3AED';

function fmtDate(iso: string | null): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '-';
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

export default function EveryviewPage() {
  const [mgmt, setMgmt] = useState<EvManagement | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cookieExpired, setCookieExpired] = useState(false);
  const [cookieInput, setCookieInput] = useState('');
  const [importing, setImporting] = useState(false);
  const [sessionStatus, setSessionStatus] = useState<any>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [editing, setEditing] = useState<{ partyId: number; svcId: number; shareType: string; accountId: string; accountPassword: string; sharingDescription: string; additionalInfo: string } | null>(null);
  const [savingLogin, setSavingLogin] = useState(false);
  const [invites, setInvites] = useState<Record<string, string[]> | null>(null);
  const [loadingInvites, setLoadingInvites] = useState(false);
  const [recruitEditing, setRecruitEditing] = useState<{ partyId: number; value: number } | null>(null);
  const [savingRecruit, setSavingRecruit] = useState(false);
  const [showWrite, setShowWrite] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createResult, setCreateResult] = useState<{ ok: boolean; msg: string; partyId?: number } | null>(null);
  const [wForm, setWForm] = useState<{
    recruitTitle: string; recruitInfo: string; disallowRules: string;
    paymentType: 'PERIOD' | 'RECURRING'; monthFee: string; dailyFee: string; endDate: string; slots: number;
    serviceCode: string; serviceNameDirect: string; shareType: 'ACCOUNT' | 'INVITE' | 'OTHER';
    userId: string; userPassword: string; sharingDescription: string; additionalInfo: string;
  }>({
    recruitTitle: '', recruitInfo: '', disallowRules: '※ 개인 사정으로 중도 환불 불가\n※ 비번이나 계정 정보 변경 시, 강제 탈퇴 조치\n※ 본인 프로필 외 타인 프로필 사용 불가',
    paymentType: 'PERIOD', monthFee: '', dailyFee: '', endDate: '', slots: 2,
    serviceCode: 'youtube', serviceNameDirect: '', shareType: 'ACCOUNT',
    userId: '', userPassword: '', sharingDescription: '', additionalInfo: '',
  });

  const submitCreateParty = () => {
    if (creating) return;
    if (!confirm('파티를 개설할까요? 에브리뷰에 실제 등록돼요.')) return;
    setCreating(true); setCreateResult(null);
    const svcName = wForm.serviceCode === 'direct' ? wForm.serviceNameDirect : ({ youtube: '유튜브', netflix: '넷플릭스', tving: '티빙', disney_plus: '디즈니+', wavve: '웨이브', laftel: '라프텔', watcha: '왓챠', apple: '애플', coupang: '쿠팡플레이', chatgpt: 'ChatGPT', google: 'Google AI', prime_video: '프라임비디오', ms365: 'MS오피스365', spotify: '스포티파이' } as Record<string, string>)[wForm.serviceCode] || wForm.serviceCode;
    const monthlyFee = parseInt(wForm.monthFee.replace(/[^0-9]/g, '') || '0', 10);
    const dailyFee = wForm.paymentType === 'PERIOD'
      ? parseInt(wForm.dailyFee.replace(/[^0-9]/g, '') || String(Math.round(monthlyFee / 30)), 10)
      : Math.round(monthlyFee / 30);
    fetch('/api/everyview/create-party', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recruitTitle: wForm.recruitTitle,
        recruitInfo: wForm.recruitInfo,
        disallowRules: wForm.disallowRules.split('\n').map(s => s.trim()).filter(Boolean),
        paymentType: wForm.paymentType,
        oneDayUsageFee: dailyFee,
        monthUsageFee: monthlyFee,
        shareEndDate: wForm.paymentType === 'PERIOD' ? wForm.endDate || null : null,
        shareUserCnt: wForm.slots,
        services: [{
          serviceCode: wForm.serviceCode, serviceName: svcName,
          serviceOptionCode: 'direct', serviceOptionName: '',
          shareType: wForm.shareType,
          userId: wForm.userId, userPassword: wForm.userPassword,
          sharingDescription: wForm.sharingDescription, additionalInfo: wForm.additionalInfo,
        }],
      }),
    })
      .then(async r => {
        const d = await r.json() as any;
        if (!r.ok) throw new Error(d.error || '등록 실패');
        setCreateResult({ ok: true, msg: `파티 #${d.partyId} 개설 완료!`, partyId: d.partyId });
        loadManagement(true);
      })
      .catch(e => setCreateResult({ ok: false, msg: e.message }))
      .finally(() => setCreating(false));
  };

  const fetchSessionStatus = () => {
    fetch('/api/everyview/session/status').then(r => r.json()).then(setSessionStatus).catch(() => {});
  };

  const loadManagement = (refresh = false) => {
    setLoading(true); setError(null); setCookieExpired(false);
    fetch(`/api/everyview/management${refresh ? '?refresh=1' : ''}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      .then(async r => {
        const json = await r.json() as any;
        if (!r.ok) {
          if (json?.code === 'COOKIE_EXPIRED') setCookieExpired(true);
          throw new Error(json?.error || '조회 실패');
        }
        setMgmt(json);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchSessionStatus(); loadManagement(); }, []);

  const importCookies = async () => {
    if (!cookieInput.trim()) return;
    setImporting(true);
    try {
      let payload: any;
      try {
        payload = JSON.parse(cookieInput.trim());
        if (Array.isArray(payload)) {
          payload = payload.filter((c: any) => c?.name && c?.value).map((c: any) => ({ name: c.name, value: c.value }));
          const hasSession = payload.some((c: any) => c.name === 'JSESSIONID');
          if (!hasSession) throw new Error('no JSESSIONID');
        }
      } catch {
        // 문자열 형태 허용: "JSESSIONID=..."
        payload = cookieInput.trim();
      }
      const res = await fetch('/api/everyview/session/cookies/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const json = await res.json() as any;
      if (!res.ok || !json.ok) throw new Error(json?.error || '등록 실패');
      setCookieInput('');
      setCookieExpired(false);
      fetchSessionStatus();
      loadManagement(true);
    } catch (e: any) {
      alert(e.message || '쿠키 등록 실패');
    } finally { setImporting(false); }
  };

  const saveLoginInfo = async () => {
    if (!editing) return;
    setSavingLogin(true);
    try {
      const loginData = [{
        id: editing.svcId,
        shareType: editing.shareType,
        accountId: editing.shareType === 'ACCOUNT' ? editing.accountId : null,
        accountPassword: editing.shareType === 'ACCOUNT' ? editing.accountPassword : null,
        sharingDescription: editing.shareType !== 'ACCOUNT' ? editing.sharingDescription : '',
        additionalInfo: editing.additionalInfo,
      }];
      const res = await fetch('/api/everyview/update-login-info', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ partyId: editing.partyId, loginData }) });
      const json = await res.json() as any;
      if (!res.ok) throw new Error(json?.error || '저장 실패');
      setEditing(null);
      loadManagement(true);
    } catch (e: any) {
      alert(e.message || '저장 실패');
    } finally { setSavingLogin(false); }
  };

  const healthy = sessionStatus?.isHealthy;

  return (
    <div style={{ padding: '14px 14px 90px', maxWidth: 720, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 900, letterSpacing: '-.02em' }}>에브리뷰 관리</div>
          <div style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>everyview.kr 내가 개설한 파티</div>
        </div>
        <button onClick={() => { fetchSessionStatus(); loadManagement(true); }} disabled={loading}
          style={{ background: VIOLET, color: '#fff', border: 'none', borderRadius: 10, padding: '8px 14px', fontWeight: 800, fontSize: 12, cursor: loading ? 'wait' : 'pointer', opacity: loading ? .5 : 1 }}>
          새로고침
        </button>
      </div>

      {/* ─── 세션 상태 배너 (그레이태그 manage 배너 대응) ─── */}
      <div style={{
        background: healthy ? '#ECFDF5' : '#FFF0F0', borderRadius: 12, padding: '10px 14px', marginBottom: 12,
        borderLeft: `4px solid ${healthy ? GREEN : RED}`,
      }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: healthy ? '#059669' : '#991B1B' }}>
          {healthy ? '✅ 에브리뷰 세션 정상' : '⚠️ 에브리뷰 세션 확인 필요'}
          {sessionStatus?.elapsedSinceCheck !== undefined && (
            <span style={{ fontWeight: 500, color: MUTED, marginLeft: 6 }}>
              ({sessionStatus.elapsedSinceCheck < 60 ? '방금 전' : `${Math.floor(sessionStatus.elapsedSinceCheck / 60)}분 전`} 확인)
            </span>
          )}
        </div>
        {sessionStatus?.detail && <div style={{ fontSize: 11, color: MUTED, marginTop: 3 }}>{sessionStatus.detail}</div>}
      </div>

      {/* ─── 쿠키 만료 / 수동 등록 ─── */}
      {(cookieExpired || !healthy) && (
        <div style={{ background: '#fff', borderRadius: 12, border: `1px solid ${LINE}`, padding: 14, marginBottom: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 4 }}>에브리뷰 쿠키 등록</div>
          <div style={{ fontSize: 11, color: MUTED, marginBottom: 8 }}>
            everyview.kr 로그인 → F12 → Application → Cookies → 전체 복사해서 붙여넣기<br />
            (JSON 배열, {"{JSESSIONID: \"...\"}"} 객체, 또는 "JSESSIONID=..." 문자열 모두 지원)
          </div>
          <textarea value={cookieInput} onChange={e => setCookieInput(e.target.value)} rows={3}
            placeholder='JSESSIONID=3D1C... 또는 [{"name":"JSESSIONID","value":"..."},...]'
            style={{ width: '100%', boxSizing: 'border-box', border: `1px solid ${LINE}`, borderRadius: 8, padding: 8, fontSize: 11, fontFamily: 'monospace', resize: 'vertical' }} />
          <button onClick={importCookies} disabled={importing || !cookieInput.trim()}
            style={{ marginTop: 8, background: VIOLET, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontWeight: 800, fontSize: 12, cursor: 'pointer', opacity: importing || !cookieInput.trim() ? .5 : 1 }}>
            {importing ? '등록 중...' : '쿠키 등록'}
          </button>
        </div>
      )}

      {/* ─── 글 작성 (파티 개설) ─── */}
      <button onClick={() => setShowWrite(s => !s)}
        style={{ width: '100%', background: VIOLET, color: '#fff', border: 'none', borderRadius: 12, padding: '12px 0', fontWeight: 800, fontSize: 13, cursor: 'pointer', marginBottom: 12 }}>
        {showWrite ? '✕ 글 작성 닫기' : '✏️ 새 파티 글 작성'}
      </button>

      {showWrite && (
        <div style={{ background: '#fff', borderRadius: 14, border: `1px solid ${LINE}`, padding: 16, marginBottom: 14 }}>
          <div style={{ fontSize: 15, fontWeight: 900, marginBottom: 12 }}>✏️ 새 파티 글 작성</div>
          {createResult && (
            <div style={{ background: createResult.ok ? '#ECFDF5' : '#FFF0F0', color: createResult.ok ? '#059669' : '#991B1B', borderRadius: 10, padding: 10, fontSize: 12, fontWeight: 700, marginBottom: 12 }}>
              {createResult.msg}
            </div>
          )}

          {/* 서비스 선택 */}
          <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>공유 서비스</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
            {(['youtube', 'netflix', 'tving', 'disney_plus', 'wavve', 'watcha', 'coupang', 'chatgpt', 'spotify', 'direct'] as const).map(code => {
              const label = code === 'direct' ? '직접입력' : ({ youtube: '유튜브', netflix: '넷플릭스', tving: '티빙', disney_plus: '디즈니+', wavve: '웨이브', watcha: '왓챠', coupang: '쿠팡플레이', chatgpt: 'ChatGPT', spotify: '스포티파이' } as Record<string, string>)[code];
              const active = wForm.serviceCode === code;
              return (
                <button key={code} onClick={() => setWForm(f => ({ ...f, serviceCode: code }))}
                  style={{ padding: '6px 12px', borderRadius: 999, border: `1px solid ${active ? VIOLET : LINE}`, background: active ? '#F5F3FF' : '#fff', color: active ? VIOLET : MUTED, fontWeight: active ? 800 : 600, fontSize: 11, cursor: 'pointer' }}>
                  {label}
                </button>
              );
            })}
          </div>
          {wForm.serviceCode === 'direct' && (
            <input value={wForm.serviceNameDirect} onChange={e => setWForm(f => ({ ...f, serviceNameDirect: e.target.value }))}
              placeholder="공유할 서비스명 직접 입력 (최대 100자)" maxLength={100}
              style={{ width: '100%', boxSizing: 'border-box', border: `1px solid ${LINE}`, borderRadius: 8, padding: '9px 10px', fontSize: 13, marginBottom: 10 }} />
          )}

          {/* 공유방식 */}
          <div style={{ fontSize: 12, fontWeight: 700, margin: '10px 0 6px' }}>공유방식</div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            {([['ACCOUNT', '아이디/비번'], ['INVITE', '초대'], ['OTHER', '기타']] as const).map(([v, label]) => (
              <button key={v} onClick={() => setWForm(f => ({ ...f, shareType: v }))}
                style={{ flex: 1, padding: '8px 0', borderRadius: 8, border: `1px solid ${wForm.shareType === v ? VIOLET : LINE}`, background: wForm.shareType === v ? '#F5F3FF' : '#fff', color: wForm.shareType === v ? VIOLET : MUTED, fontWeight: 800, fontSize: 11, cursor: 'pointer' }}>
                {label}
              </button>
            ))}
          </div>
          {wForm.shareType === 'ACCOUNT' ? (
            <>
              <input value={wForm.userId} onChange={e => setWForm(f => ({ ...f, userId: e.target.value }))} placeholder="아이디를 입력해주세요" maxLength={200}
                style={{ width: '100%', boxSizing: 'border-box', border: `1px solid ${LINE}`, borderRadius: 8, padding: '9px 10px', fontSize: 13, marginBottom: 8 }} />
              <input value={wForm.userPassword} onChange={e => setWForm(f => ({ ...f, userPassword: e.target.value }))} placeholder="비밀번호를 입력해주세요" maxLength={200}
                style={{ width: '100%', boxSizing: 'border-box', border: `1px solid ${LINE}`, borderRadius: 8, padding: '9px 10px', fontSize: 13 }} />
            </>
          ) : (
            <input value={wForm.sharingDescription} onChange={e => setWForm(f => ({ ...f, sharingDescription: e.target.value }))} placeholder="(ex) 파티 참여 후, 초대 계정 정보를 채팅창으로 보내주세요." maxLength={300}
              style={{ width: '100%', boxSizing: 'border-box', border: `1px solid ${LINE}`, borderRadius: 8, padding: '9px 10px', fontSize: 13 }} />
          )}
          <textarea value={wForm.additionalInfo} onChange={e => setWForm(f => ({ ...f, additionalInfo: e.target.value }))} rows={2}
            placeholder="접속방법 / 성인인증 방법 / 주의사항 등 (선택)" maxLength={1500}
            style={{ width: '100%', boxSizing: 'border-box', border: `1px solid ${LINE}`, borderRadius: 8, padding: 9, fontSize: 12, marginTop: 8, resize: 'vertical' }} />

          {/* 요금 */}
          <div style={{ fontSize: 12, fontWeight: 700, margin: '14px 0 6px' }}>요금</div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            <button onClick={() => setWForm(f => ({ ...f, paymentType: 'PERIOD' }))}
              style={{ flex: 1, padding: '8px 0', borderRadius: 8, border: `1px solid ${wForm.paymentType === 'PERIOD' ? VIOLET : LINE}`, background: wForm.paymentType === 'PERIOD' ? '#F5F3FF' : '#fff', color: wForm.paymentType === 'PERIOD' ? VIOLET : MUTED, fontWeight: 800, fontSize: 11, cursor: 'pointer' }}>
              기간 공유
            </button>
            <button onClick={() => setWForm(f => ({ ...f, paymentType: 'RECURRING' }))}
              style={{ flex: 1, padding: '8px 0', borderRadius: 8, border: `1px solid ${wForm.paymentType === 'RECURRING' ? VIOLET : LINE}`, background: wForm.paymentType === 'RECURRING' ? '#F5F3FF' : '#fff', color: wForm.paymentType === 'RECURRING' ? VIOLET : MUTED, fontWeight: 800, fontSize: 11, cursor: 'pointer' }}>
              정기 결제 (월 단위)
            </button>
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, color: MUTED, marginBottom: 4 }}>월 요금 (원)</div>
              <input inputMode="numeric" value={wForm.monthFee} onChange={e => setWForm(f => ({ ...f, monthFee: e.target.value }))} placeholder="예: 5000"
                style={{ width: '100%', boxSizing: 'border-box', border: `1px solid ${LINE}`, borderRadius: 8, padding: '9px 10px', fontSize: 13 }} />
            </div>
            {wForm.paymentType === 'PERIOD' && (
              <>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, color: MUTED, marginBottom: 4 }}>종료일</div>
                  <input type="date" value={wForm.endDate} onChange={e => setWForm(f => ({ ...f, endDate: e.target.value }))}
                    style={{ width: '100%', boxSizing: 'border-box', border: `1px solid ${LINE}`, borderRadius: 8, padding: '8px 10px', fontSize: 13 }} />
                </div>
                <div style={{ width: 90 }}>
                  <div style={{ fontSize: 11, color: MUTED, marginBottom: 4 }}>모집 인원</div>
                  <input type="number" min={1} max={20} value={wForm.slots} onChange={e => setWForm(f => ({ ...f, slots: Math.max(1, Math.min(20, parseInt(e.target.value || '1', 10) || 1)) }))}
                    style={{ width: '100%', boxSizing: 'border-box', border: `1px solid ${LINE}`, borderRadius: 8, padding: '9px 10px', fontSize: 13 }} />
                </div>
              </>
            )}
          </div>

          {/* 모집공고 */}
          <div style={{ fontSize: 12, fontWeight: 700, margin: '14px 0 6px' }}>모집 제목 (최대 25자)</div>
          <input value={wForm.recruitTitle} onChange={e => setWForm(f => ({ ...f, recruitTitle: e.target.value }))} maxLength={25}
            placeholder="예) 유튜브 프리미엄 4인 팟"
            style={{ width: '100%', boxSizing: 'border-box', border: `1px solid ${LINE}`, borderRadius: 8, padding: '9px 10px', fontSize: 13 }} />
          <div style={{ fontSize: 12, fontWeight: 700, margin: '10px 0 6px' }}>파티 소개 (최대 1000자)</div>
          <textarea value={wForm.recruitInfo} onChange={e => setWForm(f => ({ ...f, recruitInfo: e.target.value }))} rows={4} maxLength={1000}
            placeholder="사용자가 파티 참여를 결정할 수 있는 상세 정보를 작성해주세요."
            style={{ width: '100%', boxSizing: 'border-box', border: `1px solid ${LINE}`, borderRadius: 8, padding: 9, fontSize: 12, resize: 'vertical' }} />
          <div style={{ fontSize: 12, fontWeight: 700, margin: '10px 0 6px' }}>금지사항 (줄바꿈으로 구분)</div>
          <textarea value={wForm.disallowRules} onChange={e => setWForm(f => ({ ...f, disallowRules: e.target.value }))} rows={3}
            style={{ width: '100%', boxSizing: 'border-box', border: `1px solid ${LINE}`, borderRadius: 8, padding: 9, fontSize: 12, resize: 'vertical' }} />

          <button onClick={submitCreateParty} disabled={creating || !wForm.recruitTitle.trim()}
            style={{ marginTop: 14, width: '100%', background: creating || !wForm.recruitTitle.trim() ? '#C4B5FD' : VIOLET, color: '#fff', border: 'none', borderRadius: 10, padding: '12px 0', fontWeight: 800, fontSize: 13, cursor: creating ? 'wait' : 'pointer' }}>
            {creating ? '등록 중…' : '🚀 개설하기'}
          </button>
        </div>
      )}

      {loading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[1, 2, 3].map(i => <div key={i} style={{ background: '#fff', borderRadius: 14, height: 76, opacity: .5 }} />)}
        </div>
      )}

      {error && !loading && (
        <div style={{ background: '#FFF0F0', color: '#991B1B', borderRadius: 12, padding: 14, fontSize: 13, fontWeight: 600 }}>{error}</div>
      )}

      {/* ─── 요약 배너 (그레이태그 전체 현황 대응) ─── */}
      {mgmt && !loading && (
        <>
          <div style={{ background: 'linear-gradient(135deg, #34D399 0%, #059669 100%)', borderRadius: 16, padding: '14px 18px', marginBottom: 12, color: '#fff' }}>
            <div style={{ fontSize: 11, opacity: .85, marginBottom: 8 }}>전체 현황</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 6, textAlign: 'center' }}>
              {[
                { label: '내 파티', value: `${mgmt.summary.totalAccounts}개` },
                { label: '이용중 파티원', value: `${mgmt.summary.totalUsingMembers}명` },
                { label: '서비스', value: `${mgmt.services.length}종` },
              ].map(s => (
                <div key={s.label}>
                  <div style={{ fontSize: 18, fontWeight: 900 }}>{s.value}</div>
                  <div style={{ fontSize: 10, opacity: .85 }}>{s.label}</div>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 9.5, opacity: .7, marginTop: 8, textAlign: 'right' }}>업데이트 {fmtDate(mgmt.updatedAt)}</div>
          </div>

          {/* ─── 서비스별 파티 카드 (그레이태그 서비스 그룹핑 대응) ─── */}
          {mgmt.services.map(sv => (
            <div key={sv.serviceType} style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 900, marginBottom: 8 }}>
                {sv.serviceType}
                <span style={{ fontSize: 11, color: MUTED, fontWeight: 600, marginLeft: 8 }}>{sv.accounts.length}개 파티 · 이용중 {sv.totalUsingMembers}명</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {sv.accounts.map(acct => {
                  const partyIdStr = String(acct.partyId || acct.email.replace('everyview:', ''));
                  const open = !!expanded[partyIdStr];
                  const firstMemberEnd = acct.members[0]?.endDateTime ?? null;
                  return (
                    <div key={acct.email} style={{ background: CARD, borderRadius: 14, border: `1px solid ${LINE}`, overflow: 'hidden' }}>
                      <button onClick={() => setExpanded(p => ({ ...p, [partyIdStr]: !open }))}
                        style={{ width: '100%', background: 'none', border: 'none', textAlign: 'left', padding: '12px 14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 14, fontWeight: 800, color: INK }}>
                            파티 #{partyIdStr}
                            <span style={{ marginLeft: 7, fontSize: 9, padding: '2px 6px', borderRadius: 999, background: acct.partyType === 'general' ? '#E0F2FE' : '#F5F3FF', color: acct.partyType === 'general' ? '#0369A1' : VIOLET }}>
                              {acct.partyType === 'general' ? '에브리뷰 관리형' : '자유파티'}
                            </span>
                          </div>
                          <div style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>
                            이용중 {acct.usingCount}/{acct.totalSlots}
                            {firstMemberEnd && <> · 종료 {fmtDate(firstMemberEnd)}</>}
                            {acct.expiryDate && acct.members[0]?.remainderDays !== undefined && (
                              <span style={{ color: acct.members[0].remainderDays <= 7 ? RED : MUTED, marginLeft: 4 }}>
                                (D-{acct.members[0].remainderDays})
                              </span>
                            )}
                          </div>
                        </div>
                        <span style={{
                          fontSize: 10, fontWeight: 800, padding: '4px 10px', borderRadius: 999,
                          background: acct.usingCount > 0 ? '#ECFDF5' : '#F3F4F6',
                          color: acct.usingCount > 0 ? '#059669' : MUTED,
                        }}>{open ? '접기' : '상세'}</span>
                      </button>

                      {open && (
                        <div style={{ borderTop: `1px solid ${LINE}`, padding: '10px 14px 14px' }}>
                          {/* 파티원 목록 */}
                          <div style={{ fontSize: 11, fontWeight: 800, color: MUTED, marginBottom: 6 }}>파티원</div>
                          {acct.members.length === 0 && (
                            <div style={{ fontSize: 12, color: MUTED, padding: '6px 0 10px' }}>참여중인 파티원이 없어요 (모집중)</div>
                          )}
                          {acct.members.map((m, i) => (
                            <div key={m.memberId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderBottom: i < acct.members.length - 1 ? `1px dashed ${LINE}` : 'none' }}>
                              <div>
                                <span style={{ fontSize: 13, fontWeight: 700, color: INK }}>{m.profileName || m.name || '(미확인)'}</span>
                                <span style={{ fontSize: 10, color: MUTED, marginLeft: 8 }}>{m.statusName}</span>
                              </div>
                              <div style={{ fontSize: 11, color: m.endDateTime && m.remainderDays <= 7 ? RED : MUTED }}>
                                {m.endDateTime ? <>~ {fmtDate(m.endDateTime)} {m.remainderDays > 0 && `(D-${m.remainderDays})`}</> : <>참여 {fmtDate(m.startDateTime)}</>}
                              </div>
                            </div>
                          ))}

                          {acct.partyType === 'general' && (
                            <div style={{ marginTop: 10, background: '#F0F9FF', border: '1px solid #BAE6FD', borderRadius: 10, padding: 10 }}>
                              <div style={{ fontSize: 11, fontWeight: 800, color: '#0369A1' }}>에브리뷰 관리형 파티</div>
                              <div style={{ fontSize: 11, color: MUTED, marginTop: 4 }}>초대·프로필은 에브리뷰가 직접 관리해요. 결제 상태만 유지하면 됩니다.</div>
                              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 12 }}>
                                <span>{acct.settlementPeriod || '정산기간 확인 중'}</span>
                                <strong style={{ color: '#0369A1' }}>{acct.expectedSettlementLabel || `${(acct.expectedSettlement || 0).toLocaleString()}원`}</strong>
                              </div>
                              {acct.depositDate && <div style={{ textAlign: 'right', fontSize: 10, color: MUTED, marginTop: 3 }}>입금일 {acct.depositDate}</div>}
                              {/* 초대메일 보기 — 요청 시에만 조회/노출 */}
                              <button
                                onClick={() => {
                                  if (invites) { setInvites(null); return; }
                                  setLoadingInvites(true);
                                  fetch('/api/everyview/party-detail', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ partyId: Number(partyIdStr) }) })
                                    .then(r => r.json())
                                    .then((d: any) => {
                                      const emails: string[] = (d?.party?.members || []).map((m: any) => m.inviteEmail).filter(Boolean);
                                      if (!emails.length) throw new Error('초대메일을 찾을 수 없어요');
                                      setInvites({ [partyIdStr]: emails });
                                    })
                                    .catch(e => alert(e.message))
                                    .finally(() => setLoadingInvites(false));
                                }}
                                style={{ marginTop: 8, width: '100%', background: '#fff', color: '#0369A1', border: '1px solid #BAE6FD', borderRadius: 8, padding: '7px 0', fontWeight: 800, fontSize: 11, cursor: 'pointer' }}>
                                {loadingInvites ? '조회 중…' : invites ? '초대메일 숨기기' : '✉️ 초대메일 보기'}
                              </button>
                              {invites?.[partyIdStr]?.map((email, i) => (
                                <div key={i} onClick={() => { navigator.clipboard.writeText(email).catch(() => {}); alert('복사됐어요'); }}
                                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 5, background: '#fff', border: '1px dashed #93C5FD', borderRadius: 8, padding: '6px 9px', cursor: 'pointer' }}>
                                  <span style={{ fontSize: 11, color: INK }}>{email}</span>
                                  <span style={{ fontSize: 10, color: MUTED }}>탭하여 복사</span>
                                </div>
                              ))}
                            </div>
                          )}

                          {/* 자유파티 모집 인원 변경 */}
                          {acct.partyType === 'free' && (
                            recruitEditing?.partyId === Number(partyIdStr) ? (
                              <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                                <input type="number" min={0} max={20} value={recruitEditing.value}
                                  onChange={e => setRecruitEditing({ partyId: Number(partyIdStr), value: parseInt(e.target.value || '0', 10) })}
                                  style={{ flex: 1, boxSizing: 'border-box', border: `1px solid ${LINE}`, borderRadius: 8, padding: '8px 10px', fontSize: 13 }} />
                                <button disabled={savingRecruit}
                                  onClick={() => {
                                    setSavingRecruit(true);
                                    fetch('/api/everyview/update-recruit-cnt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ partyId: recruitEditing.partyId, recruitCnt: recruitEditing.value }) })
                                      .then(r => r.json())
                                      .then(d => { if (d.error) throw new Error(d.error); loadManagement(true); })
                                      .then(() => setRecruitEditing(null))
                                      .catch(e => alert(e.message))
                                      .finally(() => setSavingRecruit(false));
                                  }}
                                  style={{ background: VIOLET, color: '#fff', border: 'none', borderRadius: 8, padding: '0 14px', fontWeight: 800, fontSize: 12, cursor: 'pointer' }}>
                                  {savingRecruit ? '저장 중…' : '저장'}
                                </button>
                                <button onClick={() => setRecruitEditing(null)}
                                  style={{ background: '#F3F4F6', color: MUTED, border: 'none', borderRadius: 8, padding: '0 14px', fontWeight: 800, fontSize: 12, cursor: 'pointer' }}>
                                  취소
                                </button>
                              </div>
                            ) : (
                              <button onClick={() => setRecruitEditing({ partyId: Number(partyIdStr), value: acct.totalSlots - acct.usingCount })}
                                style={{ marginTop: 10, width: '100%', background: '#F9FAFB', color: MUTED, border: `1px solid ${LINE}`, borderRadius: 10, padding: '8px 0', fontWeight: 700, fontSize: 11, cursor: 'pointer' }}>
                                👥 모집 인원 변경 (현재 빈자리 {acct.totalSlots - acct.usingCount})
                              </button>
                            )
                          )}

                          {/* 자유파티만 로그인 정보 수정 — 검증파티는 에브리뷰가 관리 */}
                          {acct.partyType === 'free' && <button
                            onClick={() => {
                              // 상세 재조회 후 편집 모달 구성 — 여기선 keeper 쿠키로 즉시 조회
                              fetch('/api/everyview/party-detail', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ partyId: Number(partyIdStr) }) })
                                .then(r => r.json())
                                .then((d: any) => {
                                  const li = d?.party?.loginInfo?.[0];
                                  if (!li) throw new Error('로그인 정보를 찾을 수 없어요');
                                  setEditing({
                                    partyId: Number(partyIdStr),
                                    svcId: li.svcId,
                                    shareType: li.shareType,
                                    accountId: li.accountId || '',
                                    accountPassword: li.accountPassword || '',
                                    sharingDescription: li.sharingDescription || '',
                                    additionalInfo: li.additionalInfo || '',
                                  });
                                })
                                .catch(e => alert(e.message));
                            }}
                            style={{ marginTop: 10, width: '100%', background: '#F5F3FF', color: VIOLET, border: `1px solid #DDD6FE`, borderRadius: 10, padding: '9px 0', fontWeight: 800, fontSize: 12, cursor: 'pointer' }}>
                            🔑 로그인 정보 변경
                          </button>}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          {mgmt.services.length === 0 && !loading && (
            <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 14, padding: 24, textAlign: 'center', color: MUTED, fontSize: 13 }}>
              개설한 에브리뷰 파티가 없거나(일반파티), 아직 조회 전이에요.
            </div>
          )}
        </>
      )}

      {/* ─── 로그인 정보 편집 모달 ─── */}
      {editing && (
        <div onClick={e => { if (e.target === e.currentTarget) setEditing(null); }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(25,22,34,.45)', zIndex: 1000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
          <div style={{ background: '#fff', width: '100%', maxWidth: 480, borderRadius: '18px 18px 0 0', padding: '18px 18px calc(18px + env(safe-area-inset-bottom))' }}>
            <div style={{ fontSize: 15, fontWeight: 900, marginBottom: 12 }}>🔑 로그인 정보 변경 — 파티 #{editing.partyId}</div>

            {editing.shareType === 'ACCOUNT' ? (
              <>
                <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>아이디</div>
                <input value={editing.accountId} onChange={e => setEditing(ed => ed ? { ...ed, accountId: e.target.value } : ed)}
                  style={{ width: '100%', boxSizing: 'border-box', border: `1px solid ${LINE}`, borderRadius: 8, padding: '9px 10px', fontSize: 13, marginBottom: 10 }} />
                <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>비밀번호</div>
                <input value={editing.accountPassword} onChange={e => setEditing(ed => ed ? { ...ed, accountPassword: e.target.value } : ed)}
                  style={{ width: '100%', boxSizing: 'border-box', border: `1px solid ${LINE}`, borderRadius: 8, padding: '9px 10px', fontSize: 13 }} />
              </>
            ) : (
              <>
                <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>공유방식 설명</div>
                <input value={editing.sharingDescription} onChange={e => setEditing(ed => ed ? { ...ed, sharingDescription: e.target.value } : ed)}
                  style={{ width: '100%', boxSizing: 'border-box', border: `1px solid ${LINE}`, borderRadius: 8, padding: '9px 10px', fontSize: 13 }} />
              </>
            )}
            <div style={{ fontSize: 12, fontWeight: 700, margin: '10px 0 4px' }}>추가 이용 정보</div>
            <textarea value={editing.additionalInfo} onChange={e => setEditing(ed => ed ? { ...ed, additionalInfo: e.target.value } : ed)} rows={3}
              style={{ width: '100%', boxSizing: 'border-box', border: `1px solid ${LINE}`, borderRadius: 8, padding: 9, fontSize: 12, resize: 'vertical' }} />

            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button onClick={() => setEditing(null)}
                style={{ flex: 1, background: '#F3F4F6', color: INK, border: 'none', borderRadius: 10, padding: '11px 0', fontWeight: 800, fontSize: 13, cursor: 'pointer' }}>취소</button>
              <button onClick={saveLoginInfo} disabled={savingLogin}
                style={{ flex: 2, background: VIOLET, color: '#fff', border: 'none', borderRadius: 10, padding: '11px 0', fontWeight: 800, fontSize: 13, cursor: savingLogin ? 'wait' : 'pointer', opacity: savingLogin ? .5 : 1 }}>
                {savingLogin ? '저장 중...' : '저장하고 알림 준비'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
