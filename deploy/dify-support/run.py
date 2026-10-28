#!/usr/bin/env python3
"""Reuse private live GButs/provider/Telegram configuration; never print secrets."""
import pathlib,subprocess,os,pwd,json
pid=subprocess.check_output(['systemctl','show','aio-dashboard','-p','MainPID','--value'],text=True).strip()
source=dict(x.split('=',1) for x in pathlib.Path('/proc/'+pid+'/environ').read_text().split('\0') if '=' in x)
node=str(pathlib.Path('/proc/'+pid+'/exe').resolve())
env={'PATH':str(pathlib.Path(node).parent)+':/usr/bin:/bin','HOME':'/home/ubuntu'}
for k,v in source.items():
 if k.startswith('SELLER_ALERT_TELEGRAM_') or k in ['GBUTS_SESSION_PATH','GBUTS_API_TOKEN','SAFE_MODE_PATH','GBUTS_OTT_STORE_PATH']:
  env[k]=v
secrets=json.loads(pathlib.Path('/home/ubuntu/.config/gbuts/support/runtime.json').read_text())
for k,v in secrets.items():
 if k.startswith('GBUTS_SUPPORT_'):env[k]=str(v)
u=pwd.getpwnam('ubuntu');os.initgroups('ubuntu',u.pw_gid);os.setgid(u.pw_gid);os.setuid(u.pw_uid)
os.chdir(pathlib.Path(__file__).resolve().parent.parent)
os.execve(node,[node,'--import','tsx','scripts/gbuts-support.ts'],env)
