"""Install two paused Hermes jobs from a committed local release.

Run with the installed Hermes venv. Resume only after live collection/delivery checks.
Existing paused jobs and the main chat provider are never changed.
"""
import datetime as dt
import json
import os
from pathlib import Path
import re
import shutil
import sys
import tempfile
import yaml

HOME = Path.home() / '.hermes'
REPO = HOME / 'hermes-agent'
sys.path.insert(0, str(REPO))
from dotenv import load_dotenv
load_dotenv(HOME / '.env', override=False)
from cron.jobs import create_job, update_job
from cron.scheduler_delivery import _resolve_single_delivery_target


def resolve_origin(jobs):
    home = _resolve_single_delivery_target({}, 'telegram')
    if home and home.get('chat_id'):
        return {k: home[k] for k in ['platform', 'chat_id', 'thread_id'] if k in home}, 'home'
    candidates = {}
    for job in jobs:
        origin = job.get('origin') or {}
        if origin.get('platform') == 'telegram' and str(origin.get('chat_id', '')).isdigit():
            candidates[str(origin['chat_id'])] = origin
    if len(candidates) == 1:
        return next(iter(candidates.values())), 'existing_origin'
    allowed = re.split(r'[,\s]+', os.environ.get('TELEGRAM_ALLOWED_USERS', '').strip())
    if len(allowed) == 1 and allowed[0].isdigit():
        return {'platform': 'telegram', 'chat_id': allowed[0]}, 'sole_allowed_user'
    raise RuntimeError('A unique existing Telegram destination is required')


def main():
    os.umask(0o077)
    scripts = HOME / 'scripts'
    release = Path(__file__).resolve().parent
    release.relative_to(scripts.resolve())
    store = json.loads((HOME / 'cron/jobs.json').read_text())
    jobs = store.get('jobs', [])
    origin, source = resolve_origin(jobs)
    stamp = dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    backup = HOME / 'backups' / ('codex-kilo-migration-' + stamp)
    backup.mkdir(parents=True, mode=0o700)
    for path in [HOME / 'config.yaml', HOME / 'cron/jobs.json']:
        shutil.copy2(path, backup / path.name)
    config_path = HOME / 'config.yaml'
    config = yaml.safe_load(config_path.read_text())
    main_model = dict(config.get('model', {}))
    entry = {'name': 'kilo', 'base_url': 'https://ai-gateway.kilo.ai/api/v1',
        'api_key': 'anonymous', 'default_model': 'kilo-auto/free', 'discover_models': False,
        'context_length': 256000}
    prior = config.setdefault('providers', {}).get('kilo')
    if prior and prior != entry:
        raise RuntimeError('Existing Kilo provider differs; preserve it for review')
    config['providers']['kilo'] = entry
    assert config['model'] == main_model
    fd, tmp = tempfile.mkstemp(dir=HOME, prefix='.kilo-config-')
    with os.fdopen(fd, 'w') as out:
        yaml.safe_dump(config, out, allow_unicode=True, sort_keys=False)
        out.flush(); os.fsync(out.fileno())
    os.replace(tmp, config_path)
    registered = []
    for kind, name, schedule in [('google', '벗츠 Google 초대 상태 확인 · 서버', '2-57/5 * * * *'),
        ('rank', '벗츠 구독공유 자동화 확인 · 서버', '3 * * * *')]:
        marker = 'Managed Codex migration: ' + kind
        matches = [j for j in jobs if j.get('prompt', '').startswith(marker)]
        if len(matches) > 1:
            raise RuntimeError('Duplicate migrated jobs require review')
        values = dict(prompt=marker + '. Only deterministic status checks; never browser actions or buyer messages.',
            name=name, deliver='origin', origin=origin, model='kilo-auto/free', provider='custom:kilo',
            base_url='https://ai-gateway.kilo.ai/api/v1', script=str(release / (kind + '_watch.py')),
            no_agent=True, enabled_toolsets=[], workdir=str(release))
        if matches:
            saved = update_job(matches[0]['id'], values)
        else:
            saved = create_job(schedule=schedule, paused=True,
                paused_reason='Awaiting server verification and Codex cutover', **values)
        registered.append({'id': saved['id'], 'kind': kind, 'enabled': saved['enabled'], 'schedule': saved['schedule']})
    result = {'jobs': registered, 'deliveryResolved': True, 'deliverySource': source,
        'mainModelUnchanged': True, 'backup': str(backup), 'release': str(release)}
    (backup / 'migration.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    main()
