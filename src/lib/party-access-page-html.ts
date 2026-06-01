function jsonForScript(value: string): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}

export function buildPartyAccessHtml(token: string): string {
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <title>계정 정보 접근</title>
  <style>
    :root{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#1e1b4b;background:#f8f6ff}
    *{box-sizing:border-box} body{margin:0;min-height:100vh;background:linear-gradient(180deg,#f8f6ff,#fff);padding:28px 16px 40px}
    button,a,textarea{font-family:inherit}.wrap{width:100%;max-width:460px;margin:0 auto}.card{background:#fff;border:1px solid #ede9fe;border-radius:24px;padding:20px;box-shadow:0 16px 50px rgba(124,58,237,.14)}
    .loading{min-height:100vh;margin:-28px -16px -40px;display:grid;place-items:center;color:#7c3aed;font-weight:900}.spin{width:24px;height:24px;border:3px solid #ddd6fe;border-top-color:#7c3aed;border-radius:999px;animation:spin 1s linear infinite;margin-right:8px;display:inline-block;vertical-align:middle}@keyframes spin{to{transform:rotate(360deg)}}
    .header{display:flex;align-items:center;gap:10px;margin-bottom:12px}.icon{width:42px;height:42px;border-radius:14px;background:#f5f3ff;display:grid;place-items:center}.title{font-size:18px;font-weight:900}.sub{font-size:12px;color:#9ca3af;font-weight:800}.info{background:#f8f6ff;border-radius:16px;padding:12px;margin-bottom:12px}.service{font-size:12px;color:#6b7280;font-weight:800}.period{font-size:11px;color:#9ca3af;margin-top:4px}.profile-box{background:#eef2ff;border:1.5px solid #c7d2fe;border-radius:16px;padding:13px 14px;margin-bottom:10px;text-align:center}.profile-label{font-size:11px;color:#4f46e5;font-weight:1000}.profile-name{font-size:24px;font-weight:1000;margin-top:4px}
    .top-warning{background:#fef2f2;border:1.5px solid #fecaca;border-radius:16px;padding:12px;margin-bottom:12px;color:#991b1b;font-size:12px;line-height:1.55;font-weight:900}.profile-status{background:#f9fafb;border:1.5px solid #e5e7eb;border-radius:16px;padding:13px 14px;margin-bottom:10px}.profile-status-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px}.profile-status-title{font-size:11px;color:#4b5563;font-weight:1000}.profile-status-sub{font-size:10px;color:#9ca3af;font-weight:800;margin-top:2px}.profile-status-list{display:grid;gap:7px}.profile-status-row{display:flex;align-items:center;justify-content:space-between;gap:10px;background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:9px 10px}.profile-status-row.mine{background:#f5f3ff;border:1.5px solid #c4b5fd}.profile-status-name{font-size:15px;color:#111827;font-weight:1000;word-break:break-all}.profile-status-meta{font-size:10px;color:#6b7280;font-weight:800;margin-top:3px}.profile-status-note{margin-top:9px;font-size:11px;color:#92400e;background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:8px 9px;line-height:1.5;font-weight:800}.rows{display:grid;gap:10px}.row{background:#fff;border:1.5px solid #ede9fe;border-radius:16px;padding:12px 14px}.row-top{display:flex;align-items:center;justify-content:space-between;gap:8px}.row-label{font-size:11px;color:#7c3aed;font-weight:900}.value{font-size:16px;font-weight:900;margin-top:6px;word-break:break-all}.pill{border:0;border-radius:999px;background:#f5f3ff;color:#7c3aed;font-size:11px;font-weight:900;padding:6px 10px;text-decoration:none;cursor:pointer}.note{margin-top:14px;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:14px;padding:12px;color:#065f46;font-size:12px;line-height:1.55;font-weight:800}
    .blocked{min-height:100vh;margin:-28px -16px -40px;padding:32px 18px;display:grid;place-items:center}.blocked .card{text-align:center}.blocked h1{font-size:20px;margin:12px 0 6px}.blocked p{font-size:13px;color:#6b7280;line-height:1.6;margin:0}
    .consent{position:fixed;inset:0;z-index:100;background:linear-gradient(180deg,#f8f6ff,#fff);padding:max(10px,env(safe-area-inset-top)) 10px max(24px,env(safe-area-inset-bottom));display:flex;align-items:flex-start;justify-content:center;overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain}.consent-card{width:100%;max-width:520px;background:#fff;border:1.5px solid #ede9fe;border-radius:26px;padding:16px;margin-bottom:18px;box-shadow:0 20px 70px rgba(124,58,237,.18);display:flex;flex-direction:column;gap:12px}.warn-title{text-align:center;font-size:22px;font-weight:1000;color:#ef4444}.warn-sub{text-align:center;font-size:12px;color:#6b7280;font-weight:900}.assigned{background:#111827;color:#fff;border-radius:18px;padding:14px;text-align:center}.assigned-label{font-size:11px;color:#c4b5fd;font-weight:1000}.assigned-name{font-size:36px;font-weight:1000;line-height:1.15;margin-top:4px}.consent-section{border-radius:20px;padding:14px;border:1.5px solid}.consent-section.s1{background:#fee2e2;border-color:#fca5a5}.consent-section.s2{background:#eef2ff;border-color:#c7d2fe}.consent-section.s3{background:#ecfdf5;border-color:#a7f3d0}.section-head{display:flex;align-items:center;gap:8px;margin-bottom:8px}.section-no{width:34px;height:34px;border-radius:12px;background:#fff;display:grid;place-items:center;font-size:13px;font-weight:1000}.section-title{font-size:16px;font-weight:1000}.section-text{font-size:13px;color:#374151;line-height:1.65;font-weight:800}.copybox{margin-top:10px;background:#fff;border-radius:14px;border:1px solid rgba(17,24,39,.1);padding:10px}.copy-label{font-size:11px;color:#6b7280;font-weight:1000;margin-bottom:6px}.required{font-size:12px;color:#111827;line-height:1.55;font-weight:900;margin-bottom:8px}.agree-input{width:100%;padding:12px 13px;border-radius:12px;border:1.5px solid #cbd5e1;font-size:14px;font-weight:800;color:#1e1b4b;outline:0;resize:vertical;scroll-margin-bottom:150px;line-height:1.45}.agree-input.ok{border-color:#10b981}.primary{position:sticky;bottom:8px;width:100%;padding:16px;border:0;border-radius:16px;background:#7c3aed;color:#fff;font-size:16px;font-weight:1000;cursor:pointer;box-shadow:0 12px 24px rgba(124,58,237,.24)}.primary:disabled{background:#c4b5fd;cursor:not-allowed;box-shadow:none}.notice-image{margin-top:10px;border-radius:18px;overflow:hidden;border:1px solid #cbd5e1;background:#0f172a}.notice-grid{display:grid;grid-template-columns:1fr 1fr;gap:1px;background:#cbd5e1}.ott-panel{background:#111827;color:#fff;padding:12px;min-height:150px}.access-panel{background:#fff;padding:12px;min-height:150px}.panel-title{font-size:11px;font-weight:1000;margin-bottom:9px}.avatar-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}.avatar-card{border-radius:14px;background:#374151;padding:8px;text-align:center}.avatar-card.mine{background:#f59e0b}.avatar-face{width:32px;height:32px;margin:0 auto 5px;border-radius:999px;background:#6b7280;display:grid;place-items:center;font-size:17px}.avatar-card.mine .avatar-face{background:#fef3c7}.avatar-name{font-size:12px;font-weight:1000;word-break:break-all}.mini-row{border-radius:10px;border:1px solid #e5e7eb;background:#f9fafb;padding:7px 8px;margin-bottom:6px}.mini-row.mine{border:1.5px solid #7c3aed;background:#f5f3ff}.mini-name{font-size:12px;color:#111827;font-weight:1000;word-break:break-all}.mini-meta{font-size:9px;color:#6b7280;font-weight:800;margin-top:2px}
  </style>
</head>
<body>
  <div id="root"><div class="loading"><span><span class="spin"></span>계정 정보 확인 중...</span></div></div>
  <script>window.__PARTY_ACCESS_TOKEN__=${jsonForScript(token)};</script>
  <script>
    (function(){
      const token = window.__PARTY_ACCESS_TOKEN__ || '';
      const root = document.getElementById('root');
      const AGREEMENT_1 = '계정 정보를 절대 변경하지 않겠습니다.';
      const AGREEMENT_2 = '로그인 안 될 때 이 페이지를 먼저 확인하겠습니다.';
      const AGREEMENT_3 = '배정된 1개 프로필만 사용하겠습니다.';
      const fmtDate = (value) => {
        if (!value) return '-'; const s = String(value);
        const m = s.match(/(\\d{4})[-./]?(\\d{2})[-./]?(\\d{2})/) || s.match(/(\\d{2})\\.\\s*(\\d{1,2})\\.\\s*(\\d{1,2})/);
        if (!m) return s; if (m[1].length === 2) return '20' + m[1] + '.' + String(m[2]).padStart(2,'0') + '.' + String(m[3]).padStart(2,'0');
        return m[1] + '.' + String(m[2]).padStart(2,'0') + '.' + String(m[3]).padStart(2,'0');
      };
      const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
      const copy = async (value) => { if (!value) return; try { await navigator.clipboard.writeText(value); } catch (_) {} };
      const isWavveService = (value) => { const v = String(value || '').trim().toLowerCase().replace(/\\s+/g, ''); return v === '웨이브' || v === 'wavve'; };
      const getAdminToken = () => { try { return String(localStorage.getItem('aio.adminToken') || '').replace(/[^\x21-\x7E]+/g, '').trim(); } catch (_) { return ''; } };
      const blocked = () => { root.innerHTML = '<div class="blocked"><div class="card"><div style="font-size:34px;color:#ef4444">🔒</div><h1>계정 정보 접근이 종료됐어요</h1><p>이용기간이 끝났거나 판매자가 접근을 막은 링크입니다. 문의가 필요하면 판매자에게 메시지 주세요.</p></div></div>'; };
      const addCredentialRow = (parent, label, value, link) => { if (!value) return; const row = el('div','row'); const top = el('div','row-top'); top.appendChild(el('div','row-label',label)); if (link) { const a = el('a','pill','이메일 인증 열기'); a.href = value; a.target = '_blank'; a.rel = 'noreferrer'; top.appendChild(a); } else { const b = el('button','pill','복사'); b.type='button'; b.onclick = () => copy(value); top.appendChild(b); } row.appendChild(top); row.appendChild(el('div','value', link ? '이메일 인증/핀번호 확인 링크' : value)); parent.appendChild(row); };
      const renderProfileStatuses = (payload) => {
        const box = el('div','profile-status'); const head = el('div','profile-status-head'); const titleWrap = el('div');
        titleWrap.appendChild(el('div','profile-status-title','현재 파티원 프로필 현황')); titleWrap.appendChild(el('div','profile-status-sub','계정 접근 시점 기준으로 확인됩니다'));
        const refresh = el('button','pill','새로고침'); refresh.type = 'button'; refresh.onclick = () => window.location.reload(); head.appendChild(titleWrap); head.appendChild(refresh); box.appendChild(head);
        const items = Array.isArray(payload.partyProfiles) ? payload.partyProfiles : [];
        if (items.length) { const list = el('div','profile-status-list'); items.forEach((profile) => { const row = el('div','profile-status-row' + (profile.isCurrentMember ? ' mine' : '')); const left = el('div'); left.appendChild(el('div','profile-status-name',String(profile.profileName || '(미확인)') + (profile.isCurrentMember ? ' · 내 프로필' : ''))); left.appendChild(el('div','profile-status-meta',String(profile.memberName || '파티원') + ' · ' + fmtDate(profile.endDateTime) + '까지')); row.appendChild(left); list.appendChild(row); }); box.appendChild(list); }
        else { box.appendChild(el('div','profile-status-meta','아직 표시할 파티원 프로필 현황이 없습니다. 배정된 프로필 이름을 우선 사용해주세요.')); }
        box.appendChild(el('div','profile-status-note','프로필이 꽉 찼다면 위 현황에 없는 프로필을 삭제한 뒤, 배정된 이름으로 새로 만들어 사용해주세요.'));
        return box;
      };
      const renderConsent = (profileName, payload, onDone) => {
        let step = 0;
        const values = ['', '', ''];
        const overlay = el('div','consent');
        overlay.addEventListener('copy', (e) => e.preventDefault());
        overlay.addEventListener('cut', (e) => e.preventDefault());
        overlay.addEventListener('paste', (e) => e.preventDefault());
        overlay.addEventListener('contextmenu', (e) => e.preventDefault());
        const card = el('div','consent-card');
        const cards = [
          { cls:'s1', no:'01', title:'계정 정보 수정 금지', image:'/dashboard/access-notice-assets/complaint-case.jpg', imageLabel:'고소장 실제사례 이미지', text:'비밀번호·이메일·프로필 잠금·결제 설정은 바꾸지 마세요.', required:AGREEMENT_1 },
          { cls:'s2', no:'02', title:'최신 정보 먼저 확인', image:'/dashboard/access-notice-assets/disney-profiles.jpg', imageLabel:'프로필 수정 화면 예시', text:'로그인이 안 되면 먼저 이 페이지를 새로고침해 확인하세요.', required:AGREEMENT_2 },
          { cls:'s3', no:'03', title:'1인 1프로필 사용', text:'배정된 프로필 1개만 쓰고, 현황에 없는 프로필만 삭제하세요.', required:AGREEMENT_3 },
        ];
        const completed = () => values.filter((value, i) => value.trim() === cards[i].required).length;
        const renderStep = () => {
          card.innerHTML = '';
          card.appendChild(el('div','warn-title','⚠️ 이용 전 필수 동의'));
          card.appendChild(el('div','warn-sub','진행 상황: ' + completed() + '/3 · 복사/붙여넣기 없이 직접 입력해주세요.'));
          const dots = el('div', null); dots.style.cssText = 'display:flex;gap:6px;margin-top:10px';
          cards.forEach((cfg, index) => { const b = el('button', null, ''); b.type = 'button'; b.setAttribute('aria-label', cfg.no + '번 동의'); b.disabled = index > completed(); b.style.cssText = 'flex:1;height:8px;border:0;border-radius:999px;background:' + (index < completed() ? '#10b981' : index === step ? '#7c3aed' : '#e5e7eb') + ';cursor:' + (index <= completed() ? 'pointer' : 'not-allowed'); b.onclick = () => { if (index <= completed()) { step = index; renderStep(); } }; dots.appendChild(b); });
          card.appendChild(dots);
          const cfg = cards[step];
          const sec = el('section','consent-section ' + cfg.cls); const head = el('div','section-head'); head.appendChild(el('span','section-no',cfg.no)); head.appendChild(el('div','section-title',cfg.title)); sec.appendChild(head);
          if (cfg.image) { const ib = el('div','copybox'); const label = el('div','copy-label',cfg.imageLabel); const img = document.createElement('img'); img.src = cfg.image; img.alt = cfg.imageLabel; img.draggable = false; img.style.cssText='width:100%;max-height:260px;object-fit:contain;border-radius:12px;display:block;user-select:none;pointer-events:none'; ib.appendChild(label); ib.appendChild(img); sec.appendChild(ib); }
          const txt = el('div','section-text',cfg.text); txt.style.userSelect = 'none'; sec.appendChild(txt);

          const cb = el('div','copybox'); cb.appendChild(el('div','copy-label','아래 문장을 복붙 없이 그대로 입력')); const req = el('div','required',cfg.required); req.style.userSelect = 'none'; cb.appendChild(req); const ta = el('textarea','agree-input'); ta.rows = 4; ta.placeholder = '직접 입력해주세요. 붙여넣기는 막혀 있어요.'; ta.value = values[step]; ta.addEventListener('paste', (e) => e.preventDefault()); ta.addEventListener('copy', (e) => e.preventDefault()); ta.addEventListener('cut', (e) => e.preventDefault()); ta.addEventListener('drop', (e) => e.preventDefault()); ta.addEventListener('focus', () => setTimeout(() => ta.scrollIntoView({ block:'center', behavior:'smooth' }), 80)); cb.appendChild(ta); sec.appendChild(cb); card.appendChild(sec);
          const nav = el('div', null); nav.style.cssText = 'display:grid;grid-template-columns:' + (step > 0 ? '1fr 2fr' : '1fr') + ';gap:8px;position:sticky;bottom:8px';
          if (step > 0) { const prev = el('button','primary','이전'); prev.type='button'; prev.style.background = '#fff'; prev.style.color = '#6d28d9'; prev.style.border = '1.5px solid #ddd6fe'; prev.onclick = () => { values[step] = ta.value; step -= 1; renderStep(); }; nav.appendChild(prev); }
          const next = el('button','primary', step < 2 ? '동의 완료하고 다음 (' + completed() + '/3)' : '3개 내용 모두 동의하고 계정정보 보기 (' + completed() + '/3)'); next.disabled = ta.value.trim() !== cfg.required;
          ta.addEventListener('input', () => { values[step] = ta.value; const ok = ta.value.trim() === cfg.required; ta.classList.toggle('ok', ok); next.disabled = !ok; next.textContent = step < 2 ? '동의 완료하고 다음 (' + completed() + '/3)' : '3개 내용 모두 동의하고 계정정보 보기 (' + completed() + '/3)'; });
          next.onclick = () => { values[step] = ta.value; if (ta.value.trim() !== cfg.required) return; if (step < 2) { step += 1; renderStep(); } else { try { localStorage.setItem('access-consent-v2:' + token, profileName); } catch (_) {} overlay.remove(); if (typeof onDone === 'function') onDone(); } };
          nav.appendChild(next); card.appendChild(nav);
          setTimeout(() => ta.focus(), 50);
        };
        overlay.appendChild(card); document.body.appendChild(overlay); renderStep();
      };
      const render = (payload) => {
        if (!payload || !payload.ok) return blocked();
        const c = payload.credentials || {}; const profileName = payload.profileName || payload.memberName || '(미확인)';
        const showEmailAccess = Boolean(payload.emailAccessUrl) && !isWavveService(payload.serviceType); const showPin = Boolean(c.pin) && showEmailAccess;
        const isAdminAccess = payload.adminAccess === true;
        try { if (!isAdminAccess && localStorage.getItem('access-consent-v2:' + token) !== profileName) { root.innerHTML = ''; renderConsent(profileName, payload, () => render(payload)); return; } } catch (_) { if (!isAdminAccess) { root.innerHTML = ''; renderConsent(profileName, payload, () => render(payload)); return; } }
        root.innerHTML = ''; const wrap = el('div','wrap'); const card = el('div','card');
        const header = el('div','header'); header.appendChild(el('div','icon','🛡️')); const ht = el('div'); ht.appendChild(el('div','title',showEmailAccess ? '최신 ID · PW · PIN' : '최신 ID · PW')); ht.appendChild(el('div','sub','이용기간 중에만 계정 정보를 확인할 수 있어요')); header.appendChild(ht); card.appendChild(header);
        card.appendChild(el('div','top-warning', isAdminAccess ? '⚠️ 관리자 인증으로 동의 절차를 건너뛰었습니다. 구매자 화면에서는 기존처럼 필수 동의 후 계정 정보가 표시됩니다.' : '⚠️ 계정 정보와 추가회원/자리 설정은 절대 변경하지 마세요. 로그인 안 될 때는 이 페이지를 새로고침해 최신 정보를 먼저 확인해주세요.'));
        const info = el('div','info'); info.appendChild(el('div','service',(payload.serviceType || '') + ' · ' + (payload.memberName || ''))); info.appendChild(el('div','period',fmtDate(payload.period && payload.period.startDateTime) + ' ~ ' + fmtDate(payload.period && payload.period.endDateTime))); card.appendChild(info);
        const profile = el('div','profile-box'); profile.appendChild(el('div','profile-label','구매자님이 만들어야 하는 프로필 이름')); profile.appendChild(el('div','profile-name',profileName)); card.appendChild(profile);
        const rows = el('div','rows'); addCredentialRow(rows,'ID',c.id || '',false); addCredentialRow(rows,'PW',c.password || '',false); if (showEmailAccess) addCredentialRow(rows,'EMAIL',payload.emailAccessUrl || '',true); if (showPin) addCredentialRow(rows,'이메일 접근 PIN번호',c.pin || '',false); card.appendChild(rows);
        card.appendChild(renderProfileStatuses(payload));
        card.appendChild(el('div','note','이 페이지는 최신 로그인 정보를 실시간으로 보여줍니다. 비밀번호가 갑자기 안 되면 먼저 새로고침 후 다시 확인해주세요.'));
        wrap.appendChild(card); root.appendChild(wrap);
      };
      const adminToken = getAdminToken();
      fetch('/api/party-access/' + encodeURIComponent(token), { cache: 'no-store', headers: adminToken ? { 'x-admin-token': adminToken } : undefined }).then((res) => res.json().catch(() => ({}))).then(render).catch(blocked);
    })();
  </script>
</body>
</html>`;
}
