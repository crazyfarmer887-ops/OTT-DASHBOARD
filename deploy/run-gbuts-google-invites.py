#!/usr/bin/env python3
"""Use live GButs paths/flags privately, then drop privileges before browser work."""
import os, pathlib, pwd, shlex, subprocess, sys
import json, uuid
pid = subprocess.check_output(['systemctl', 'show', 'aio-dashboard', '-p', 'MainPID', '--value'], text=True).strip()
if not pid.isdigit() or int(pid) < 1:
    raise SystemExit('AIO_RUNTIME_UNAVAILABLE')
runtime = dict(x.split('=', 1) for x in pathlib.Path('/proc/'+pid+'/environ').read_text().split('\0') if '=' in x)
secret = pathlib.Path('/etc/graytag-secrets/gbuts-google-invites.env')
key = None
for line in secret.read_text().splitlines():
    if line.startswith('STEEL_API_KEY='):
        key = shlex.split(line.split('=', 1)[1])[0]
if not key:
    raise SystemExit('STEEL_KEY_UNAVAILABLE')
node = os.readlink('/proc/'+pid+'/exe')
env = {'PATH': str(pathlib.Path(node).parent)+':/usr/local/bin:/usr/bin:/bin', 'HOME': '/home/ubuntu', 'STEEL_API_KEY': key,
       'GBUTS_GOOGLE_INVITE_ROOT': '/home/ubuntu/.config/gbuts/google-invites'}
for name in ['GBUTS_SESSION_PATH', 'GBUTS_YOUTUBE_RENEWALS_PATH', 'SAFE_MODE_PATH', 'GBUTS_OTT_SYNC_ENABLED']:
    if name in runtime:
        env[name] = runtime[name]
profile_file = pathlib.Path('/home/ubuntu/.config/gbuts/google-invites/profile.json')
if profile_file.exists():
    profile = json.loads(profile_file.read_text())
    if profile.get('target') != 'johnleabezf102@gmail.com':
        raise SystemExit('STEEL_PROFILE_BINDING_INVALID')
    env['GBUTS_GOOGLE_STEEL_PROFILE_ID'] = str(uuid.UUID(profile['profileId']))
user = pwd.getpwnam('ubuntu')
os.initgroups(user.pw_name, user.pw_gid); os.setgid(user.pw_gid); os.setuid(user.pw_uid)
os.chdir(pathlib.Path(__file__).resolve().parent.parent)
os.execve(node, [node, '--import', 'tsx', 'scripts/gbuts-google-invites.ts', *sys.argv[1:]], env)
