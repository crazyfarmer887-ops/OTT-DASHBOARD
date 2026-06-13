import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, KeyRound, Loader2, Lock, Mail, ShieldCheck } from "lucide-react";

type AccessPayload = {
  ok: boolean;
  reason?: string;
  adminAccess?: boolean;
  serviceType?: string;
  accountEmail?: string;
  memberName?: string;
  profileName?: string;
  emailAccessUrl?: string;
  partyProfiles?: Array<{
    profileName: string;
    memberName: string;
    status: string;
    statusName: string;
    startDateTime: string | null;
    endDateTime: string | null;
    isCurrentMember: boolean;
  }>;
  period?: { startDateTime: string | null; endDateTime: string | null };
  consentRequired?: boolean;
  sensitiveRedacted?: boolean;
  credentials?: { id: string; password: string; pin: string; updatedAt: string };
};

const AGREEMENT_1 = '계정 정보를 절대 변경하지 않겠습니다.';
const AGREEMENT_2 = '로그인 안 될 때 이 페이지를 먼저 확인하겠습니다.';
const AGREEMENT_3 = '배정된 1개 프로필만 사용하겠습니다.';

const fmtDate = (value?: string | null) => {
  if (!value) return '-';
  const m = value.match(/(\d{4})[-./]?(\d{2})[-./]?(\d{2})/) || value.match(/(\d{2})\.\s*(\d{1,2})\.\s*(\d{1,2})/);
  if (!m) return value;
  if (m[1].length === 2) return `20${m[1]}.${m[2].padStart(2, '0')}.${m[3].padStart(2, '0')}`;
  return `${m[1]}.${m[2].padStart(2, '0')}.${m[3].padStart(2, '0')}`;
};

const isWavveService = (value?: string) => {
  const v = String(value || '').trim().toLowerCase().replace(/\s+/g, '');
  return v === '웨이브' || v === 'wavve';
};

function credentialRows(payload: AccessPayload): Array<{ label: string; value: string; link?: string }> {
  const c = payload.credentials;
  const showEmailAccess = Boolean(payload.emailAccessUrl) && !isWavveService(payload.serviceType);
  return [
    { label: 'ID', value: c?.id || '' },
    { label: 'PW', value: c?.password || '' },
    showEmailAccess ? { label: 'EMAIL', value: payload.emailAccessUrl || '', link: payload.emailAccessUrl || '' } : null,
    showEmailAccess ? { label: '이메일 접근 PIN번호', value: c?.pin || '' } : null,
  ].filter(Boolean) as Array<{ label: string; value: string; link?: string }>;
}

export default function PartyAccessPage() {
  const token = decodeURIComponent(window.location.pathname.split('/access/')[1] || '');
  const [payload, setPayload] = useState<AccessPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [consentInputs, setConsentInputs] = useState({ a1:'', a2:'', a3:'' });
  const [consentOk, setConsentOk] = useState(false);
  const [consentStep, setConsentStep] = useState(0);
  const [editCredentials, setEditCredentials] = useState({ id: '', password: '' });
  const [savingCredentials, setSavingCredentials] = useState(false);
  const [credentialEditMessage, setCredentialEditMessage] = useState('');

  const fetchFullPayloadAfterConsent = async () => {
    const phrases = [AGREEMENT_1, AGREEMENT_2, AGREEMENT_3];
    const res = await fetch(`/api/party-access/${encodeURIComponent(token)}/consent`, {
      method: 'POST',
      cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phrases }),
    });
    return await res.json().catch(() => ({})) as AccessPayload;
  };

  useEffect(() => {
    let alive = true;
    fetch(`/api/party-access/${encodeURIComponent(token)}`, { cache: 'no-store' })
      .then(async (res) => ({ res, json: await res.json().catch(() => ({})) }))
      .then(({ json }) => { if (alive) setPayload(json as AccessPayload); })
      .catch(() => { if (alive) setPayload({ ok: false, reason: 'network-error' }); })
      .finally(() => { if (alive) setLoading(false); });
    try { setConsentOk(localStorage.getItem(`access-consent-v3:${token}`) === 'ok'); } catch {}
    return () => { alive = false; };
  }, [token]);

  useEffect(() => {
    if (!payload?.ok || !payload.sensitiveRedacted || !consentOk) return;
    let alive = true;
    fetchFullPayloadAfterConsent()
      .then((json) => { if (alive) setPayload(json); })
      .catch(() => { if (alive) setConsentOk(false); });
    return () => { alive = false; };
  }, [payload?.ok, payload?.sensitiveRedacted, consentOk, token]);

  useEffect(() => {
    if (!payload?.credentials) return;
    setEditCredentials({ id: payload.credentials.id || '', password: payload.credentials.password || '' });
  }, [payload?.credentials?.id, payload?.credentials?.password]);

  const copy = async (value: string) => {
    if (!value) return;
    try { await navigator.clipboard?.writeText(value); } catch {}
  };

  if (loading) {
    return <div style={{ minHeight:'100dvh', display:'grid', placeItems:'center', background:'#F8F6FF', color:'#7C3AED', fontWeight:900 }}><Loader2 size={24} style={{ animation:'spin 1s linear infinite' }} /> 계정 정보 확인 중...</div>;
  }

  if (!payload?.ok) {
    return (
      <div style={{ minHeight:'100dvh', background:'#F8F6FF', padding:'max(24px, env(safe-area-inset-top)) 18px max(24px, env(safe-area-inset-bottom))', boxSizing:'border-box', display:'grid', placeItems:'center' }}>
        <div style={{ width:'100%', maxWidth:420, background:'#fff', borderRadius:24, padding:22, boxShadow:'0 16px 50px rgba(124,58,237,0.14)', textAlign:'center', border:'1px solid #EDE9FE' }}>
          <Lock size={34} color="#EF4444" />
          <h1 style={{ fontSize:20, color:'#1E1B4B', margin:'12px 0 6px' }}>계정 정보 접근이 종료됐어요</h1>
          <p style={{ fontSize:13, color:'#6B7280', lineHeight:1.6, margin:0 }}>이용기간이 끝났거나 판매자가 접근을 막은 링크입니다. 문의가 필요하면 판매자에게 메시지 주세요.</p>
        </div>
      </div>
    );
  }

  const profileName = payload.profileName || payload.memberName || '(미확인)';
  const partyProfiles = payload.partyProfiles || [];
  const isAdminAccess = payload.adminAccess === true;
  const showConsent = Boolean(payload.consentRequired && !consentOk && !isAdminAccess);
  const completedConsentCount = [consentInputs.a1.trim() === AGREEMENT_1, consentInputs.a2.trim() === AGREEMENT_2, consentInputs.a3.trim() === AGREEMENT_3].filter(Boolean).length;
  const allConsentOk = completedConsentCount === 3;
  const acceptConsent = async () => {
    if (!allConsentOk) return;
    try {
      const fullPayload = await fetchFullPayloadAfterConsent();
      setPayload(fullPayload);
      if (fullPayload.ok && !fullPayload.sensitiveRedacted) {
        localStorage.setItem(`access-consent-v3:${token}`, 'ok');
        setConsentOk(true);
      }
    } catch {}
  };
  const showEmailAccess = Boolean(payload.emailAccessUrl) && !isWavveService(payload.serviceType);
  const saveCredentialEdits = async () => {
    if (!isAdminAccess) return;
    const id = editCredentials.id.trim();
    const password = editCredentials.password.trim();
    if (!id || !password) {
      setCredentialEditMessage('ID와 PW를 모두 입력해주세요.');
      return;
    }
    setSavingCredentials(true);
    setCredentialEditMessage('저장 중...');
    try {
      const res = await fetch(`/api/party-access/${encodeURIComponent(token)}/credentials`, {
        method: 'PATCH',
        cache: 'no-store',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ accountEmail: id, password }),
      });
      const json = await res.json().catch(() => ({})) as any;
      if (!res.ok || !json?.ok) throw new Error(json?.error || json?.reason || '저장 실패');
      setPayload((prev) => prev ? { ...prev, accountEmail: id, credentials: { ...(prev.credentials || { pin:'', updatedAt:'' }), id, password } } : prev);
      setCredentialEditMessage('저장 완료 · 구매자 access 페이지에 바로 반영됐어요.');
    } catch (error: any) {
      setCredentialEditMessage(`저장 실패 · ${error?.message || '관리자 토큰을 확인해주세요.'}`);
    } finally {
      setSavingCredentials(false);
    }
  };

  const consentCards = [
    {
      no: '01', tone:'#FEE2E2', border:'#FCA5A5', title:'계정 정보 수정 금지', image:'/dashboard/access-notice-assets/complaint-case.jpg', imageLabel:'고소장 실제사례 이미지', text:'비밀번호·이메일·프로필 잠금·결제 설정은 바꾸지 마세요.', required:AGREEMENT_1, key:'a1' as const,
    },
    {
      no: '02', tone:'#EEF2FF', border:'#C7D2FE', title:'최신 정보 먼저 확인', image:'/dashboard/access-notice-assets/disney-profiles.jpg', imageLabel:'프로필 수정 화면 예시', text:'로그인이 안 되면 먼저 이 페이지를 새로고침해 확인하세요.', required:AGREEMENT_2, key:'a2' as const,
    },
    {
      no: '03', tone:'#ECFDF5', border:'#A7F3D0', title:'1인 1프로필 사용', text:'배정된 프로필 1개만 쓰고, 현황에 없는 프로필만 삭제하세요.', required:AGREEMENT_3, key:'a3' as const,
    },
  ];
  const currentConsentCard = consentCards[consentStep] || consentCards[0];
  const currentConsentMatches = consentInputs[currentConsentCard.key].trim() === currentConsentCard.required;
  const blockConsentPaste = (event: any) => {
    event.preventDefault();
  };
  const goNextConsent = () => {
    if (!currentConsentMatches) return;
    if (consentStep < consentCards.length - 1) setConsentStep(consentStep + 1);
    else acceptConsent();
  };

  return (
    <div style={{ minHeight:'100dvh', background:'linear-gradient(180deg,#F8F6FF,#FFFFFF)', padding:'max(20px, env(safe-area-inset-top)) 16px max(32px, env(safe-area-inset-bottom))', boxSizing:'border-box' }}>
      {showConsent && (
        <div onCopy={e => e.preventDefault()} onCut={e => e.preventDefault()} onPaste={e => e.preventDefault()} onContextMenu={e => e.preventDefault()} style={{ position:'fixed', inset:0, zIndex:100, background:'linear-gradient(180deg,#F8F6FF,#FFFFFF)', padding:'max(10px, env(safe-area-inset-top)) 10px max(24px, env(safe-area-inset-bottom))', boxSizing:'border-box', display:'flex', alignItems:'flex-start', justifyContent:'center', overflowY:'auto', WebkitOverflowScrolling:'touch', height:'100vh', minHeight:'100dvh', overscrollBehavior:'contain' }}>
          <div style={{ width:'100%', maxWidth:520, background:'#fff', borderRadius:26, padding:16, marginBottom:18, boxShadow:'0 20px 70px rgba(124,58,237,0.18)', border:'1.5px solid #EDE9FE', textAlign:'left', boxSizing:'border-box', display:'flex', flexDirection:'column', gap:12 }}>
            <div style={{ textAlign:'center' }}>
              <div style={{ fontSize:'clamp(18px, 5vw, 22px)', fontWeight:1000, color:'#EF4444', marginBottom:4 }}>⚠️ 이용 전 필수 동의</div>
              <div style={{ fontSize:12, color:'#6B7280', fontWeight:900 }}>진행 상황: {completedConsentCount}/3 · 복사/붙여넣기 없이 직접 입력해주세요.</div>
              <div style={{ display:'flex', gap:6, marginTop:10 }}>
                {consentCards.map((card, index) => <button key={card.no} type="button" onClick={() => setConsentStep(index)} disabled={index > completedConsentCount} style={{ flex:1, height:8, border:0, borderRadius:999, background:index < completedConsentCount ? '#10B981' : index === consentStep ? '#7C3AED' : '#E5E7EB', cursor:index <= completedConsentCount ? 'pointer' : 'not-allowed' }} aria-label={`${card.no}번 동의`} />)}
              </div>
            </div>
            <section style={{ background:currentConsentCard.tone, border:`1.5px solid ${currentConsentCard.border}`, borderRadius:20, padding:14 }}>
              <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8 }}>
                <span style={{ width:34, height:34, borderRadius:12, background:'#fff', color:'#1E1B4B', display:'grid', placeItems:'center', fontSize:13, fontWeight:1000 }}>{currentConsentCard.no}</span>
                <div style={{ fontSize:16, color:'#1E1B4B', fontWeight:1000 }}>{currentConsentCard.title}</div>
              </div>
              {'image' in currentConsentCard && currentConsentCard.image && (
                <div style={{ margin:'8px 0 10px', background:'#fff', border:'1px solid rgba(17,24,39,.12)', borderRadius:16, padding:10 }}>
                  <div style={{ fontSize:11, color:'#6B7280', fontWeight:1000, marginBottom:7 }}>{currentConsentCard.imageLabel}</div>
                  <img src={currentConsentCard.image} alt={currentConsentCard.imageLabel} draggable={false} style={{ width:'100%', maxHeight:260, objectFit:'contain', borderRadius:12, display:'block', userSelect:'none', WebkitUserSelect:'none', pointerEvents:'none' }} />
                </div>
              )}
              <div style={{ fontSize:13, color:'#374151', lineHeight:1.65, fontWeight:800, userSelect:'none', WebkitUserSelect:'none' }}>{currentConsentCard.text}</div>

              <div style={{ marginTop:10, background:'#fff', borderRadius:14, border:'1px solid rgba(17,24,39,.1)', padding:10 }}>
                <div style={{ fontSize:11, color:'#6B7280', fontWeight:1000, marginBottom:6 }}>아래 문장을 복붙 없이 그대로 입력</div>
                <div style={{ fontSize:12, color:'#111827', lineHeight:1.55, fontWeight:900, marginBottom:8, userSelect:'none', WebkitUserSelect:'none' }}>{currentConsentCard.required}</div>
                <textarea value={consentInputs[currentConsentCard.key]} onPaste={blockConsentPaste} onCopy={blockConsentPaste} onCut={blockConsentPaste} onDrop={e => e.preventDefault()} onChange={e => setConsentInputs(prev => ({ ...prev, [currentConsentCard.key]: e.target.value }))} onFocus={e => setTimeout(() => e.currentTarget.scrollIntoView({ block:'center', behavior:'smooth' }), 80)} placeholder="직접 입력해주세요. 붙여넣기는 막혀 있어요." rows={4} style={{ width:'100%', padding:'12px 13px', borderRadius:12, border:`1.5px solid ${currentConsentMatches ? '#10B981' : '#CBD5E1'}`, boxSizing:'border-box', fontSize:14, fontWeight:800, color:'#1E1B4B', outline:'none', fontFamily:'inherit', resize:'vertical', scrollMarginBottom:'150px', lineHeight:1.45 }} />
              </div>
            </section>
            <div style={{ display:'grid', gridTemplateColumns:consentStep > 0 ? '1fr 2fr' : '1fr', gap:8, position:'sticky', bottom:8 }}>
              {consentStep > 0 && <button type="button" onClick={() => setConsentStep(Math.max(0, consentStep - 1))} style={{ padding:14, border:'1.5px solid #DDD6FE', borderRadius:16, background:'#fff', color:'#6D28D9', fontSize:15, fontWeight:1000, fontFamily:'inherit' }}>이전</button>}
              <button onClick={goNextConsent} disabled={!currentConsentMatches} style={{ width:'100%', padding:16, border:'none', borderRadius:16, background:currentConsentMatches ? '#7C3AED' : '#C4B5FD', color:'#fff', fontSize:16, fontWeight:1000, cursor:currentConsentMatches ? 'pointer' : 'not-allowed', fontFamily:'inherit', boxShadow:currentConsentMatches ? '0 12px 24px rgba(124,58,237,.24)' : 'none' }}>{consentStep < 2 ? `동의 완료하고 다음 (${completedConsentCount}/3)` : `3개 내용 모두 동의하고 계정정보 보기 (${completedConsentCount}/3)`}</button>
            </div>
          </div>
        </div>
      )}
      {!showConsent && <div style={{ maxWidth:460, margin:'0 auto' }}>
        <div style={{ background:'#fff', borderRadius:24, padding:20, boxShadow:'0 16px 50px rgba(124,58,237,0.14)', border:'1px solid #EDE9FE' }}>
          <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:12 }}>
            <div style={{ width:42, height:42, borderRadius:14, background:'#F5F3FF', display:'grid', placeItems:'center' }}><ShieldCheck size={22} color="#7C3AED" /></div>
            <div>
              <div style={{ fontSize:18, fontWeight:900, color:'#1E1B4B' }}>{showEmailAccess ? '최신 ID · PW · PIN' : '최신 ID · PW'}</div>
              <div style={{ fontSize:12, color:'#9CA3AF', fontWeight:800 }}>이용기간 중에만 계정 정보를 확인할 수 있어요</div>
            </div>
          </div>

          <div style={{ background:'#FEF2F2', border:'1.5px solid #FECACA', borderRadius:16, padding:12, marginBottom:12, color:'#991B1B', fontSize:12, lineHeight:1.55, fontWeight:900, display:'flex', gap:8 }}>
            <AlertTriangle size={18} style={{ flexShrink:0 }} />
            <div>{isAdminAccess ? '관리자 인증으로 동의 절차를 건너뛰었습니다. 구매자 화면에서는 기존처럼 필수 동의 후 계정 정보가 표시됩니다.' : '계정 정보와 추가회원/자리 설정은 절대 변경하지 마세요. 로그인 안 될 때는 이 페이지를 새로고침해 최신 정보를 먼저 확인해주세요.'}</div>
          </div>

          <div style={{ background:'#F8F6FF', borderRadius:16, padding:12, marginBottom:12 }}>
            <div style={{ fontSize:12, color:'#6B7280', fontWeight:800 }}>{payload.serviceType} · {payload.memberName}</div>
            <div style={{ fontSize:11, color:'#9CA3AF', marginTop:4 }}>{fmtDate(payload.period?.startDateTime)} ~ {fmtDate(payload.period?.endDateTime)}</div>
          </div>

          <div style={{ background:'#EEF2FF', border:'1.5px solid #C7D2FE', borderRadius:16, padding:'13px 14px', marginBottom:10, textAlign:'center' }}>
            <div style={{ fontSize:11, color:'#4F46E5', fontWeight:1000 }}>구매자님이 만들어야 하는 프로필 이름</div>
            <div style={{ fontSize:24, color:'#1E1B4B', fontWeight:1000, marginTop:4 }}>{profileName}</div>
          </div>

          <div style={{ display:'grid', gap:10, marginBottom:10 }}>
            {credentialRows(payload).map((row) => (
              <div key={row.label} style={{ background:'#FFFFFF', border:'1.5px solid #EDE9FE', borderRadius:16, padding:'12px 14px' }}>
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:8 }}>
                  <div style={{ fontSize:11, color:'#7C3AED', fontWeight:900, display:'flex', alignItems:'center', gap:5 }}>{row.label === 'EMAIL' ? <Mail size={12} /> : <KeyRound size={12} />} {row.label}</div>
                  {row.link ? <a href={row.link} target="_blank" rel="noreferrer" style={{ border:'none', borderRadius:999, background:'#F5F3FF', color:'#7C3AED', fontSize:11, fontWeight:900, padding:'6px 10px', textDecoration:'none' }}>이메일 인증 열기</a> : <button onClick={() => copy(row.value)} style={{ border:'none', borderRadius:999, background:'#F5F3FF', color:'#7C3AED', fontSize:11, fontWeight:900, padding:'6px 10px', cursor:'pointer' }}>복사</button>}
                </div>
                <div style={{ fontSize:16, color:'#1E1B4B', fontWeight:900, marginTop:6, wordBreak:'break-all' }}>{row.link ? '이메일 인증/핀번호 확인 링크' : (row.value || '-')}</div>
              </div>
            ))}
          </div>

          {isAdminAccess && (
            <div style={{ background:'#FFFBEB', border:'1.5px solid #FDE68A', borderRadius:16, padding:14, marginBottom:10 }}>
              <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:10 }}>
                <ShieldCheck size={16} color="#B45309" />
                <div>
                  <div style={{ fontSize:13, color:'#92400E', fontWeight:1000 }}>관리자 전용 ID/PW 수정</div>
                  <div style={{ fontSize:10, color:'#A16207', fontWeight:800, marginTop:2 }}>이 access 링크가 구매자에게 보여주는 ID/PW만 즉시 수정합니다.</div>
                </div>
              </div>
              <div style={{ display:'grid', gap:8 }}>
                <label style={{ display:'grid', gap:4, fontSize:11, color:'#92400E', fontWeight:1000 }}>
                  ID
                  <input value={editCredentials.id} onChange={e => setEditCredentials(prev => ({ ...prev, id:e.target.value }))} style={{ width:'100%', boxSizing:'border-box', padding:'10px 11px', borderRadius:12, border:'1.5px solid #FCD34D', fontSize:13, fontWeight:800, color:'#1E1B4B', fontFamily:'inherit' }} />
                </label>
                <label style={{ display:'grid', gap:4, fontSize:11, color:'#92400E', fontWeight:1000 }}>
                  PW
                  <input value={editCredentials.password} onChange={e => setEditCredentials(prev => ({ ...prev, password:e.target.value }))} style={{ width:'100%', boxSizing:'border-box', padding:'10px 11px', borderRadius:12, border:'1.5px solid #FCD34D', fontSize:13, fontWeight:800, color:'#1E1B4B', fontFamily:'inherit' }} />
                </label>
                <button type="button" onClick={saveCredentialEdits} disabled={savingCredentials} style={{ border:'none', borderRadius:14, background:savingCredentials ? '#FBBF24' : '#D97706', color:'#fff', fontSize:13, fontWeight:1000, padding:'11px 12px', cursor:savingCredentials ? 'wait' : 'pointer', fontFamily:'inherit' }}>{savingCredentials ? '저장 중...' : 'ID/PW 저장'}</button>
                {credentialEditMessage && <div style={{ fontSize:11, color:credentialEditMessage.includes('실패') ? '#B91C1C' : '#047857', fontWeight:900, lineHeight:1.45 }}>{credentialEditMessage}</div>}
              </div>
            </div>
          )}

          <div style={{ background:'#F9FAFB', border:'1.5px solid #E5E7EB', borderRadius:16, padding:'13px 14px', marginBottom:10 }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:8, marginBottom:8 }}>
              <div>
                <div style={{ fontSize:11, color:'#4B5563', fontWeight:1000 }}>현재 파티원 프로필 현황</div>
                <div style={{ fontSize:10, color:'#9CA3AF', fontWeight:800, marginTop:2 }}>계정 접근 시점 기준으로 확인됩니다</div>
              </div>
              <button onClick={() => window.location.reload()} style={{ border:'none', borderRadius:999, background:'#EEF2FF', color:'#4F46E5', fontSize:10, fontWeight:1000, padding:'6px 9px', cursor:'pointer' }}>새로고침</button>
            </div>
            {partyProfiles.length > 0 ? (
              <div style={{ display:'grid', gap:7 }}>
                {partyProfiles.map((profile, idx) => (
                  <div key={`${profile.profileName}-${idx}`} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:10, background:profile.isCurrentMember ? '#F5F3FF' : '#FFFFFF', border:profile.isCurrentMember ? '1.5px solid #C4B5FD' : '1px solid #E5E7EB', borderRadius:12, padding:'9px 10px' }}>
                    <div style={{ minWidth:0 }}>
                      <div style={{ fontSize:15, color:'#111827', fontWeight:1000, wordBreak:'break-all' }}>{profile.profileName}{profile.isCurrentMember ? ' · 내 프로필' : ''}</div>
                      <div style={{ fontSize:10, color:'#6B7280', fontWeight:800, marginTop:3 }}>{profile.memberName || '파티원'} · {fmtDate(profile.endDateTime)}까지</div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ fontSize:12, color:'#6B7280', lineHeight:1.55, fontWeight:800 }}>아직 표시할 파티원 프로필 현황이 없습니다. 배정된 프로필 이름을 우선 사용해주세요.</div>
            )}
            <div style={{ marginTop:9, fontSize:11, color:'#92400E', background:'#FFFBEB', border:'1px solid #FDE68A', borderRadius:10, padding:'8px 9px', lineHeight:1.5, fontWeight:800 }}>
              프로필이 꽉 찼다면 위 현황에 없는 프로필을 삭제한 뒤, 배정된 이름으로 새로 만들어 사용해주세요.
            </div>
          </div>

          <div style={{ marginTop:14, background:'#ECFDF5', border:'1px solid #A7F3D0', borderRadius:14, padding:12, color:'#065F46', fontSize:12, lineHeight:1.55, fontWeight:800, display:'flex', gap:7 }}>
            <CheckCircle2 size={16} style={{ flexShrink:0 }} />
            <div>이 페이지는 최신 로그인 정보를 실시간으로 보여줍니다. 비밀번호가 갑자기 안 되면 먼저 새로고침 후 다시 확인해주세요.</div>
          </div>
        </div>
      </div>}
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}
