import { useEffect, useId, useRef, useState } from 'react';
import { Check, Copy, Eye, EyeOff } from 'lucide-react';
import { copyTextToClipboard } from '../lib/clipboard';

export default function CredentialField({ label, value, secret = false, onChange, required, autoComplete = 'off', placeholder, maxLength }:
  { label: string; value: string; secret?: boolean; onChange?(value: string): void; required?: boolean; autoComplete?: string; placeholder?: string; maxLength?: number }) {
  const id = useId(); const [visible, setVisible] = useState(true); const [status, setStatus] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async () => {
    try { await copyTextToClipboard(value); setStatus('복사했습니다.'); }
    catch { setStatus('값을 길게 눌러 직접 복사해주세요.'); }
    clearTimeout(timer.current); timer.current = setTimeout(() => setStatus(''), 2500);
  };
  return <div className="credential-field" translate="no">
    <label htmlFor={id}>{label}</label>
    <div className="credential-field-row">
      <input id={id} value={value} type={secret && !visible ? 'password' : 'text'} readOnly={!onChange}
        onChange={onChange ? e => onChange(e.target.value) : undefined} onFocus={e => { if (!onChange) e.currentTarget.select(); }}
        autoComplete={autoComplete} autoCapitalize="none" autoCorrect="off" spellCheck={false}
        required={required} placeholder={placeholder} maxLength={maxLength} />
      <div className="credential-field-actions">
        {secret && <button type="button" aria-label={`${label} ${visible ? '숨기기' : '보기'}`} aria-pressed={visible}
          onClick={() => setVisible(v => !v)}>{visible ? <EyeOff size={16} /> : <Eye size={16} />}{visible ? '숨기기' : '보기'}</button>}
        <button type="button" aria-label={`${label} 복사`} disabled={!value} onClick={() => void copy()}>
          {status === '복사했습니다.' ? <Check size={16} /> : <Copy size={16} />}{status === '복사했습니다.' ? '복사됨' : '복사'}</button>
      </div>
    </div>
    {status && <span role="status" className="credential-field-status">{status}</span>}
  </div>;
}
