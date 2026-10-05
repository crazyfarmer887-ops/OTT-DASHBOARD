const {extractNotionChatWithOpenRouter}=await import(process.cwd()+'/src/api/notion-chat-extraction.ts');
const buyer=(text:string)=>({role:'buyer',text});const seller=(text:string)=>({role:'seller',text});
const cases=[
{name:'incident-order-and-암호',mode:'credentials',turns:[buyer('주문번호: 261005TEST1, 스포티파이 아이디: buyer@yahoo.com 암호: PaSs579#@!')],email:'buyer@yahoo.com',password:'PaSs579#@!'},
{name:'separate-replies',mode:'credentials',turns:[seller('계정 아이디 비밀번호 남겨주세요'),buyer('buyer@yahoo.com'),buyer('PaSs579#@!'),buyer('확인 부탁드려요')],email:'buyer@yahoo.com',password:'PaSs579#@!'},
{name:'password-correction',mode:'credentials',turns:[buyer('ID: buyer@yahoo.com 암호: PaSs579#@!'),buyer('아 비번은 NewPass923! 이걸로 바꿨어요')],email:'buyer@yahoo.com',password:'NewPass923!'},
{name:'changed-email-no-new-password',mode:'credentials',turns:[buyer('ID: old@gmail.com 암호: PaSs579#@!'),buyer('아이디 new@gmail.com으로 바꿀게요')],email:null},
{name:'second-email-reference',mode:'email',turns:[buyer('first@gmail.com 또는 second@gmail.com'),buyer('두번째로 부탁드려요')],email:'second@gmail.com'},
{name:'unresolved-email-question',mode:'email',turns:[buyer('first@gmail.com 아니면 second@gmail.com 중 뭐가 좋나요?')],email:null},
{name:'unrelated-negation',mode:'email',turns:[buyer('buyer@gmail.com으로 초대해주세요. 새 계정은 아니에요')],email:'buyer@gmail.com'},
{name:'seller-reversal-no-buyer-resend',mode:'email',turns:[buyer('old@gmail.com'),seller('다른 계정으로 보내주세요'),seller('일단 기존 걸로 해드릴게요'),buyer('네 부탁드려요')],email:null},
];
let passed=0;
for(const item of cases){
 try{
  let structuredReply = false;
  const actual=await extractNotionChatWithOpenRouter(item.turns,item.mode,async(url,init)=>{
    const response=await fetch(url,init);const body=await response.clone().json().catch(()=>null);
    const choice=body?.choices?.[0];
    const calls=choice?.message?.tool_calls;
    const content=calls?.length===1 && calls[0]?.function?.name==='submit_buyer_account' ? calls[0].function.arguments : choice?.message?.content;
    if(response.ok && ['stop','tool_calls'].includes(choice?.finish_reason) && typeof content==='string') {
      try {
        const parsed=JSON.parse(content.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,''));
        structuredReply=Number.isFinite(parsed?.confidence) && parsed.confidence>=0 && parsed.confidence<=1
          && (parsed.email===null || /^VALUE_\d+$/.test(parsed.email))
          && (parsed.password===null || /^VALUE_\d+$/.test(parsed.password));
      }catch{}
    }
    return response;
  });
  const ok=structuredReply && (actual?.email??null)===item.email&&(!item.password||actual?.password===item.password);
  if(ok)passed++;
  console.log(JSON.stringify({case:item.name,ok,resultPresent:Boolean(actual)}));
 }catch(e){console.log(JSON.stringify({case:item.name,ok:false,error:e instanceof Error&&/^OpenRouter extraction HTTP \d+$/.test(e.message)?e.message:'model unavailable'}));}
}
console.log(JSON.stringify({cases:cases.length,passed,realMessagesSent:0}));process.exit(passed===cases.length?0:1);
