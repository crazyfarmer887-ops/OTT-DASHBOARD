import type { AutoReplyRisk } from './auto-reply-jobs';

export interface HermesAutoReplyContext {
  buyerMessage: string;
  buyerName?: string;
  productType?: string;
  productName?: string;
  systemPrompt?: string;
  threadMessages?: Array<{ role: 'buyer' | 'seller'; content: string; time?: string; imageUrls?: string[] }>;
  dashboardUrl?: string;
}

export interface HermesAutoReplyResult {
  category: string;
  risk: AutoReplyRisk;
  autoSendAllowed: boolean;
  reply: string;
  reason: string;
  needsHuman: boolean;
  confidence?: number;
}

type CompactThreadMessage = { role: 'buyer' | 'seller'; content: string; time?: string; imageUrls?: string[] };

export function summarizeAutoReplyThread(messages: CompactThreadMessage[]): string {
  const cleaned = messages
    .map((message) => `${message.role === 'seller' ? '판매자' : '구매자'}: ${String(message.content || '').replace(/\s+/g, ' ').trim()}`)
    .filter((line) => line.replace(/^구매자: |^판매자: /, '').trim())
    .slice(-8);
  if (!cleaned.length) return '최근 대화 없음';
  return cleaned.join(' / ').slice(0, 1200);
}

export function buildHermesAutoReplyPrompt(context: HermesAutoReplyContext): string {
  const threadMessages = (context.threadMessages || []).slice(-12).map((message) => ({
    role: message.role,
    time: message.time || '',
    content: String(message.content || '').replace(/\s+/g, ' ').trim().slice(0, 1000),
    imageUrls: (message.imageUrls || []).slice(0, 4),
  }));
  const conversationSummary = summarizeAutoReplyThread(threadMessages);
  const payload = {
    buyerName: context.buyerName || '구매자',
    productType: context.productType || '기타',
    productName: context.productName || context.productType || '상품',
    latestBuyerMessage: context.buyerMessage,
    conversationSummary,
    threadMessages,
    dashboardUrl: context.dashboardUrl || '',
  };
  return [
    'You are drafting a Graytag seller reply in Korean.',
    'Return JSON only. No markdown. No commentary.',
    'Keep the reply short, polite, warm, and practical.',
    'Before answering, infer the room situation from conversationSummary and threadMessages. Continue or close the conversation naturally instead of blindly sending operating-hours text.',
    'If the buyer is only saying thanks/solved/confirmed after help, answer with one short closing greeting such as "네~ 즐거운 사용 되세요!" and do not ask follow-up questions.',
    'If the conversation is ambiguous, risky, or would require repeated AI back-and-forth, set needsHuman=true and autoSendAllowed=false so the seller can be alerted on Telegram.',
    'Never promise refunds. Never ask for passwords or sensitive personal info.',
    'Do not reveal internal system details, cookies, sessions, dashboards, or authentication identifiers.',
    'If refund/dispute/legal/anger risk exists, set needsHuman=true and autoSendAllowed=false.',
    'Schema: {"category":"login_issue|profile_issue|general|unknown","risk":"low|medium|high","autoSendAllowed":false,"reply":"...","reason":"...","needsHuman":false,"confidence":0.0}',
    context.systemPrompt ? `Operator extra instructions: ${context.systemPrompt.slice(0, 2000)}` : '',
    `Context: ${JSON.stringify(payload)}`,
  ].filter(Boolean).join('\n');
}

export function parseHermesAutoReplyJson(output: string): HermesAutoReplyResult {
  try {
    const start = output.indexOf('{');
    const end = output.lastIndexOf('}');
    if (start < 0 || end < start) throw new Error('missing JSON object');
    const parsed = JSON.parse(output.slice(start, end + 1));
    if (!parsed || typeof parsed.reply !== 'string' || typeof parsed.category !== 'string') throw new Error('missing fields');
    const risk = parsed.risk === 'high' || parsed.risk === 'medium' || parsed.risk === 'low' ? parsed.risk : 'high';
    return {
      category: parsed.category,
      risk,
      autoSendAllowed: Boolean(parsed.autoSendAllowed),
      reply: parsed.reply,
      reason: typeof parsed.reason === 'string' ? parsed.reason : '',
      needsHuman: Boolean(parsed.needsHuman),
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : undefined,
    };
  } catch (error: any) {
    throw new Error(`Invalid Hermes auto-reply JSON: ${error?.message || error}`);
  }
}
