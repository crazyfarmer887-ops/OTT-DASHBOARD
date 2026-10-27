import { readFileSync, statSync } from 'node:fs';
import { TelegramClient, Api } from 'teleproto';
import { StringSession } from 'teleproto/sessions/index.js';
import { Logger, LogLevel } from 'teleproto/extensions/Logger.js';
import { AARYAN_BOT_ID, AARYAN_BOT_USERNAME, parseAaryanCode, type NetflixCodeKind, type NetflixCode } from './aaryan-netflix-code';
export type AaryanTelegramConfig = { apiId: number; apiHash: string; session: string; userId: string; allowedEmails: string[]; expiresAt: string };
export function readAaryanTelegramConfig(): AaryanTelegramConfig {
  const path = process.env.AARYAN_TELEGRAM_CONFIG_PATH || '/home/ubuntu/.config/gbuts/aaryan-telegram.json';
  if ((statSync(path).mode & 0o077) !== 0) throw Error('AARYAN_PRIVATE_CONFIG_REQUIRED');
  const c = JSON.parse(readFileSync(path,'utf8')) as AaryanTelegramConfig;
  if (!Number.isSafeInteger(c.apiId) || !/^[a-f0-9]{32}$/i.test(c.apiHash) || !c.session || c.userId !== '1148538638'
    || !Array.isArray(c.allowedEmails) || !c.allowedEmails.length || !Number.isFinite(Date.parse(c.expiresAt))) throw Error('AARYAN_CONFIG_INVALID');
  return c;
}
export async function requestAaryanNetflixCode(email: string, kind: NetflixCodeKind, requestedAt: string): Promise<NetflixCode> {
  const config = readAaryanTelegramConfig(); const normalized = email.trim().toLowerCase();
  if (!config.allowedEmails.includes(normalized) || Date.parse(config.expiresAt) <= Date.now()) throw Error('AARYAN_EMAIL_NOT_ALLOWED');
  const logger = new Logger(LogLevel.NONE);
  const client = new TelegramClient(new StringSession(config.session),config.apiId,config.apiHash,{ connectionRetries:1,requestRetries:1,
    autoReconnect:false,baseLogger:logger,deviceModel:'GButs account code relay',appVersion:'1.0',floodSleepThreshold:0,timeout:10 });
  const deadline = Date.now()+90_000; let callbackUsed = false;
  const timeout = setTimeout(()=>{void client.destroy().catch(()=>undefined);},90_000);timeout.unref();
  try {
    await client.connect(); if (!await client.checkAuthorization() || String((await client.getMe()).id) !== config.userId) throw Error('AARYAN_SESSION_REQUIRED');
    const bot = await client.getEntity(AARYAN_BOT_USERNAME);
    if (!(bot instanceof Api.User) || !bot.bot || String(bot.id) !== AARYAN_BOT_ID || bot.username?.toLowerCase() !== AARYAN_BOT_USERNAME.toLowerCase()) throw Error('AARYAN_BOT_IDENTITY');
    // No bot token, password, other chat, reset command or personal conversation is used.
    const query = await client.sendMessage(bot,{message:normalized}); const edited = new Set<number>();
    while (Date.now()<deadline) {
      const messages = await client.getMessages(bot,{minId:query.id,limit:10});
      const updates = edited.size ? await client.getMessages(bot,{ids:[...edited]}) : [];
      for (const m of [...messages,...updates]) {
        if (m.out || m.fwdFrom || String(m.senderId)!==AARYAN_BOT_ID) continue;
        const correlated=m.replyTo?.replyToMsgId===query.id;
        // The first menu is not a Telegram reply. It names the exact requested email;
        // reject concurrent human queries, and accept the resulting code only as a reply to ours.
        const menu= !m.replyTo && m.id>query.id && /인식된 이메일|recognized email/i.test(m.message)
          && (m.message.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)||[]).length===1
          && m.message.toLowerCase().includes(normalized) && !messages.some(other=>other.out&&other.id>query.id);
        if(!correlated&&!menu)continue;
        const result = parseAaryanCode({text:m.message,senderId:String(m.senderId),messageId:m.id,replyTo:m.replyTo?.replyToMsgId,
          queryMessageId:query.id,email:normalized,kind,requestedAt});
        if (correlated && result) return result;
        if (!callbackUsed) {
          const buttons = m.replyMarkup instanceof Api.ReplyInlineMarkup ? m.replyMarkup.rows.flatMap(r=>r.buttons) : [];
          const button = buttons.find(b => b.type instanceof Api.InlineButtonTypeCallback && (kind==='login' ? /^(?:🔢\s*)?Sign-in Code$|Try Sign.?in Code|로그인 코드/i : /^(?:⚠️?\s*)?Verification Code$|Try (?:Verification|Account) Code|계정 인증 코드/i).test(b.text));
          if (button?.type instanceof Api.InlineButtonTypeCallback) {
            callbackUsed=true;edited.add(m.id);
            // A bot can deliver the code but omit answering the callback RPC.
            // Click once, then read its correlated reply even if that acknowledgement stalls.
            let callbackTimeout: ReturnType<typeof setTimeout> | undefined;
            try { await Promise.race([client.invoke(new Api.messages.GetBotCallbackAnswer({peer:bot,msgId:m.id,data:button.type.data})).catch(()=>undefined),
              new Promise<void>(resolve=>{callbackTimeout=setTimeout(resolve,3000);callbackTimeout.unref();})]); }
            finally {if(callbackTimeout)clearTimeout(callbackTimeout);}
          }
        }
      }
      await new Promise(resolve=>setTimeout(resolve,2000));
    }
    throw Error('AARYAN_FRESH_CODE_UNAVAILABLE');
  } catch { throw Error('AARYAN_CODE_LOOKUP_UNCONFIRMED'); }
  finally { clearTimeout(timeout); await client.disconnect().catch(()=>undefined); await client.destroy().catch(()=>undefined); }
}
