import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { AlertTriangle, CheckCircle2, Clipboard, Loader2, RefreshCw, Users } from 'lucide-react';
import { YOUTUBE_INVITE_EMAIL_REQUEST_MESSAGE } from '../../lib/youtube-invite-email';
import { createLatestRequestController, type LatestRequestController } from '../lib/latest-request';

export type YouTubeInvitationStatus =
  | 'waiting_for_group_assignment'
  | 'waiting_for_buyer_email'
  | 'email_candidate_found'
  | 'email_confirmed'
  | 'invite_sent'
  | 'delivery_completion_pending'
  | 'delivered_waiting_inspection'
  | 'active'
  | 'failed'
  | 'ended';

export type YouTubeInvitationAction =
  | 'email-candidate'
  | 'confirm-email'
  | 'mark-invite-sent'
  | 'finish-delivery'
  | 'reconcile'
  | 'resume';

type InvitationHistory = {
  from: YouTubeInvitationStatus | null;
  to: YouTubeInvitationStatus;
  reason: string;
  at: string;
};

export type YouTubeInvitationDto = {
  id: string;
  dealDisplayId: string;
  productDisplayId: string;
  familyGroupId: string;
  buyerName: string;
  buyerEmailMasked: string | null;
  endDateTime: string | null;
  status: YouTubeInvitationStatus;
  createdAt: string;
  updatedAt: string;
  history: InvitationHistory[];
};

type FamilyGroupDto = {
  id: string;
  label: string;
  enabled: boolean;
  availableSeats: number;
};

type LoadState = {
  invitations: YouTubeInvitationDto[];
  familyGroups: FamilyGroupDto[];
  enabled: boolean;
};

type Feedback = { tone: 'success' | 'warning' | 'error'; message: string };

const STATUSES: readonly YouTubeInvitationStatus[] = [
  'waiting_for_group_assignment', 'waiting_for_buyer_email', 'email_candidate_found', 'email_confirmed',
  'invite_sent', 'delivery_completion_pending', 'delivered_waiting_inspection', 'active', 'failed', 'ended',
];
const STATUS_SET = new Set<string>(STATUSES);
const STATUS_LABELS: Record<YouTubeInvitationStatus, string> = {
  waiting_for_group_assignment: '그룹 배정 대기',
  waiting_for_buyer_email: '구매자 이메일 대기',
  email_candidate_found: '이메일 후보 확인',
  email_confirmed: '이메일 확인 완료',
  invite_sent: '초대 발송 기록',
  delivery_completion_pending: '전달 완료 확인 중',
  delivered_waiting_inspection: '검수 대기',
  active: '활성',
  failed: '실패',
  ended: '종료',
};
const ACTION_REASONS: Record<YouTubeInvitationAction, string> = {
  'email-candidate': 'operator parsed buyer chat message',
  'confirm-email': 'operator confirmed buyer email',
  'mark-invite-sent': 'operator confirmed manual google invite sent',
  'finish-delivery': 'operator requested delivery completion',
  reconcile: 'operator requested provider reconciliation',
  resume: 'operator resumed failed invitation',
};
const panel: CSSProperties = { background: '#fff', border: '1px solid #EDE9FE', borderRadius: 16, padding: 16, boxShadow: '0 5px 20px rgba(76,29,149,.05)' };
const button: CSSProperties = { minHeight: 40, border: '1px solid #DDD6FE', borderRadius: 10, background: '#fff', color: '#5B21B6', fontWeight: 800, cursor: 'pointer', padding: '8px 12px', fontFamily: 'inherit' };
const primaryButton: CSSProperties = { ...button, background: '#7C3AED', color: '#fff', borderColor: '#7C3AED' };
const input: CSSProperties = { width: '100%', minHeight: 42, border: '1px solid #DDD6FE', borderRadius: 10, padding: '9px 11px', fontFamily: 'inherit', background: '#fff', minWidth: 0 };

export function actionForYouTubeInvitationStatus(status: YouTubeInvitationStatus): YouTubeInvitationAction | null {
  if (status === 'waiting_for_buyer_email') return 'email-candidate';
  if (status === 'email_candidate_found') return 'confirm-email';
  if (status === 'email_confirmed') return 'mark-invite-sent';
  if (status === 'invite_sent') return 'finish-delivery';
  if (status === 'delivery_completion_pending' || status === 'delivered_waiting_inspection' || status === 'active') return 'reconcile';
  if (status === 'failed') return 'resume';
  return null;
}

export function filterYouTubeInvitations(
  invitations: readonly YouTubeInvitationDto[],
  status: YouTubeInvitationStatus | 'all',
  familyGroupId: string | 'all',
): YouTubeInvitationDto[] {
  return invitations.filter((row) => (status === 'all' || row.status === status)
    && (familyGroupId === 'all' || row.familyGroupId === familyGroupId));
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function safeText(value: unknown, max = 300): string {
  return typeof value === 'string' && value.length <= max && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value) ? value : '';
}

function safeMaskedEmail(value: unknown): string | null {
  const email = safeText(value, 320);
  return email && email.includes('@') && email.includes('*') && !/\s/.test(email) ? email : null;
}

function normalizeHistory(value: unknown): InvitationHistory[] {
  if (!Array.isArray(value)) return [];
  return value.slice(-50).flatMap((candidate) => {
    const item = record(candidate);
    const to = safeText(item?.to, 60);
    const from = item?.from === null ? null : safeText(item?.from, 60);
    if (!STATUS_SET.has(to) || (from !== null && !STATUS_SET.has(from))) return [];
    const reason = safeText(item?.reason, 200);
    return [{ from: from as YouTubeInvitationStatus | null, to: to as YouTubeInvitationStatus, reason: reason.includes('@') ? '' : reason, at: safeText(item?.at, 50) }];
  });
}

function normalizeInvitation(value: unknown): YouTubeInvitationDto | null {
  const item = record(value);
  const status = safeText(item?.status, 60);
  const id = safeText(item?.id, 200);
  if (!item || !id || !STATUS_SET.has(status)) return null;
  return {
    id,
    dealDisplayId: safeText(item.dealDisplayId, 200),
    productDisplayId: safeText(item.productDisplayId, 200),
    familyGroupId: safeText(item.familyGroupId, 200),
    buyerName: safeText(item.buyerName, 200) || '이름 없음',
    buyerEmailMasked: safeMaskedEmail(item.buyerEmailMasked),
    endDateTime: item.endDateTime === null ? null : safeText(item.endDateTime, 50) || null,
    status: status as YouTubeInvitationStatus,
    createdAt: safeText(item.createdAt, 50),
    updatedAt: safeText(item.updatedAt, 50),
    history: normalizeHistory(item.history),
  };
}

function normalizeFamilyGroup(value: unknown): FamilyGroupDto | null {
  const item = record(value);
  const id = safeText(item?.id, 200);
  const label = safeText(item?.label, 120);
  if (!item || !id || !label) return null;
  return { id, label, enabled: item.enabled === true, availableSeats: Number.isFinite(item.availableSeats) ? Number(item.availableSeats) : 0 };
}

async function jsonRecord(response: Response): Promise<Record<string, unknown>> {
  if (!(response.headers.get('content-type') || '').includes('application/json')) throw new Error('invalid-response');
  const payload = record(await response.json());
  if (!payload) throw new Error('invalid-response');
  return payload;
}

async function loadPageData(signal?: AbortSignal): Promise<LoadState> {
  const [invitationsResponse, familyGroupsResponse] = await Promise.all([
    fetch('/api/youtube/invitations', { signal }),
    fetch('/api/youtube/family-groups', { signal }),
  ]);
  if (!invitationsResponse.ok || !familyGroupsResponse.ok) throw new Error('load-failed');
  const [invitationPayload, groupPayload] = await Promise.all([jsonRecord(invitationsResponse), jsonRecord(familyGroupsResponse)]);
  if (invitationPayload.ok !== true || groupPayload.ok !== true
    || !Array.isArray(invitationPayload.invitations) || !Array.isArray(groupPayload.familyGroups)) throw new Error('invalid-response');
  return {
    invitations: invitationPayload.invitations.map(normalizeInvitation).filter((item): item is YouTubeInvitationDto => item !== null),
    familyGroups: groupPayload.familyGroups.map(normalizeFamilyGroup).filter((item): item is FamilyGroupDto => item !== null),
    enabled: invitationPayload.enabled === true && groupPayload.enabled === true,
  };
}

function formatDate(value: string | null): string {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value.slice(0, 16);
  return new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }).format(parsed);
}

function statusTone(status: YouTubeInvitationStatus): CSSProperties {
  if (status === 'active' || status === 'ended') return { color: '#047857', background: '#ECFDF5' };
  if (status === 'failed') return { color: '#B91C1C', background: '#FEF2F2' };
  if (status.includes('pending') || status.includes('waiting')) return { color: '#B45309', background: '#FFFBEB' };
  return { color: '#5B21B6', background: '#F3F0FF' };
}

function Identifier({ label, value }: { label: string; value: string }) {
  return <div style={{ minWidth: 0 }}><div style={{ fontSize: 11, color: '#9CA3AF', marginBottom: 2 }}>{label}</div><div style={{ maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12, color: '#4B5563', fontFamily: 'ui-monospace, monospace' }}>{value || '-'}</div></div>;
}

function ActionPanel({ invitation, enabled, confirmedEmail, onEmailConfirmed, onInviteSent, onRefresh }: {
  invitation: YouTubeInvitationDto;
  enabled: boolean;
  confirmedEmail?: string;
  onEmailConfirmed: (invitationId: string, email: string) => void;
  onInviteSent: (invitationId: string) => void;
  onRefresh: () => Promise<void>;
}) {
  const action = actionForYouTubeInvitationStatus(invitation.status);
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const lock = useRef(false);

  const mutate = async (selectedAction: YouTubeInvitationAction, body: Record<string, string> | Record<string, never>) => {
    if (!enabled || lock.current) return;
    const needsConfirmation = selectedAction === 'mark-invite-sent' || selectedAction === 'finish-delivery';
    if (needsConfirmation && !window.confirm(selectedAction === 'mark-invite-sent'
      ? 'Google 가족 초대를 수동으로 보낸 것이 맞습니까?'
      : '그레이태그 전달 완료 처리를 요청할까요?')) return;
    lock.current = true;
    setBusy(true);
    setFeedback(null);
    try {
      const response = await fetch(`/api/youtube/invitations/${encodeURIComponent(invitation.id)}/${selectedAction}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-audit-reason': ACTION_REASONS[selectedAction] },
        body: JSON.stringify(body),
      });
      const payload = await jsonRecord(response);
      const completed = response.ok && payload.ok !== false && response.status !== 202;
      if (response.status === 202 || response.status === 502) {
        setFeedback({ tone: 'warning', message: '외부 처리 결과가 아직 확정되지 않았습니다. 자동 재시도하지 않았습니다. 상태를 확인해 주세요.' });
      } else if (!response.ok || payload.ok === false) {
        setFeedback({ tone: 'error', message: selectedAction === 'confirm-email'
          ? '확인 요청에 실패했습니다. 이메일을 수정하거나 그대로 다시 시도해 주세요.'
          : '작업을 완료하지 못했습니다. 현재 상태와 관리자 설정을 확인해 주세요.' });
      } else if (selectedAction === 'email-candidate') {
        const result = record(payload.result);
        const kind = safeText(result?.kind, 40);
        if (kind === 'none') setFeedback({ tone: 'warning', message: '메시지에서 이메일 후보를 찾지 못했습니다. 구매자에게 다시 요청해 주세요.' });
        else if (kind === 'ambiguous') setFeedback({ tone: 'warning', message: '이메일 후보가 여러 개입니다. 하나만 포함된 메시지로 다시 확인해 주세요.' });
        else setFeedback({ tone: 'success', message: '마스킹된 이메일 후보를 저장했습니다.' });
      } else {
        setFeedback({ tone: 'success', message: '작업을 반영했습니다.' });
      }
      if (completed && selectedAction === 'confirm-email') onEmailConfirmed(invitation.id, body.email);
      if (completed && selectedAction === 'mark-invite-sent') onInviteSent(invitation.id);
      await onRefresh();
    } catch {
      setFeedback({ tone: 'error', message: selectedAction === 'confirm-email'
        ? '확인 요청에 실패했습니다. 이메일을 수정하거나 그대로 다시 시도해 주세요.'
        : '요청 결과를 확인하지 못했습니다. 자동 재시도하지 않았습니다. 새로고침 후 상태를 확인해 주세요.' });
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };

  if (!action) return null;
  const disabled = !enabled || busy;
  return <div style={{ marginTop: 14, borderTop: '1px solid #F3F0FF', paddingTop: 14 }}>
    {action === 'email-candidate' && <form onSubmit={(event) => {
      event.preventDefault();
      const submitted = message;
      if (!submitted.trim()) return;
      setMessage('');
      void mutate(action, { message: submitted });
    }}>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 800, color: '#4C1D95', marginBottom: 6 }}>구매자 채팅 메시지 붙여넣기</label>
      <textarea value={message} onChange={(event) => setMessage(event.target.value)} maxLength={10000} rows={3} autoComplete="off" style={{ ...input, resize: 'vertical' }} disabled={disabled} />
      <button type="submit" style={{ ...primaryButton, width: '100%', marginTop: 8, opacity: disabled ? .55 : 1 }} disabled={disabled || !message.trim()}>{busy ? '확인 중...' : '이메일 후보 안전 확인'}</button>
    </form>}
    {action === 'confirm-email' && <form onSubmit={(event) => {
      event.preventDefault();
      const submitted = email.trim();
      if (!submitted) return;
      void mutate(action, { email: submitted });
    }}>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 800, color: '#4C1D95', marginBottom: 6 }}>후보 이메일 직접 재입력</label>
      <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="off" spellCheck={false} style={input} disabled={disabled} />
      <button type="submit" style={{ ...primaryButton, width: '100%', marginTop: 8, opacity: disabled ? .55 : 1 }} disabled={disabled || !email.trim()}>{busy ? '확인 중...' : '이메일 일치 확인'}</button>
    </form>}
    {action === 'mark-invite-sent' && <div>
      {confirmedEmail
        ? <div style={{ marginBottom: 9, padding: 10, borderRadius: 10, background: '#F8F6FF', color: '#4C1D95', fontSize: 12, overflowWrap: 'anywhere' }}><strong>수동 Google 초대 대상 이메일</strong><br />{confirmedEmail}</div>
        : <div role="alert" style={{ marginBottom: 9, padding: 10, borderRadius: 10, background: '#FFFBEB', color: '#92400E', fontSize: 12, lineHeight: 1.5 }}>이 탭에 전체 이메일이 남아 있지 않습니다. 이전 단계로 되돌아가 이메일을 다시 확인해 주세요.</div>}
      <p style={{ margin: '0 0 9px', fontSize: 13, lineHeight: 1.55, color: '#4B5563' }}>Google에서 표시된 이메일을 가족 그룹에 <strong>직접 초대</strong>한 뒤 기록하세요. 이 화면은 Google 초대를 자동화하지 않습니다.</p>
      <button type="button" onClick={() => void mutate(action, {})} style={{ ...primaryButton, width: '100%', opacity: disabled || !confirmedEmail ? .55 : 1 }} disabled={disabled || !confirmedEmail}>{busy ? '기록 중...' : '수동 초대 발송 완료 기록'}</button>
    </div>}
    {action === 'finish-delivery' && <button type="button" onClick={() => void mutate(action, {})} style={{ ...primaryButton, width: '100%', opacity: disabled ? .55 : 1 }} disabled={disabled}>{busy ? '요청 중...' : '전달 완료 요청'}</button>}
    {action === 'reconcile' && <button type="button" onClick={() => void mutate(action, {})} style={{ ...button, width: '100%', opacity: disabled ? .55 : 1 }} disabled={disabled}>{busy ? '조회 중...' : '외부 상태 다시 확인'}</button>}
    {action === 'resume' && <button type="button" onClick={() => void mutate(action, {})} style={{ ...button, width: '100%', color: '#B91C1C', opacity: disabled ? .55 : 1 }} disabled={disabled}>{busy ? '재개 중...' : '실패 작업 안전 재개'}</button>}
    {feedback && <div role="status" style={{ marginTop: 9, padding: 9, borderRadius: 9, fontSize: 12, lineHeight: 1.5, color: feedback.tone === 'error' ? '#B91C1C' : feedback.tone === 'warning' ? '#B45309' : '#047857', background: feedback.tone === 'error' ? '#FEF2F2' : feedback.tone === 'warning' ? '#FFFBEB' : '#ECFDF5' }}>{feedback.message}</div>}
  </div>;
}

function InvitationCard({ invitation, groupLabel, enabled, confirmedEmail, onEmailConfirmed, onInviteSent, onRefresh }: {
  invitation: YouTubeInvitationDto;
  groupLabel: string;
  enabled: boolean;
  confirmedEmail?: string;
  onEmailConfirmed: (invitationId: string, email: string) => void;
  onInviteSent: (invitationId: string) => void;
  onRefresh: () => Promise<void>;
}) {
  return <article style={panel}>
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 900, color: '#1E1B4B', overflowWrap: 'anywhere' }}>{invitation.buyerName}</div>
        <div style={{ marginTop: 3, fontSize: 13, color: '#6B7280' }}>{invitation.buyerEmailMasked || '이메일 미확인'}</div>
      </div>
      <span style={{ ...statusTone(invitation.status), flexShrink: 0, borderRadius: 999, padding: '5px 8px', fontSize: 11, fontWeight: 900 }}>{STATUS_LABELS[invitation.status]}</span>
    </div>
    <div style={{ marginTop: 12, padding: 11, borderRadius: 11, background: '#F8F6FF', display: 'grid', gap: 8 }}>
      <div style={{ fontSize: 13, fontWeight: 800, color: '#5B21B6' }}>{groupLabel}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 10 }}>
        <Identifier label="거래 ID" value={invitation.dealDisplayId} />
        <Identifier label="상품 ID" value={invitation.productDisplayId} />
      </div>
    </div>
    <dl style={{ display: 'grid', gridTemplateColumns: '88px minmax(0,1fr)', gap: '6px 9px', margin: '12px 0 0', fontSize: 12 }}>
      <dt style={{ color: '#9CA3AF' }}>업데이트</dt><dd style={{ margin: 0, color: '#4B5563' }}>{formatDate(invitation.updatedAt)}</dd>
      <dt style={{ color: '#9CA3AF' }}>이용 종료</dt><dd style={{ margin: 0, color: '#4B5563' }}>{formatDate(invitation.endDateTime)}</dd>
    </dl>
    <details style={{ marginTop: 12 }}>
      <summary style={{ cursor: 'pointer', color: '#6D28D9', fontSize: 12, fontWeight: 800 }}>감사 이력 {invitation.history.length}건</summary>
      <div style={{ marginTop: 8, display: 'grid', gap: 7 }}>
        {invitation.history.length === 0 && <div style={{ fontSize: 12, color: '#9CA3AF' }}>기록 없음</div>}
        {[...invitation.history].reverse().map((entry, index) => <div key={`${entry.at}-${index}`} style={{ borderLeft: '2px solid #DDD6FE', paddingLeft: 9, fontSize: 11, lineHeight: 1.5, color: '#6B7280' }}>
          <strong style={{ color: '#4C1D95' }}>{entry.from ? STATUS_LABELS[entry.from] : '생성'} → {STATUS_LABELS[entry.to]}</strong><br />
          {formatDate(entry.at)}{entry.reason ? ` · ${entry.reason}` : ''}
        </div>)}
      </div>
    </details>
    <ActionPanel invitation={invitation} enabled={enabled} confirmedEmail={confirmedEmail} onEmailConfirmed={onEmailConfirmed} onInviteSent={onInviteSent} onRefresh={onRefresh} />
  </article>;
}

export default function YouTubeInvitesPage() {
  const [data, setData] = useState<LoadState | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState<YouTubeInvitationStatus | 'all'>('all');
  const [familyGroupId, setFamilyGroupId] = useState('all');
  const [polling, setPolling] = useState(true);
  const [copyFeedback, setCopyFeedback] = useState('');
  const [confirmedEmails, setConfirmedEmails] = useState<Record<string, string>>({});
  const refreshController = useRef<LatestRequestController | null>(null);

  const refresh = useCallback(async () => {
    await refreshController.current?.run();
  }, []);

  useEffect(() => {
    const controller = createLatestRequestController({
      load: loadPageData,
      onStart: () => setRefreshing(true),
      onSuccess: (next) => { setData(next); setError(''); },
      onError: () => setError('유튜브 초대 운영 데이터를 불러오지 못했습니다. 관리자 인증과 서버 설정을 확인해 주세요.'),
      onFinish: () => { setLoading(false); setRefreshing(false); },
    });
    refreshController.current = controller;
    void controller.run();
    return () => {
      controller.dispose();
      if (refreshController.current === controller) refreshController.current = null;
    };
  }, []);

  useEffect(() => {
    if (!polling) return;
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, 30_000);
    return () => window.clearInterval(timer);
  }, [polling, refresh]);

  const groupsById = useMemo(() => new Map((data?.familyGroups || []).map((group) => [group.id, group])), [data?.familyGroups]);
  const filtered = useMemo(() => filterYouTubeInvitations(data?.invitations || [], status, familyGroupId), [data?.invitations, status, familyGroupId]);
  const enabled = data?.enabled !== false;

  const copyRequest = async () => {
    try {
      await navigator.clipboard.writeText(YOUTUBE_INVITE_EMAIL_REQUEST_MESSAGE);
      setCopyFeedback('요청 문구를 복사했습니다. 구매자 채팅에 직접 보내 주세요.');
    } catch {
      setCopyFeedback('복사하지 못했습니다. 아래 문구를 직접 선택해 보내 주세요.');
    }
  };

  const rememberConfirmedEmail = useCallback((invitationId: string, email: string) => {
    setConfirmedEmails((current) => ({ ...current, [invitationId]: email }));
  }, []);
  const forgetConfirmedEmail = useCallback((invitationId: string) => {
    setConfirmedEmails((current) => {
      const next = { ...current };
      delete next[invitationId];
      return next;
    });
  }, []);

  return <main style={{ padding: '14px 14px 90px', display: 'grid', gap: 14, overflowX: 'hidden' }}>
    <header style={{ ...panel, background: 'linear-gradient(135deg,#4C1D95,#7C3AED)', color: '#fff' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
        <div style={{ minWidth: 0 }}><h1 style={{ margin: 0, fontSize: 20, overflowWrap: 'anywhere' }}>유튜브 초대 운영</h1><p style={{ margin: '6px 0 0', fontSize: 12, lineHeight: 1.55, color: '#EDE9FE' }}>구매자 이메일 확인부터 수동 Google 초대, 전달 완료 상태까지 관리합니다.</p></div>
        <button type="button" onClick={() => void refresh()} disabled={refreshing} aria-label="새로고침" style={{ ...button, flexShrink: 0, minHeight: 38, background: 'rgba(255,255,255,.14)', color: '#fff', borderColor: 'rgba(255,255,255,.3)', opacity: refreshing ? .6 : 1 }}><RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} /></button>
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 13, fontSize: 12, cursor: 'pointer' }}><input type="checkbox" checked={polling} onChange={(event) => setPolling(event.target.checked)} /> 화면이 보일 때 30초마다 GET 새로고침</label>
    </header>

    {data && !data.enabled && <div role="alert" style={{ ...panel, background: '#FFFBEB', color: '#92400E', display: 'flex', gap: 10, alignItems: 'flex-start' }}><AlertTriangle size={18} /><div><strong>기능이 비활성화되어 있습니다.</strong><div style={{ marginTop: 4, fontSize: 12 }}>조회만 가능하며 모든 작업 버튼은 잠겨 있습니다.</div></div></div>}
    {error && <div role="alert" style={{ ...panel, background: '#FEF2F2', color: '#B91C1C', fontSize: 13 }}>{error}</div>}

    <section style={panel} aria-label="구매자 이메일 요청 안내">
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', color: '#4C1D95', fontWeight: 900 }}><Clipboard size={17} /> 이메일 요청 문구</div>
      <p style={{ margin: '9px 0', padding: 10, borderRadius: 10, background: '#F8F6FF', color: '#4B5563', fontSize: 13, lineHeight: 1.55, overflowWrap: 'anywhere' }}>{YOUTUBE_INVITE_EMAIL_REQUEST_MESSAGE}</p>
      <button type="button" onClick={() => void copyRequest()} style={{ ...button, width: '100%' }}>문구 복사</button>
      {copyFeedback && <div role="status" style={{ marginTop: 7, fontSize: 11, color: '#6B7280' }}>{copyFeedback}</div>}
      <div style={{ marginTop: 9, fontSize: 11, color: '#92400E' }}>요청은 구매자 채팅으로 직접 보내고, Google 가족 초대도 Google에서 수동으로 진행하세요.</div>
    </section>

    <section style={{ ...panel, display: 'grid', gap: 10 }} aria-label="초대 필터">
      <label style={{ display: 'grid', gap: 5, fontSize: 11, fontWeight: 800, color: '#6B7280' }}>상태
        <select value={status} onChange={(event) => setStatus(event.target.value as YouTubeInvitationStatus | 'all')} style={input}>
          <option value="all">전체 상태</option>{STATUSES.map((value) => <option key={value} value={value}>{STATUS_LABELS[value]}</option>)}
        </select>
      </label>
      <label style={{ display: 'grid', gap: 5, fontSize: 11, fontWeight: 800, color: '#6B7280' }}>가족 그룹
        <select value={familyGroupId} onChange={(event) => setFamilyGroupId(event.target.value)} style={input}>
          <option value="all">전체 그룹</option>{(data?.familyGroups || []).map((group) => <option key={group.id} value={group.id}>{group.label} · 잔여 {group.availableSeats}</option>)}
        </select>
      </label>
      <div style={{ fontSize: 12, color: '#6B7280' }}>표시 중 {filtered.length}건 / 전체 {data?.invitations.length || 0}건</div>
    </section>

    {loading && <div style={{ ...panel, textAlign: 'center', color: '#6D28D9', padding: 30 }}><Loader2 size={22} className="animate-spin" style={{ margin: '0 auto 8px' }} />불러오는 중...</div>}
    {!loading && !error && filtered.length === 0 && <div style={{ ...panel, textAlign: 'center', color: '#6B7280', padding: 30 }}><Users size={24} style={{ margin: '0 auto 8px', color: '#A78BFA' }} />조건에 맞는 초대 작업이 없습니다.</div>}
    <section style={{ display: 'grid', gap: 12 }} aria-label="유튜브 초대 작업 목록">
      {filtered.map((invitation) => <InvitationCard key={invitation.id} invitation={invitation} groupLabel={groupsById.get(invitation.familyGroupId)?.label || '알 수 없는 가족 그룹'} enabled={enabled} confirmedEmail={confirmedEmails[invitation.id]} onEmailConfirmed={rememberConfirmedEmail} onInviteSent={forgetConfirmedEmail} onRefresh={refresh} />)}
    </section>
    {data && data.enabled && <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 11, color: '#047857' }}><CheckCircle2 size={13} /> 초대 운영 기능 활성화</div>}
  </main>;
}
