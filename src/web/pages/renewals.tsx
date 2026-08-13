import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ExternalLink, RefreshCw, ShieldCheck } from 'lucide-react';
import { filterRenewalRows } from '../lib/renewal-management';

type JobStatus = 'registered' | 'messaged' | 'message_sending' | 'message_error' | 'message_unknown' | 'message_skipped' | 'error' | 'uncertain' | 'verification_needed' | 'verifying' | 'registration_failed_safe' | null;
type ReviewAction = 'review_confirm' | 'reject' | 'coupon_approve' | 'mark_issued';
type AuditEntry = { action?: string; actor?: string; at?: string; reason?: string; from?: string; to?: string };

type RenewalRow = {
  idempotencyKey: string;
  dealUsid: string;
  productUsid: string;
  service: string;
  category: string;
  buyer: string;
  account: string;
  oldEnd: string;
  newEnd: string;
  dealDays: number;
  price: number;
  eligible: boolean;
  reason: string | null;
  jobStatus: JobStatus;
  registrationStatus: string;
  messageStatus: string;
  couponStatus: string;
  skipReason?: 'policy_disabled' | 'target_reached';
};

type ReviewItem = {
  id: string;
  idempotencyKey: string;
  dealUsid: string;
  productUsid: string;
  service: string;
  category?: string;
  buyer: string;
  account: string;
  oldEnd: string;
  newEnd: string;
  status: Exclude<JobStatus, null>;
  couponStatus: string;
  chatUrl?: string;
  transactionUrl?: string;
  reviewEvidence?: string;
  reviewReason?: string;
  audit?: AuditEntry[];
  reviewHistory?: AuditEntry[];
};

type Flags = { live: boolean; safeMode: boolean };
type MessagePolicy = { enabled: boolean; targetCount: number; sentCount: number; reservedCount: number; remaining: number; updatedAt?: string; updatedBy?: string };
type PageData = {
  rows: RenewalRow[];
  reviews: ReviewItem[];
  jobs: Array<{ id: string; idempotencyKey: string }>;
  counts: Record<string, number>;
  enabled: boolean;
  messagePolicy: MessagePolicy;
  flags: Flags;
};
type BatchResult = { idempotencyKey: string; outcome: string; job?: { id?: string } };
type ActionResult = { id: string; ok: boolean; error?: string };

type ConfirmState =
  | { kind: 'renewal' }
  | { kind: 'review'; action: ReviewAction; ids: string[] }
  | null;

const CATEGORY_ORDER = ['Netflix', 'tving', 'wavve', 'disney', 'WatchaPlay'] as const;
const CATEGORY_LABELS: Record<string, string> = {
  Netflix: '넷플릭스', tving: '티빙', wavve: '웨이브', disney: '디즈니+', WatchaPlay: '왓챠',
};
const STATUS_LABELS: Record<string, string> = {
  registered: '등록 완료 확인', messaged: '메시지 완료', message_sending: '메시지 발송 중', message_error: '메시지 오류', message_unknown: '메시지 확인 필요', message_skipped: '메시지 생략', error: '등록 오류',
  uncertain: '자동 확인 필요', verification_needed: '자동 확인 필요', verifying: '자동 확인 중', registration_failed_safe: '미등록 확인',
  awaiting_review: '확인 필요', review_confirmed: '후기 확인', coupon_approved: '쿠폰 승인', issued: '수동 지급 완료', rejected: '반려', failed: '실패',
  not_started: '미처리',
};
const OUTCOME_LABELS: Record<string, string> = {
  dry_run: '미리보기', messaged: '완료', message_skipped: '메시지 생략', message_error: '메시지 오류', registration_error: '등록 오류',
  registration_uncertain: '자동 확인 필요', duplicate_selection: '중복 선택', unknown_key: '후보 없음', already_processed: '이미 처리됨',
};
const REVIEW_ACTION_LABELS: Record<ReviewAction, string> = {
  review_confirm: '후기 확인', reject: '반려', coupon_approve: '쿠폰 승인', mark_issued: '수동 지급 완료',
};

const panel: React.CSSProperties = { background: '#fff', border: '1px solid #EDE9FE', borderRadius: 16, padding: 16, boxShadow: '0 5px 20px rgba(76,29,149,.05)' };
const button: React.CSSProperties = { minHeight: 40, border: '1px solid #DDD6FE', borderRadius: 10, background: '#fff', color: '#5B21B6', fontWeight: 800, cursor: 'pointer', padding: '8px 12px', fontFamily: 'inherit' };
const primaryButton: React.CSSProperties = { ...button, background: '#7C3AED', color: '#fff', borderColor: '#7C3AED' };
const inputStyle: React.CSSProperties = { minHeight: 40, border: '1px solid #DDD6FE', borderRadius: 10, padding: '8px 10px', fontFamily: 'inherit', minWidth: 0, background: '#fff' };

function responseError(payload: any, fallback: string): string {
  return String(payload?.message || payload?.error || fallback).slice(0, 180);
}

async function readJson(response: Response): Promise<any> {
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) throw new Error(`JSON 응답이 아닙니다 (${response.status})`);
  const payload = await response.json();
  if (!response.ok || payload?.ok === false) throw new Error(responseError(payload, `요청 실패 (${response.status})`));
  return payload;
}

function formatDate(value: string): string {
  const match = String(value || '').match(/^(\d{4})(\d{2})(\d{2})T?(\d{2})?(\d{2})?/);
  return match ? `${match[1]}.${match[2]}.${match[3]}${match[4] ? ` ${match[4]}:${match[5] || '00'}` : ''}` : (value || '-');
}

function maskIdentifier(value: string): string {
  const text = String(value || '').trim();
  if (!text || text === '-') return '-';
  if (text.includes('*')) return text;
  const at = text.indexOf('@');
  if (at >= 0) return `${text.slice(0, Math.min(2, at))}***${text.slice(at)}`;
  return text.length < 2 ? '*' : `${text[0]}${'*'.repeat(Math.max(1, text.length - 2))}${text[text.length - 1]}`;
}

function statusBadge(status: string | null) {
  const warning = ['message_error', 'message_unknown', 'error', 'uncertain', 'verification_needed', 'verifying', 'awaiting_review'].includes(status || '');
  const good = status === 'messaged' || status === 'issued' || status === 'registered' || status === 'registration_failed_safe';
  return <span className={`renewal-badge ${warning ? 'warning' : good ? 'success' : ''}`}>{STATUS_LABELS[status || 'not_started'] || status || '미처리'}</span>;
}

function reviewActionAllowed(status: string, action: ReviewAction): boolean {
  if (action === 'review_confirm') return status === 'awaiting_review';
  if (action === 'reject') return status === 'awaiting_review' || status === 'review_confirmed';
  if (action === 'coupon_approve') return status === 'review_confirmed';
  return status === 'coupon_approved';
}

export default function RenewalsPage() {
  const [data, setData] = useState<PageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [section, setSection] = useState<'renewals' | 'reviews'>('renewals');
  const [category, setCategory] = useState('all');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [literalConfirm, setLiteralConfirm] = useState('');
  const [confirm, setConfirm] = useState<ConfirmState>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const actionLock = useRef(false);
  const [batchResults, setBatchResults] = useState<BatchResult[]>([]);
  const [reviewResults, setReviewResults] = useState<ActionResult[]>([]);
  const [reviewStatus, setReviewStatus] = useState('all');
  const [reviewSearch, setReviewSearch] = useState('');
  const [reviewSelected, setReviewSelected] = useState<Set<string>>(new Set());
  const [reason, setReason] = useState('');
  const [evidence, setEvidence] = useState('');
  const [messagePolicyEnabled, setMessagePolicyEnabled] = useState(true);
  const [messagePolicyTarget, setMessagePolicyTarget] = useState(5);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError('');
    try {
      const [candidatePayload, statusPayload, reviewPayload, messagePolicyPayload] = await Promise.all([
        fetch('/api/renewal-automation/candidates', { signal }).then(readJson),
        fetch('/api/renewal-automation/status', { signal }).then(readJson),
        fetch('/api/renewal-automation/reviews', { signal }).then(readJson),
        fetch('/api/renewal-automation/message-policy', { signal }).then(readJson),
      ]);
      const messagePolicy: MessagePolicy = messagePolicyPayload.policy;
      setData({
        rows: Array.isArray(candidatePayload.rows) ? candidatePayload.rows : [],
        reviews: Array.isArray(reviewPayload.items) ? reviewPayload.items : [],
        jobs: Array.isArray(statusPayload.jobs) ? statusPayload.jobs : [],
        counts: statusPayload.counts || {},
        enabled: Boolean(statusPayload.enabled ?? candidatePayload.enabled),
        messagePolicy,
        flags: { live: Boolean(statusPayload.live ?? candidatePayload.live), safeMode: Boolean(candidatePayload.safeMode) },
      });
      setMessagePolicyEnabled(Boolean(messagePolicy.enabled));
      setMessagePolicyTarget(Number(messagePolicy.targetCount));
      setRevision((value) => value + 1);
    } catch (loadError: any) {
      if (loadError?.name !== 'AbortError') setError(String(loadError?.message || '연장 관리 데이터를 불러오지 못했습니다.'));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  useEffect(() => { setSelected(new Set()); }, [category, search, statusFilter, revision]);
  useEffect(() => { setReviewSelected(new Set()); }, [reviewStatus, reviewSearch, revision]);
  useEffect(() => {
    if (!confirm) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape' && !actionLoading) setConfirm(null); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [confirm, actionLoading]);

  const rows = data?.rows || [];
  const filteredRows = useMemo(() => filterRenewalRows(rows, { category, search, status: statusFilter }), [rows, category, search, statusFilter]);
  const selectableFiltered = filteredRows.filter((row) => row.eligible && !row.jobStatus);
  const selectableCategory = rows.filter((row) => row.category === category && row.eligible && !row.jobStatus);
  const selectedRows = rows.filter((row) => selected.has(row.idempotencyKey));
  const enabled = Boolean(data?.enabled);
  const flags = data?.flags || { live: false, safeMode: false };
  const canExecute = enabled && flags.live && !flags.safeMode && literalConfirm === '연장' && selected.size > 0 && !actionLoading;
  const disabledReason = flags.safeMode ? '안전 모드가 켜져 있습니다.' : !enabled ? '연장 자동화가 비활성화되어 있습니다.' : !flags.live ? 'LIVE 잠금이 해제되지 않았습니다.' : '';

  const reviews = useMemo(() => [...(data?.reviews || [])].sort((a, b) => Number(b.couponStatus === 'awaiting_review') - Number(a.couponStatus === 'awaiting_review')), [data?.reviews]);
  const filteredReviews = useMemo(() => {
    const query = reviewSearch.trim().toLocaleLowerCase('ko');
    return reviews.filter((item) => (reviewStatus === 'all' || item.couponStatus === reviewStatus)
      && (!query || [item.service, item.buyer, item.account, item.dealUsid, item.reviewReason, item.reviewEvidence].some((value) => String(value || '').toLocaleLowerCase('ko').includes(query))));
  }, [reviews, reviewStatus, reviewSearch]);
  const chosenReviews = reviews.filter((item) => reviewSelected.has(item.id));

  const toggleSelected = (key: string) => setSelected((current) => {
    const next = new Set(current); next.has(key) ? next.delete(key) : next.add(key); return next;
  });
  const toggleReviewSelected = (id: string) => setReviewSelected((current) => {
    const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next;
  });
  const selectKeys = (items: RenewalRow[]) => setSelected(new Set(items.map((row) => row.idempotencyKey)));

  const runBatch = async () => {
    if (!canExecute || actionLock.current) return;
    actionLock.current = true; setActionLoading(true); setBatchResults([]);
    try {
      const payload = await fetch('/api/renewal-automation/batch', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idempotencyKeys: [...selected], dryRun: false }),
      }).then(readJson);
      setBatchResults(Array.isArray(payload.results) ? payload.results : []);
      setConfirm(null); setLiteralConfirm('');
      await load();
    } catch (actionError: any) {
      setError(String(actionError?.message || '선택 연장 실행에 실패했습니다.'));
    } finally {
      actionLock.current = false; setActionLoading(false);
    }
  };

  const retryMessage = async (row: RenewalRow) => {
    if (row.jobStatus !== 'message_error' || !enabled || !flags.live || flags.safeMode || actionLock.current) return;
    const statusJob = data?.jobs.find((item) => item.idempotencyKey === row.idempotencyKey)?.id;
    if (!statusJob) { setError('메시지 재시도 작업 ID를 찾지 못했습니다. 새로고침 후 다시 시도하세요.'); return; }
    if (!window.confirm('연장 상품을 다시 등록하지 않고 메시지만 다시 전송할까요?')) return;
    actionLock.current = true; setActionLoading(true);
    try {
      await fetch(`/api/renewal-automation/jobs/${encodeURIComponent(statusJob)}/retry-message`, { method: 'POST' }).then(readJson);
      await load();
    } catch (actionError: any) { setError(String(actionError?.message || '메시지 재시도 실패')); }
    finally { actionLock.current = false; setActionLoading(false); }
  };

  const reconcileRegistration = async (row: RenewalRow) => {
    if (!['uncertain', 'verification_needed'].includes(row.jobStatus || '') || flags.safeMode || actionLock.current) return;
    const statusJob = data?.jobs.find((item) => item.idempotencyKey === row.idempotencyKey)?.id;
    if (!statusJob) { setError('자동 확인 작업 ID를 찾지 못했습니다. 새로고침 후 다시 시도하세요.'); return; }
    actionLock.current = true; setActionLoading(true);
    try {
      await fetch(`/api/renewal-automation/jobs/${encodeURIComponent(statusJob)}/reconcile-registration`, { method: 'POST' }).then(readJson);
      await load();
    } catch (actionError: any) { setError(String(actionError?.message || '등록 결과 자동 확인 실패')); }
    finally { actionLock.current = false; setActionLoading(false); }
  };

  const retryRegistration = async (row: RenewalRow) => {
    const canRetry = row.jobStatus === 'registration_failed_safe' && enabled && flags.live && !flags.safeMode;
    if (!canRetry || actionLock.current) return;
    const statusJob = data?.jobs.find((item) => item.idempotencyKey === row.idempotencyKey)?.id;
    if (!statusJob) { setError('연장 재등록 작업 ID를 찾지 못했습니다. 새로고침 후 다시 시도하세요.'); return; }
    if (!window.confirm('최신 후보 상태를 다시 검증한 뒤 한 번의 등록 요청과 성공 후 메시지 전송을 실행할까요?')) return;
    actionLock.current = true; setActionLoading(true);
    try {
      await fetch(`/api/renewal-automation/jobs/${encodeURIComponent(statusJob)}/retry-registration`, { method: 'POST' }).then(readJson);
      await load();
    } catch (actionError: any) { setError(String(actionError?.message || '연장 다시 등록 실패')); }
    finally { actionLock.current = false; setActionLoading(false); }
  };

  const saveMessagePolicy = async () => {
    if (!Number.isInteger(messagePolicyTarget) || messagePolicyTarget < 0 || messagePolicyTarget > 100 || flags.safeMode || actionLock.current) return;
    actionLock.current = true; setActionLoading(true);
    try {
      await fetch('/api/renewal-automation/message-policy', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: messagePolicyEnabled, targetCount: messagePolicyTarget }),
      }).then(readJson);
      await load();
    } catch (actionError: any) { setError(String(actionError?.message || '메시지 발송 정책 저장 실패')); }
    finally { actionLock.current = false; setActionLoading(false); }
  };

  const openReviewConfirm = (action: ReviewAction, ids: string[]) => {
    const items = reviews.filter((item) => ids.includes(item.id));
    if (!reason.trim() || !ids.length || flags.safeMode || !items.every((item) => reviewActionAllowed(item.couponStatus, action))) return;
    setConfirm({ kind: 'review', action, ids });
  };

  const runReviewAction = async (state: Extract<ConfirmState, { kind: 'review' }>) => {
    if (!reason.trim() || flags.safeMode || actionLock.current) return;
    actionLock.current = true; setActionLoading(true); setReviewResults([]);
    try {
      const payload = await fetch('/api/renewal-automation/reviews/action', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: state.ids, action: state.action, reason: reason.trim(), evidence: evidence.trim() }),
      }).then(readJson);
      setReviewResults(Array.isArray(payload.results) ? payload.results : []);
      setConfirm(null); setReason(''); setEvidence('');
      await load();
    } catch (actionError: any) { setError(String(actionError?.message || '후기 검수 작업 실패')); }
    finally { actionLock.current = false; setActionLoading(false); }
  };

  const results = batchResults;
  const summary = {
    candidates: rows.length,
    eligible: rows.filter((row) => row.eligible && !row.jobStatus).length,
    warnings: rows.filter((row) => ['message_error', 'message_unknown', 'error', 'uncertain', 'verification_needed', 'verifying'].includes(row.jobStatus || '')).length,
    awaiting: reviews.filter((item) => item.couponStatus === 'awaiting_review').length,
  };

  return (
    <main className="renewals-page">
      <header className="renewals-header">
        <div style={{ minWidth: 0 }}>
          <p style={{ color: '#7C3AED', fontSize: 12, fontWeight: 900, margin: 0 }}>관리자 전용</p>
          <h1 style={{ margin: '4px 0', color: '#1E1B4B', fontSize: 24 }}>연장 관리</h1>
          <p style={{ margin: 0, color: '#6B7280', fontSize: 13 }}>후보 확인부터 후기 쿠폰의 수동 지급 확인까지 추적합니다.</p>
        </div>
        <button type="button" style={button} onClick={() => void load()} disabled={loading} aria-label="연장 관리 데이터 다시 불러오기">
          <RefreshCw size={15} aria-hidden="true" /> {loading ? '불러오는 중' : '새로고침'}
        </button>
      </header>

      {error && <div role="alert" className="renewal-alert error"><AlertTriangle size={17} /> <span>{error}</span><button type="button" onClick={() => void load()}>재시도</button></div>}
      {!data && loading && <div role="status" className="renewal-loading">연장 후보·상태·후기 검수함을 불러오는 중입니다…</div>}

      {data && <>
        {loading && <div className="renewal-refreshing" role="status">최신 데이터를 확인 중입니다. 마지막 성공 데이터는 유지됩니다.</div>}
        <section className="renewal-summary" aria-label="연장 관리 요약">
          {[['전체 후보', summary.candidates], ['실행 가능', summary.eligible], ['오류·확인 필요', summary.warnings], ['후기 확인 필요', summary.awaiting]].map(([label, value]) => (
            <article key={String(label)} style={panel}><span>{label}</span><strong>{value}</strong></article>
          ))}
        </section>

        <section style={panel} aria-labelledby="renewal-message-policy-title">
          <div className="renewal-panel-heading">
            <div><h2 id="renewal-message-policy-title">메시지 발송</h2><p>후기 요청 메시지를 필요한 인원에게만 제한합니다.</p></div>
            <span className={`renewal-badge ${messagePolicyEnabled && data.messagePolicy.remaining > 0 ? 'success' : 'warning'}`}>{messagePolicyEnabled ? 'ON' : 'OFF'}</span>
          </div>
          <div className="renewal-filters">
            <label>메시지 발송
              <select aria-label="연장 메시지 발송 ON OFF" value={messagePolicyEnabled ? 'on' : 'off'} onChange={(event) => setMessagePolicyEnabled(event.target.value === 'on')} style={inputStyle}>
                <option value="on">ON</option><option value="off">OFF</option>
              </select>
            </label>
            <label>목표
              <input aria-label="후기 요청 메시지 목표 인원" type="number" min={0} max={100} step={1} value={messagePolicyTarget} onChange={(event) => setMessagePolicyTarget(Number(event.target.value))} style={inputStyle} />
            </label>
            <div><span>발송 / 예약</span><strong>{data.messagePolicy.sentCount} / {data.messagePolicy.reservedCount}명</strong></div>
            <div><span>남은 목표</span><strong>{data.messagePolicy.remaining}명</strong></div>
            <button type="button" style={primaryButton} disabled={flags.safeMode || actionLoading || !Number.isInteger(messagePolicyTarget) || messagePolicyTarget < 0 || messagePolicyTarget > 100} onClick={() => void saveMessagePolicy()}>저장</button>
          </div>
          <p className="renewal-muted">목표에 도달하면 메시지는 자동으로 생략됩니다. 연장 상품 등록은 계속 진행됩니다.</p>
        </section>

        <div className="renewal-section-tabs" role="tablist" aria-label="연장 관리 섹션">
          <button type="button" role="tab" aria-selected={section === 'renewals'} onClick={() => setSection('renewals')}>연장 후보</button>
          <button type="button" role="tab" aria-selected={section === 'reviews'} onClick={() => setSection('reviews')}>관리자 후기 검수함 <b>{summary.awaiting}</b></button>
        </div>

        {section === 'renewals' ? <section style={panel} aria-labelledby="renewal-candidates-title">
          <div className="renewal-panel-heading">
            <div><h2 id="renewal-candidates-title">연장 후보</h2><p>백엔드의 카테고리·만료일 정렬 순서를 유지합니다.</p></div>
            <div className={`renewal-live-state ${disabledReason ? 'blocked' : ''}`}><ShieldCheck size={15} /> {disabledReason || 'LIVE 실행 가능'}</div>
          </div>

          <div className="renewal-category-tabs" role="tablist" aria-label="서비스 카테고리 필터">
            <button type="button" role="tab" aria-selected={category === 'all'} onClick={() => setCategory('all')}>전체</button>
            {CATEGORY_ORDER.map((item) => <button key={item} type="button" role="tab" aria-selected={category === item} onClick={() => setCategory(item)}>{CATEGORY_LABELS[item]}</button>)}
          </div>
          <div className="renewal-filters">
            <label>후보 검색<input aria-label="연장 후보 검색" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="서비스, 구매자, 계정, 키" style={inputStyle} /></label>
            <label>처리 상태<select aria-label="연장 처리 상태 필터" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} style={inputStyle}>
              <option value="all">전체 상태</option><option value="registered">등록 완료 확인</option><option value="messaged">메시지 완료</option><option value="message_skipped">메시지 생략</option><option value="message_error">메시지 오류</option><option value="error">등록 오류</option><option value="verification_needed">자동 확인 필요</option><option value="verifying">자동 확인 중</option><option value="registration_failed_safe">미등록 확인</option>
            </select></label>
          </div>
          <div className="renewal-selection-actions">
            <button type="button" style={button} onClick={() => selectKeys(selectableFiltered)} disabled={!selectableFiltered.length}>현재 필터 전체 선택</button>
            <button type="button" style={button} onClick={() => selectKeys(selectableCategory)} disabled={category === 'all' || !selectableCategory.length}>카테고리 전체 선택</button>
            <button type="button" style={button} onClick={() => setSelected(new Set())} disabled={!selected.size}>선택 해제</button>
            <span aria-live="polite">선택 {selected.size}건</span>
            <button type="button" style={primaryButton} onClick={() => { setLiteralConfirm(''); setConfirm({ kind: 'renewal' }); }} disabled={!selected.size || Boolean(disabledReason)} title={disabledReason || '선택한 후보 연장 실행 확인'}>선택 연장 실행</button>
          </div>

          <div className="renewal-table-wrap">
            <table className="renewal-table"><thead><tr><th><span className="sr-only">선택</span></th><th>서비스</th><th>구매자 / 계정</th><th>기간</th><th>가격</th><th>상태</th><th>작업</th></tr></thead>
              <tbody>{filteredRows.map((row) => {
                const selectable = row.eligible && !row.jobStatus;
                return <tr key={row.idempotencyKey}>
                  <td><input type="checkbox" aria-label={`${row.service} ${row.buyer} 연장 선택`} checked={selected.has(row.idempotencyKey)} disabled={!selectable} title={selectable ? '선택 가능' : '이미 처리되었거나 실행할 수 없습니다.'} onChange={() => toggleSelected(row.idempotencyKey)} /></td>
                  <td>{row.service}</td>
                  <td>{maskIdentifier(row.buyer)} · {maskIdentifier(row.account)}</td>
                  <td>{formatDate(row.oldEnd)} → {formatDate(row.newEnd)}</td>
                  <td>{Number(row.price || 0).toLocaleString('ko-KR')}원</td>
                  <td>{statusBadge(row.jobStatus)}{['uncertain', 'verification_needed'].includes(row.jobStatus || '') && <small className="renewal-warning-text">등록 여부를 읽기 전용으로 교차 확인할 수 있습니다.</small>}{row.jobStatus === 'verifying' && <small className="renewal-warning-text">Graytag 상태를 자동 확인 중입니다.</small>}{row.jobStatus === 'message_skipped' && <small className="renewal-muted">{row.skipReason === 'policy_disabled' ? '정책 비활성' : '목표 도달'}</small>}</td>
                  <td>{row.jobStatus === 'message_error' ? <button type="button" style={button} disabled={Boolean(disabledReason) || actionLoading} title={disabledReason || '상품 등록 없이 메시지만 재시도'} onClick={() => void retryMessage(row)}>메시지 재시도</button> : ['uncertain', 'verification_needed'].includes(row.jobStatus || '') ? <button type="button" style={button} disabled={flags.safeMode || actionLoading} title={flags.safeMode ? '안전 모드에서는 확인할 수 없습니다.' : '연장 후보와 판매자 상품을 교차 확인'} onClick={() => void reconcileRegistration(row)}>등록 결과 자동 확인</button> : <span className="renewal-muted">{row.jobStatus === 'registration_failed_safe' ? <button type="button" style={button} disabled={!enabled || !flags.live || flags.safeMode || actionLoading} onClick={() => void retryRegistration(row)}>연장 다시 등록</button> : '-'}</span>}</td>
                </tr>;
              })}</tbody>
            </table>
          </div>
          <div className="renewal-mobile-list">{filteredRows.map((row) => {
            const selectable = row.eligible && !row.jobStatus;
            return <article className="renewal-mobile-card" key={row.idempotencyKey}>
              <label className="renewal-mobile-select"><input type="checkbox" aria-label={`${row.service} ${row.buyer} 모바일 연장 선택`} checked={selected.has(row.idempotencyKey)} disabled={!selectable} onChange={() => toggleSelected(row.idempotencyKey)} /> <b>{row.service}</b>{statusBadge(row.jobStatus)}</label>
              <dl><div><dt>구매자</dt><dd>{row.buyer} · {row.account}</dd></div><div><dt>기간</dt><dd>{formatDate(row.oldEnd)} → {formatDate(row.newEnd)}</dd></div><div><dt>가격</dt><dd>{Number(row.price || 0).toLocaleString('ko-KR')}원</dd></div></dl>
              {['uncertain', 'verification_needed'].includes(row.jobStatus || '') && <><p className="renewal-warning-text">연장 후보와 판매자 상품을 교차 조회해 등록 여부를 자동 확인합니다.</p><button type="button" style={button} disabled={flags.safeMode || actionLoading} onClick={() => void reconcileRegistration(row)}>등록 결과 자동 확인</button></>}
              {row.jobStatus === 'verifying' && <p className="renewal-warning-text">Graytag 상태를 자동 확인 중입니다.</p>}
              {row.jobStatus === 'registration_failed_safe' && <><p className="renewal-muted">미등록이 확인되었습니다. 최신 후보를 다시 검증한 뒤 재등록할 수 있습니다.</p><button type="button" style={primaryButton} disabled={!enabled || !flags.live || flags.safeMode || actionLoading} onClick={() => void retryRegistration(row)}>연장 다시 등록</button></>}
              {row.jobStatus === 'message_skipped' && <p className="renewal-muted">메시지 생략 · {row.skipReason === 'policy_disabled' ? '정책 비활성' : '목표 도달'}</p>}
              {row.jobStatus === 'message_error' && <button type="button" style={button} disabled={Boolean(disabledReason) || actionLoading} title={disabledReason || '메시지만 재시도'} onClick={() => void retryMessage(row)}>메시지 재시도</button>}
            </article>;
          })}</div>
          {!filteredRows.length && <p className="renewal-empty">조건에 맞는 연장 후보가 없습니다.</p>}

          {results.length > 0 && <div className="renewal-results" aria-live="polite"><h3>실행 결과</h3>{results.map((result) => <div key={`${result.idempotencyKey}-${result.outcome}`}><code>{result.idempotencyKey}</code><span className={`renewal-badge ${result.outcome === 'messaged' ? 'success' : 'warning'}`}>{OUTCOME_LABELS[result.outcome] || result.outcome}</span></div>)}</div>}
        </section> : <section style={panel} aria-labelledby="review-inbox-title">
          <div className="renewal-panel-heading"><div><h2 id="review-inbox-title">관리자 후기 검수함</h2><p>확인 필요 항목이 먼저 표시됩니다. <strong>자동 발급/전송이 아닙니다</strong>.</p></div><span className="renewal-badge warning">수동 검수 · 수동 지급만</span></div>
          <div className="renewal-filters">
            <label>후기 검색<input aria-label="후기 검수함 검색" value={reviewSearch} onChange={(event) => setReviewSearch(event.target.value)} placeholder="서비스, 구매자, 거래 ID" style={inputStyle} /></label>
            <label>검수 상태<select aria-label="후기 검수 상태 필터" value={reviewStatus} onChange={(event) => setReviewStatus(event.target.value)} style={inputStyle}><option value="all">전체 상태</option>{['awaiting_review', 'review_confirmed', 'coupon_approved', 'issued', 'rejected', 'failed'].map((status) => <option value={status} key={status}>{STATUS_LABELS[status]}</option>)}</select></label>
          </div>
          <div className="renewal-review-inputs">
            <label>판단 근거 / 증빙<input aria-label="후기 검수 증빙" value={evidence} onChange={(event) => setEvidence(event.target.value)} maxLength={500} placeholder="후기 URL, 채팅 확인 내용 등" style={inputStyle} /></label>
            <label>처리 사유 (필수)<textarea aria-label="후기 검수 처리 사유" value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} placeholder="누가 보아도 이해할 수 있는 처리 사유" /></label>
          </div>
          <div className="renewal-selection-actions">
            <button type="button" style={button} onClick={() => setReviewSelected(new Set(filteredReviews.map((item) => item.id)))} disabled={!filteredReviews.length}>현재 검수 목록 전체 선택</button>
            <button type="button" style={button} onClick={() => setReviewSelected(new Set())} disabled={!reviewSelected.size}>선택 해제</button><span>선택 {reviewSelected.size}건</span>
            {(Object.keys(REVIEW_ACTION_LABELS) as ReviewAction[]).map((action) => {
              const allowed = chosenReviews.length > 0 && chosenReviews.every((item) => reviewActionAllowed(item.couponStatus, action));
              return <button key={action} type="button" style={action === 'mark_issued' ? primaryButton : button} disabled={!reason.trim() || !allowed || flags.safeMode || actionLoading} title={flags.safeMode ? '안전 모드에서는 변경할 수 없습니다.' : !reason.trim() ? '처리 사유를 입력하세요.' : !allowed ? '선택 항목의 현재 상태에서 실행할 수 없습니다.' : `${chosenReviews.length}건 ${REVIEW_ACTION_LABELS[action]}`} onClick={() => openReviewConfirm(action, [...reviewSelected])}>{REVIEW_ACTION_LABELS[action]}</button>;
            })}
          </div>

          <div className="renewal-review-list">{filteredReviews.map((item) => {
            const history = [...(item.reviewHistory || []), ...(item.audit || [])];
            return <article className="renewal-review-card" key={item.id}>
              <div className="renewal-review-card-head"><label><input type="checkbox" aria-label={`${item.service} ${item.buyer} 후기 검수 선택`} checked={reviewSelected.has(item.id)} onChange={() => toggleReviewSelected(item.id)} /> <b>{item.service}</b></label>{statusBadge(item.couponStatus)}</div>
              <dl><div><dt>구매자 / 계정</dt><dd>{maskIdentifier(item.buyer)} · {maskIdentifier(item.account)}</dd></div><div><dt>거래</dt><dd>{maskIdentifier(item.dealUsid)}</dd></div><div><dt>연장 기간</dt><dd>{formatDate(item.oldEnd)} → {formatDate(item.newEnd)}</dd></div></dl>
              <div className="renewal-review-links">{item.chatUrl && <a href={item.chatUrl} target="_blank" rel="noreferrer">채팅 열기 <ExternalLink size={13} /></a>}{item.transactionUrl && <a href={item.transactionUrl} target="_blank" rel="noreferrer">거래 확인 <ExternalLink size={13} /></a>}</div>
              {(item.reviewEvidence || item.reviewReason) && <p className="renewal-review-note">{item.reviewEvidence || item.reviewReason}</p>}
              <div className="renewal-row-actions">{(Object.keys(REVIEW_ACTION_LABELS) as ReviewAction[]).filter((action) => reviewActionAllowed(item.couponStatus, action)).map((action) => <button key={action} type="button" style={action === 'mark_issued' ? primaryButton : button} disabled={!reason.trim() || flags.safeMode || actionLoading} title={flags.safeMode ? '안전 모드에서는 변경할 수 없습니다.' : !reason.trim() ? '위 처리 사유를 먼저 입력하세요.' : REVIEW_ACTION_LABELS[action]} onClick={() => openReviewConfirm(action, [item.id])}>{REVIEW_ACTION_LABELS[action]}</button>)}</div>
              <details><summary>감사 기록 {history.length}건</summary>{history.length ? <ol className="renewal-audit-timeline">{history.map((entry, index) => <li key={`${entry.at}-${index}`}><b>{entry.action || '상태 변경'}</b><span>{entry.from && entry.to ? `${STATUS_LABELS[entry.from] || entry.from} → ${STATUS_LABELS[entry.to] || entry.to}` : ''}</span><small>{entry.at ? new Date(entry.at).toLocaleString('ko-KR') : '-'} · {entry.actor || 'admin'} · {entry.reason || '-'}</small></li>)}</ol> : <p className="renewal-muted">기록 없음</p>}</details>
            </article>;
          })}</div>
          {!filteredReviews.length && <p className="renewal-empty">조건에 맞는 후기 검수 항목이 없습니다.</p>}
          {reviewResults.length > 0 && <div className="renewal-results" aria-live="polite"><h3>검수 처리 결과</h3>{reviewResults.map((result) => <div key={result.id}><code>{result.id}</code><span className={`renewal-badge ${result.ok ? 'success' : 'warning'}`}>{result.ok ? '완료' : result.error || '실패'}</span></div>)}</div>}
        </section>}
      </>}

      {confirm?.kind === 'renewal' && <div className="renewal-modal-backdrop" role="presentation"><div className="renewal-modal" role="dialog" aria-modal="true" aria-labelledby="renewal-confirm-title">
        <h2 id="renewal-confirm-title">선택 연장 실행 확인</h2><p><b>선택한 {selected.size}건</b>의 연장 상품을 실제 등록하고 메시지를 전송합니다.</p>
        <dl><div><dt>카테고리</dt><dd>{[...new Set(selectedRows.map((row) => CATEGORY_LABELS[row.category] || row.category))].join(', ') || '-'}</dd></div><div><dt>날짜 범위</dt><dd>{selectedRows.length ? `${formatDate(selectedRows.map((row) => row.oldEnd).sort()[0])} ~ ${formatDate(selectedRows.map((row) => row.newEnd).sort()[selectedRows.length - 1] || '')}` : '-'}</dd></div></dl>
        <div className="renewal-alert warning"><AlertTriangle size={17} />중복 방지 키별로 실행됩니다. 응답이 끊기면 자동 교차 확인하며, 확인 전에는 재등록하지 않습니다. 일부 결과만 성공할 수 있습니다.</div>
        <label>실행 확인 문구<input autoFocus aria-label="연장 실행 확인 문구" value={literalConfirm} onChange={(event) => setLiteralConfirm(event.target.value)} placeholder="연장" style={inputStyle} /></label><small>정확히 “연장”을 입력하세요.</small>
        {disabledReason && <p role="alert" className="renewal-warning-text">실행 불가: {disabledReason}</p>}
        <div className="renewal-modal-actions"><button type="button" style={button} onClick={() => setConfirm(null)} disabled={actionLoading}>취소</button><button type="button" style={primaryButton} onClick={() => void runBatch()} disabled={!canExecute} title={!canExecute ? disabledReason || '선택과 확인 문구를 확인하세요.' : '실제 연장 실행'}>{actionLoading ? '실행 중…' : '연장 실행'}</button></div>
      </div></div>}

      {confirm?.kind === 'review' && <div className="renewal-modal-backdrop" role="presentation"><div className="renewal-modal" role="dialog" aria-modal="true" aria-labelledby="review-confirm-title">
        <h2 id="review-confirm-title">{REVIEW_ACTION_LABELS[confirm.action]} 확인</h2><p>선택한 {confirm.ids.length}건을 처리합니다. 사유와 증빙은 감사 기록에 남습니다.</p><p><strong>자동 발급/전송이 아닙니다.</strong>{confirm.action === 'mark_issued' && ' 외부에서 실제 지급을 마친 뒤에만 수동 지급 완료로 표시하세요.'}</p>
        <dl><div><dt>처리 사유</dt><dd>{reason}</dd></div><div><dt>증빙</dt><dd>{evidence || '입력 없음'}</dd></div></dl>
        <div className="renewal-modal-actions"><button type="button" style={button} onClick={() => setConfirm(null)} disabled={actionLoading}>취소</button><button type="button" style={primaryButton} onClick={() => void runReviewAction(confirm)} disabled={!reason.trim() || flags.safeMode || actionLoading}>{actionLoading ? '처리 중…' : REVIEW_ACTION_LABELS[confirm.action]}</button></div>
      </div></div>}
    </main>
  );
}
