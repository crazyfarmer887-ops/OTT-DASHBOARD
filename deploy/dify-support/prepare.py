#!/usr/bin/env python3
"""Generate local-only Dify installation secrets. Idempotent and outside Git."""
import pathlib,secrets,os,json
root=pathlib.Path('/home/ubuntu/.config/gbuts/support');root.mkdir(parents=True,exist_ok=True);os.chmod(root,0o700)
env=root/'dify.env';data=root/'dify';data.mkdir(exist_ok=True)
if not env.exists():
 values={k:secrets.token_hex(24)for k in['SECRET_KEY','DB_PASSWORD','REDIS_PASSWORD']};values['INIT_PASSWORD']=secrets.token_hex(12);values['DIFY_DATA']=str(data)
 env.write_text('\n'.join(k+'='+v for k,v in values.items())+'\n');os.chmod(env,0o600)
for name in['storage','redis','postgres']:(data/name).mkdir(exist_ok=True)
os.chown(data/'storage',1001,1001)
if not(root/'config.json').exists():
 import datetime
 (root/'config.json').write_text(json.dumps({'mode':'draft','startAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'policyVersion':'gbuts-support-v1'}));os.chmod(root/'config.json',0o600)
print('Private Dify configuration prepared')
