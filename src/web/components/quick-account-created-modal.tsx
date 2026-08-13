import { useEffect, useRef, useState } from 'react';
import { Check, CheckCircle2, Clipboard, CreditCard, PenLine, X } from 'lucide-react';
import { buildQuickAccountClipboard, type QuickGeneratedAccount } from '../lib/quick-generated-account-flow';

interface QuickAccountCreatedModalProps {
  account: QuickGeneratedAccount;
  paymentLoading: boolean;
  paymentError?: string;
  onMarkPaid(): Promise<void>;
  onWrite(): void;
  onClose(): void;
}

async function copyText(value: string) {
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable');
    await navigator.clipboard.writeText(value);
    return;
  } catch {
    const area = document.createElement('textarea');
    area.value = value;
    area.readOnly = true;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const copied = document.execCommand('copy');
    area.remove();
    if (!copied) throw new Error('복사 권한을 확인해주세요.');
  }
}

export default function QuickAccountCreatedModal({ account, paymentLoading, paymentError, onMarkPaid, onWrite, onClose }: QuickAccountCreatedModalProps) {
  const [copied, setCopied] = useState('');
  const [copyError, setCopyError] = useState('');
  const dialogRef = useRef<HTMLElement>(null);
  const copyAllRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const paid = account.paymentStatus === 'paid';

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    copyAllRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])') || []);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      previousFocus?.focus();
    };
  }, []);

  const copy = async (value: string, label: string) => {
    setCopyError('');
    try {
      await copyText(value);
      setCopied(label);
      window.setTimeout(() => setCopied(''), 1400);
    } catch (error: any) {
      setCopyError(error?.message || '복사하지 못했어요. 값을 길게 눌러 직접 복사해주세요.');
    }
  };

  const rows = [
    { label: '이메일 ID', value: account.email },
    { label: '비밀번호', value: account.password },
    { label: '이메일 PIN', value: account.pin },
  ];

  return (
    <div className="quick-account-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={dialogRef} className="quick-account-modal" role="dialog" aria-modal="true" aria-labelledby="quick-account-title">
        <div className="quick-account-modal-head">
          <div>
            <span className="quick-account-success-pill"><CheckCircle2 size={13} /> 생성 완료</span>
            <h2 id="quick-account-title">계정 정보가 준비됐어요</h2>
            <p>복사하고 결제한 뒤 바로 글을 작성하세요.</p>
          </div>
          <button type="button" className="quick-account-icon-button" onClick={onClose} aria-label="닫기"><X size={18} /></button>
        </div>

        <div className="quick-account-steps" aria-label="빠른 계정 생성 진행 단계">
          <span className="is-done"><Check size={12} /> 1. 생성</span>
          <span className={paid ? 'is-done' : 'is-current'}>{paid && <Check size={12} />} 2. 결제</span>
          <span className={paid ? 'is-current' : ''}>3. 글쓰기</span>
        </div>

        <div className="quick-account-service">{account.serviceType}</div>
        <div className="quick-account-credential-list">
          {rows.map((row) => (
            <div className="quick-account-credential" key={row.label}>
              <div><span>{row.label}</span><strong>{row.value}</strong></div>
              <button type="button" onClick={() => void copy(row.value, row.label)}>{copied === row.label ? <Check size={14} /> : <Clipboard size={14} />} {copied === row.label ? '복사됨' : '복사'}</button>
            </div>
          ))}
        </div>

        <button ref={copyAllRef} type="button" className="quick-account-copy-all" onClick={() => void copy(buildQuickAccountClipboard(account), 'all')}>
          {copied === 'all' ? <Check size={16} /> : <Clipboard size={16} />} {copied === 'all' ? '전체 정보 복사됨' : '정보 전체 복사'}
        </button>

        {copyError && <div className="quick-account-payment-error" role="alert">{copyError}</div>}
        {paymentError && <div className="quick-account-payment-error" role="alert">{paymentError}</div>}
        <div className="quick-account-primary-actions">
          <button type="button" className={paid ? 'is-complete' : ''} disabled={paid || paymentLoading} onClick={() => void onMarkPaid()}>
            {paid ? <Check size={16} /> : <CreditCard size={16} />} {paid ? '결제 완료 체크됨' : paymentLoading ? '저장 중…' : '결제 완료로 체크'}
          </button>
          <button type="button" className="is-primary" disabled={!paid || paymentLoading} onClick={onWrite} title={paid ? '현재 계정 카드의 N자리 게시글 작성 기능 열기' : '결제 완료 체크 후 사용할 수 있어요'}>
            <PenLine size={16} /> 글쓰기 바로 시작
          </button>
        </div>
        {!paid && <p className="quick-account-help">실제 결제를 마친 뒤 체크하세요. 결제 완료 전에는 판매 글쓰기를 열지 않습니다.</p>}
      </section>
    </div>
  );
}
