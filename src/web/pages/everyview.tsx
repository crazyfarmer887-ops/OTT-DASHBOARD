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
                  const partyIdStr = acct.email.replace('everyview:', '');
                  const open = !!expanded[partyIdStr];
                  const firstMemberEnd = acct.members[0]?.endDateTime ?? null;
                  return (
                    <div key={acct.email} style={{ background: CARD, borderRadius: 14, border: `1px solid ${LINE}`, overflow: 'hidden' }}>
                      <button onClick={() => setExpanded(p => ({ ...p, [partyIdStr]: !open }))}
                        style={{ width: '100%', background: 'none', border: 'none', textAlign: 'left', padding: '12px 14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 14, fontWeight: 800, color: INK }}>파티 #{partyIdStr}</div>
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
                              <div style={{ fontSize: 11, color: m.remainderDays <= 7 ? RED : MUTED }}>
                                ~ {fmtDate(m.endDateTime)} {m.remainderDays > 0 && `(D-${m.remainderDays})`}
                              </div>
                            </div>
                          ))}

                          {/* 로그인 정보 + 수정 버튼 */}
                          <button
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
                          </button>
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
