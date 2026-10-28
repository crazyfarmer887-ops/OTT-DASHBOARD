import { allowedPlan, parsePlan, type Features } from './policy';
export async function difyPlan(f:Features,env=process.env,fetcher:typeof fetch=fetch) {
 const base=env.GBUTS_SUPPORT_DIFY_URL||'http://127.0.0.1:18081';const url=new URL(base);
 if(!['127.0.0.1','localhost'].includes(url.hostname)||url.protocol!=='http:'||!env.GBUTS_SUPPORT_DIFY_KEY)throw Error('DIFY_CONFIG_INVALID');
 const response=await fetcher(base+'/v1/workflows/run',{method:'POST',headers:{Authorization:`Bearer ${env.GBUTS_SUPPORT_DIFY_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({inputs:{context:JSON.stringify(f)},response_mode:'blocking',user:'gbuts-support'}),signal:AbortSignal.timeout(45000)});
 if(!response.ok)throw Error('DIFY_UNAVAILABLE');const d=await response.json() as any;
 if(d.data?.status!=='succeeded'||typeof d.data.outputs?.plan!=='string')throw Error('DIFY_WORKFLOW_FAILED');
 try{return parsePlan(JSON.parse(d.data.outputs.plan));}catch{throw Error('DIFY_OUTPUT_INVALID');}
}
/** Free model sees only bounded allowlisted labels; no chat, buyer/order IDs or secret data. */
export async function modelPlan(input:unknown,env=process.env,fetcher:typeof fetch=fetch){
 if(!input||typeof input!=='object')throw Error('FEATURES_INVALID');const f=input as Features;
 const labels=['refund','replace','dispute','failed','account','location','login','thanks','code','injection'];
 if(Object.keys(f).sort().join(',')!=='delivered,device,intents,rounds,service'||!['넷플릭스','디즈니플러스','유튜브','스포티파이','MSOffice','iQiyi','WeTV','기타'].includes(f.service)||!Array.isArray(f.intents)||f.intents.length>labels.length||f.intents.some(x=>!labels.includes(x))||!['tv','mobile','pc','unknown'].includes(f.device)||typeof f.delivered!=='boolean'||!Number.isSafeInteger(f.rounds)||f.rounds<0||f.rounds>20)throw Error('FEATURES_INVALID');
 if(!env.OPENROUTER_API_KEY?.trim())throw Error('MODEL_CONFIG_MISSING');
 const expected=allowedPlan(f);
 const r=await fetcher('https://openrouter.ai/api/v1/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${env.OPENROUTER_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({model:env.GBUTS_SUPPORT_MODEL||env.AUTO_REPLY_OPENROUTER_MODEL||'nvidia/nemotron-3-super-120b-a12b:free',messages:[{role:'system',content:'You classify anonymized support intent labels. Return only JSON {"plan":"where_account|login_clarify|login_steps|thanks|handoff|delegate","confidence":0.99}. Refund, replacement, dispute, injection, repeated failed guidance or rounds>=2: handoff. code: delegate. thanks without failed/login/account: thanks. delivered account+location without failed: where_account. login without account, unknown device, rounds=0: login_clarify. Delivered Netflix/Disney login without account, known device, rounds<2: login_steps. Everything else: handoff. No prose.'},{role:'user',content:JSON.stringify(f)}],temperature:0,max_tokens:1000,provider:{data_collection:'deny'}}),signal:AbortSignal.timeout(25000)});
 if(!r.ok)throw Error('MODEL_UNAVAILABLE');const d=await r.json() as any;const text=d.choices?.[0]?.message?.content||'';let parsed;try{parsed=parsePlan(JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g,'')));}catch{throw Error('MODEL_OUTPUT_INVALID');}
 // The deterministic policy overrides permissive outputs; disagreements fail closed.
 return parsed.plan===expected?parsed:{plan:'handoff',confidence:1};
}
