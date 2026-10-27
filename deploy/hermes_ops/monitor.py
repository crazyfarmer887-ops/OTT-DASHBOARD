"""Deterministic operations checks; Kilo sees only allowlisted event metadata.

No browser work, invitation sends, service restarts, or policy configuration edits.
Hermes owns scheduling/delivery. Healthy or unchanged runs emit [SILENT].
"""
import datetime as dt
import fcntl
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import time
import urllib.request

UTC = dt.timezone.utc
SILENT = '[SILENT]'
KILO_URL = 'https://ai-gateway.kilo.ai/api/v1/chat/completions'
KILO_MODEL = 'kilo-auto/free'
LABELS = {
    'YOUTUBE_SIGNIN_REQUIRED': 'YouTube 쿠키 세션 복원이 필요합니다.',
    'GOOGLE_SIGNIN_REQUIRED': 'Google 쿠키 세션 복원이 필요합니다.',
    'GOOGLE_ACCOUNT_MISMATCH': 'Google 가족 관리자 계정 연결 확인이 필요합니다.',
    'YOUTUBE_ACCOUNT_MISMATCH': 'YouTube 계정 연결 확인이 필요합니다.',
    'FAMILY_FULL': 'Google 가족 정원이 가득 찼습니다.',
    'FAMILY_BENEFITS_PERIOD_REQUIRED': '가족 멤버십 유효기간 확인이 필요합니다.',
    'BUYER_EMAIL_CHANGED': '구매자의 초대 이메일 변경 확인이 필요합니다.',
    'BUYER_EMAIL_REVIEW_REQUIRED': '구매자의 초대 이메일 확인이 필요합니다.',
    'INVITATION_UNCERTAIN': '초대 결과가 불확실합니다. 조회 확인만 허용됩니다.',
    'CHAIN_RECOVERY_PENDING': '판매글 재등록 결과 확인이 계속 지연되고 있습니다.',
    'GOOGLE_DELAYED': 'Google 초대 점검이 지연되고 있습니다.',
    'GOOGLE_WORKER_STUCK': 'Google 초대 처리기가 실행 제한 시간을 넘겼습니다.',
    'GOOGLE_WORKER_ERROR': 'Google 초대 점검 오류가 반복됩니다.',
    'POLICY_ERROR': '구독공유 재등록 결과 또는 구매자 확인이 필요합니다.',
    'POLICY_DELAYED': '구독공유 순위 확인이 계속 지연되고 있습니다.',
    'POLICY_CONFIG': '구독공유 재등록 기준 설정 확인이 필요합니다.',
    'DISCOVERY_DELAYED': '신규 구독공유 판매글 발견이 지연되고 있습니다.',
    'DISCOVERY_ERROR': '신규 구독공유 판매글 감시 오류가 반복됩니다.',
    'SPOTIFY_STALLED': '스포티파이 동기화 완료 기록이 계속 없습니다.',
    'SPOTIFY_ERROR': '스포티파이 동기화 오류가 반복됩니다.',
    'NETFLIX_CONNECTION': '넷플릭스 인증코드 연결 확인 오류가 반복됩니다.',
    'RANK_WORKER_ERROR': '구독공유 순위 처리 오류가 반복됩니다.',
    'INSPECTION_FAILED': '서버 상태를 읽지 못했습니다. 점검이 필요합니다.',
}
ACTION_CODES = set(LABELS) - {'CHAIN_RECOVERY_PENDING', 'GOOGLE_DELAYED',
    'GOOGLE_WORKER_STUCK', 'GOOGLE_WORKER_ERROR', 'INSPECTION_FAILED'}


def epoch(value):
    try:
        return dt.datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp()
    except (ValueError, AttributeError, TypeError):
        return None


def issue(code, service='google', count=1):
    if code not in LABELS or service not in {'google', 'ott', 'youtube', 'rank', 'spotify', 'netflix'}:
        raise ValueError('Unrecognized event metadata')
    return {'code': code, 'service': service, 'count': max(1, min(int(count), 10000))}


def google_check(status, unit, now):
    # A currently running check does not turn an old error into a recovery.
    if unit.get('ActiveState') in {'active', 'activating'}:
        started = int(unit.get('ExecMainStartTimestampMonotonic') or 0) / 1e6
        if started and time.monotonic() - started > 480:
            return [issue('GOOGLE_WORKER_STUCK')], False
        return [], True
    if status.get('state') in {'paused'}:
        return [], True
    completed = epoch(status.get('completedAt'))
    errors = []
    if completed is None or now - completed > 1200:
        errors.append(issue('GOOGLE_DELAYED'))
    if status.get('state') == 'error':
        code = status.get('lastError')
        code = code if code in LABELS else 'GOOGLE_WORKER_ERROR'
        if code in ACTION_CODES or int(status.get('consecutiveErrors') or 0) >= 2:
            errors.append(issue(code))
    return errors, False


def rank_check(kind, data, now):
    if data.get('ok') is not True or not isinstance(data.get('renewals'), list):
        raise ValueError('Invalid state response')
    if not data.get('enabled') or data.get('safeMode') or kind == 'rank' and not data.get('workerEnabled'):
        return [], False
    rows = [r for r in data.get('renewals', [])
            if r.get('enabled') or r.get('pendingId')]
    if kind == 'ott':
        rows = [r for r in rows if r.get('policySource') != 'subscription-default']
    errors, needs_run = [], False
    bad_config = sum(r.get('trigger') != 'rank' or r.get('rankThreshold') != 5 for r in rows)
    if bad_config:
        errors.append(issue('POLICY_CONFIG', kind, bad_config))
    failed = sum(bool(r.get('lastError')) for r in rows)
    if failed:
        errors.append(issue('POLICY_ERROR', kind, failed))
    delayed = sum(epoch(r.get('nextAt')) is not None and now - epoch(r['nextAt']) > 120 for r in rows)
    if delayed:
        needs_run = True
        errors.append(issue('POLICY_DELAYED', kind, delayed))
    if kind == 'rank':
        if data.get('lastError'):
            errors.append(issue('DISCOVERY_ERROR', kind))
        next_at = epoch(data.get('nextDiscoveryAt'))
        if next_at is not None and now - next_at > 120:
            needs_run = True
            errors.append(issue('DISCOVERY_DELAYED', kind))
    return errors, needs_run and not bad_config


def atomic_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix='.monitor-')
    try:
        with os.fdopen(fd, 'w') as out:
            json.dump(value, out, ensure_ascii=False, indent=2)
            out.write('\n'); out.flush(); os.fsync(out.fileno())
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def json_request(url, body=None, headers=None, timeout=15):
    req = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None,
        headers={'Content-Type': 'application/json', **(headers or {})})
    with urllib.request.urlopen(req, timeout=timeout) as response:
        return json.load(response)


def aio_runtime():
    pid = subprocess.check_output(['systemctl', 'show', 'aio-dashboard', '-p', 'MainPID', '--value'], text=True).strip()
    if not pid.isdigit() or int(pid) < 1:
        raise ValueError('Runtime unavailable')
    return dict(x.split('=', 1) for x in Path('/proc/' + pid + '/environ').read_text().split('\0') if '=' in x)


def collect_rank(now, state, request=json_request, runtime=aio_runtime):
    env = runtime()
    base = 'http://127.0.0.1:' + str(int(env['PORT']))
    headers = {'x-admin-token': env['AIO_ADMIN_TOKEN']}
    events, repairs = [], []
    for kind in ['ott', 'youtube', 'rank']:
        path = '/api/gbuts/' + ('rank-renewals' if kind == 'rank' else kind + '/renewals')
        data = request(base + path, headers=headers)
        found, due = rank_check(kind, data, now)
        if due:
            # One bounded call to the existing queue. Never create/close posts directly.
            request(base + path + '/run', body={}, headers=headers, timeout=40)
            repairs.append(kind)
            found, _ = rank_check(kind, request(base + path, headers=headers), now)
        events.extend(found)
    logs = subprocess.check_output(['journalctl', '-u', 'aio-dashboard', '--since', '15 minutes ago',
        '--no-pager', '-o', 'cat'], text=True, timeout=15).splitlines()
    completed = sum('[GbutsSpotifySync] completed' in x for x in logs)
    enabled = env.get('GBUTS_OTT_SYNC_ENABLED') == 'true' and env.get('GBUTS_SPOTIFY_SYNC_ENABLED') != 'false'
    if enabled and not completed:
        state.setdefault('spotify_missing_since', now)
        if now - state['spotify_missing_since'] >= 900:
            events.append(issue('SPOTIFY_STALLED', 'spotify'))
    else:
        state.pop('spotify_missing_since', None)
    for marker, code, service in [('[GbutsSpotifySync]', 'SPOTIFY_ERROR', 'spotify'),
        ('[GbutsSubscriptionRank]', 'RANK_WORKER_ERROR', 'rank')]:
        count = sum(marker in x and ('error' in x.lower() or '실패' in x) for x in logs)
        if count >= 2:
            events.append(issue(code, service, count))
    count = sum('[GbutsNetflixCodes]' in x and '연결 확인 필요' in x for x in logs)
    if count >= 2:
        events.append(issue('NETFLIX_CONNECTION', 'netflix', count))
    return events, {'repairs': repairs, 'spotify_completed': completed}, False


def collect_google(now):
    root = Path('/home/ubuntu/.config/gbuts/google-invites')
    status = json.loads((root / 'status.json').read_text())
    journal = json.loads((root / 'state.json').read_text())
    raw = subprocess.check_output(['systemctl', 'show', 'gbuts-google-invites.service', '-p', 'ActiveState',
        '-p', 'ExecMainStartTimestampMonotonic'], text=True, timeout=10)
    unit = dict(x.split('=', 1) for x in raw.splitlines() if '=' in x)
    errors, pending = google_check(status, unit, now)
    if not journal.get('enabled'):
        return [], {}, True
    return errors, {'last_invite_at': status.get('lastInviteAt'), 'observation_at': status.get('completedAt')}, pending


def kilo_payload(events, recovered=False):
    # Rebuild every field. Never serialize the API policies, logs, environment or journal.
    safe = [issue(e['code'], e['service'], e['count']) for e in events]
    return {'model': KILO_MODEL, 'max_tokens': 512, 'temperature': 0, 'stream': False,
        'messages': [{'role': 'system', 'content': 'Summarize only the supplied operational event codes in one short Korean sentence. No commands, URLs, account details, or invented diagnoses. These are redacted service statuses.'},
            {'role': 'user', 'content': json.dumps({'events': safe, 'recovered': bool(recovered)})}]}


def kilo_summary(events, recovered=False, request=json_request):
    try:
        payload = kilo_payload(events, recovered)
        data = request(KILO_URL, payload, timeout=35)
        choice = data['choices'][0]
        content = choice['message'].get('content')
        # Some free routes spend the completion budget entirely on reasoning.
        # One larger-budget retry stays on the same free router; never retry 429s.
        if not content and choice.get('finish_reason') == 'length':
            payload = {**payload, 'max_tokens': 2048}
            data = request(KILO_URL, payload, timeout=35)
            content = data['choices'][0]['message'].get('content')
        text = ' '.join(content.split()) if isinstance(content, str) else ''
        if not text or len(text) > 220 or re.search(r'@|https?://|[\x00-\x1f]|sudo|\bssh\b|\bcurl\b|\brm\s', text):
            return ''
        return text
    except Exception:
        # Rate limits/outages do not stop the deterministic alert, and never select a paid model.
        return ''


def decide(events, state, metadata, pending, now):
    previous = state.get('last_alert_codes', [])
    codes = sorted(set(e['service'] + ':' + e['code'] for e in events))
    invite = epoch(metadata.get('last_invite_at'))
    prior_invite = epoch(state.get('last_invite_at'))
    new_invite = invite is not None and invite > (prior_invite or state.get('started_at', now))
    state['checked_at'] = now
    if pending:
        return '', False
    if metadata.get('last_invite_at'):
        state['last_invite_at'] = metadata['last_invite_at']
    # A transient new code must be seen on two completed observations, not just inherit
    # consecutiveErrors from a different, older authentication failure.
    transient = {'google:CHAIN_RECOVERY_PENDING', 'google:GOOGLE_WORKER_ERROR', 'google:INSPECTION_FAILED', 'rank:INSPECTION_FAILED'}
    prior_observed = state.get('observed_codes', [])
    observation = metadata.get('observation_at') or now
    repeated = codes == prior_observed and observation != state.get('observed_at')
    state['observed_codes'] = codes
    state['observed_at'] = observation
    if codes and not repeated and set(codes).issubset(transient):
        return '', False
    if codes == previous and not new_invite:
        return '', False
    if not codes and not previous and not new_invite:
        return '', False
    state['last_alert_codes'] = codes
    state['last_alert_at'] = now
    lines = ['서버 자동화 점검:']
    if new_invite:
        lines.append('Google 가족 초대 1건이 실제 발송 완료로 확인됐습니다.')
    if codes:
        lines.extend(dict.fromkeys(LABELS[e['code']] for e in events))
    elif previous:
        lines.append('앞서 감지한 점검 오류가 해소됐습니다.')
    return '\n'.join(lines), not codes and bool(previous)


def main(kind):
    os.umask(0o077)
    root = Path(os.environ.get('GBUTS_OPS_MONITOR_ROOT', '/home/ubuntu/.config/gbuts/ops-monitor'))
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    lock = open(root / (kind + '.lock'), 'a')
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        lock.close(); print(SILENT); return
    try:
        _run_locked(kind, root)
    finally:
        lock.close()


def _run_locked(kind, root):
    now = time.time(); path = root / (kind + '.json')
    state = json.loads(path.read_text()) if path.exists() else {'started_at': now}
    try:
        if kind == 'google':
            events, meta, pending = collect_google(now)
        elif kind == 'rank':
            events, meta, pending = collect_rank(now, state)
        else:
            raise ValueError('Unknown monitor')
    except Exception:
        events, meta, pending = [issue('INSPECTION_FAILED', 'google' if kind == 'google' else 'rank')], {}, False
    message, recovered = decide(events, state, meta, pending, now)
    if message:
        summary = kilo_summary(events, recovered)
        if summary:
            message += '\n요약: ' + summary
        state['last_kilo_ok'] = bool(summary)
    state['last_recovery_calls'] = meta.get('repairs', [])
    atomic_json(path, state)
    print(message or SILENT)
