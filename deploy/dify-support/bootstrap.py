#!/usr/bin/env python3
"""Bootstrap a private local Dify workflow. Never print credentials or response bodies."""
import json,pathlib,os,secrets,urllib.request,http.cookiejar,time
root=pathlib.Path('/home/ubuntu/.config/gbuts/support');root.mkdir(parents=True,exist_ok=True);os.chmod(root,0o700)
secret_path=root/'bootstrap-private.json'
if secret_path.exists():secret=json.loads(secret_path.read_text())
else:
 secret={'email':'support-admin@jamkkangudok.com','password':secrets.token_urlsafe(24),'bridge_key':secrets.token_urlsafe(36)}
 secret_path.write_text(json.dumps(secret));os.chmod(secret_path,0o600)
jar=http.cookiejar.CookieJar();client=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar));base='http://127.0.0.1:18081/console/api'
def request(path,data=None):
 headers={'Content-Type':'application/json'}
 for c in jar:
  if 'csrf' in c.name:headers['X-CSRF-Token']=c.value
 r=client.open(urllib.request.Request(base+path,data=None if data is None else json.dumps(data).encode(),headers=headers),timeout=120)
 return json.load(r)
try:
 status=request('/setup')
 if status.get('step')!='finished':
  env=dict(line.split('=',1)for line in(root/'dify.env').read_text().splitlines()if '='in line)
  request('/init',{'password':env['INIT_PASSWORD']})
  request('/setup',{'email':secret['email'],'name':'GButs Support','password':secret['password'],'language':'ko-KR'})
 request('/login',{'email':secret['email'],'password':secret['password'],'remember_me':True})
 workflow_path=root/'workflow-private.json'
 if workflow_path.exists():workflow=json.loads(workflow_path.read_text())
 else:
  # Three native workflow nodes: start -> authenticated private inference HTTP tool -> end.
  nodes=[]
  for i,(id,data)in enumerate([
   ('start',{'type':'start','title':'Anonymized support facts','variables':[{'variable':'context','label':'context','type':'paragraph','required':True,'max_length':4000}]}),
   ('plan',{'type':'http-request','title':'Verified support plan','method':'POST','url':'http://host.docker.internal:18082/plan','authorization':{'type':'no-auth'},'headers':'Content-Type:application/json\nAuthorization:Bearer '+secret['bridge_key'],'params':'','body':{'type':'raw-text','data':[{'type':'text','key':'','value':'{{#start.context#}}'}]},'timeout':{'connect':5,'read':30,'write':5},'retry_config':{'enabled':False,'max_retries':0,'retry_interval':1000}}),
   ('end',{'type':'end','title':'Reply plan only','outputs':[{'variable':'plan','value_selector':['plan','body'],'value_type':'string'}]})]):
   nodes.append({'id':id,'type':'custom','data':data,'position':{'x':i*300,'y':0},'width':244,'height':100,'sourcePosition':'right','targetPosition':'left'})
  edges=[{'id':a+'-'+b,'type':'custom','source':a,'sourceHandle':'source','target':b,'targetHandle':'target','data':{'sourceType':ta,'targetType':tb}}for a,b,ta,tb in[('start','plan','start','http-request'),('plan','end','http-request','end')]]
  workflow={'graph':{'nodes':nodes,'edges':edges},'features':{},'environment_variables':[],'conversation_variables':[]}
  workflow_path.write_text(json.dumps(workflow));os.chmod(workflow_path,0o600)
 if not secret.get('app_id'):
  app=request('/apps',{'name':'GButs verified customer support','mode':'workflow','description':'Anonymized intent plans; verified backend owns delivery and escalation.'});secret['app_id']=app['id'];secret_path.write_text(json.dumps(secret))
 app_id=secret['app_id']
 if not secret.get('published'):
  request('/apps/'+app_id+'/workflows/draft',workflow)
  request('/apps/'+app_id+'/workflows/publish',{'marked_name':'gbuts-support-v1','marked_comment':'Private label-only support workflow'})
  secret['published']=True;secret_path.write_text(json.dumps(secret))
 if not secret.get('app_key'):
  k=request('/apps/'+app_id+'/api-keys',{});secret['app_key']=k['token'];secret_path.write_text(json.dumps(secret))
 runtime={'GBUTS_SUPPORT_DIFY_KEY':secret['app_key'],'GBUTS_SUPPORT_DIFY_URL':'http://127.0.0.1:18081','GBUTS_SUPPORT_BRIDGE_KEY':secret['bridge_key'],'GBUTS_SUPPORT_WORKFLOW_ID':app_id,'GBUTS_SUPPORT_ROOT':str(root)}
 (root/'runtime.json').write_text(json.dumps(runtime));os.chmod(root/'runtime.json',0o600);os.chmod(secret_path,0o600)
 print(json.dumps({'configured':True,'workflowId':app_id}))
except Exception as e:
 print(json.dumps({'configured':False,'errorType':type(e).__name__,'httpStatus':getattr(e,'code',None)}));raise SystemExit(2)
