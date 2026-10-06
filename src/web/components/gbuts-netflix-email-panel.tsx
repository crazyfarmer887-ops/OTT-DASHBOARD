import { useState } from 'react';
import { safeEmailVerifyUrl } from '../lib/email-verify-url';

export default function GbutsNetflixEmailPanel({ url, pin }: { url?: string; pin?: string }) {
  const [open, setOpen] = useState(false);
  const safeUrl = safeEmailVerifyUrl(url);
  if (!safeUrl) return <p style={{ fontSize: 12, color: '#6B7280', lineHeight: 1.6 }}>이메일 인증이 필요하지만 확인 화면이 없으면 구매하신 1:1 채팅으로 문의해 주세요.</p>;
  return <section aria-label="가구 인증·로그인 코드 확인" style={{ marginTop: 12 }}>
    <button type="button" aria-expanded={open} onClick={() => setOpen(value => !value)} style={{ width: '100%', border: 0, borderRadius: 14, padding: 14, background: '#7C3AED', color: '#fff', fontWeight: 900, cursor: 'pointer' }}>{open ? '인증 확인 화면 닫기' : '가구 인증·로그인 코드 확인'}</button>
    {open && <>
      <p style={{ fontSize: 12, lineHeight: 1.6 }}>아래 이메일 확인 화면에 {pin ? '위에 표시된 이메일 PIN을 입력한 뒤' : '판매자가 안내한 이메일 PIN을 입력한 뒤'} 넷플릭스 인증 메일을 확인하세요. 메일 안의 로그인 코드 또는 가구 인증 안내를 따라 진행해주세요.</p>
      <iframe src={safeUrl} title="넷플릭스 인증 이메일" referrerPolicy="no-referrer" sandbox="allow-scripts allow-forms allow-same-origin allow-popups" style={{ width: '100%', height: 560, border: '1px solid #DDD6FE', borderRadius: 14, background: '#fff' }} />
    </>}
  </section>;
}
