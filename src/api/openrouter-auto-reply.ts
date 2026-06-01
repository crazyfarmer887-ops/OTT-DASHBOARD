import type { HermesAutoReplyContext, HermesAutoReplyResult } from './hermes-auto-reply';
import { summarizeAutoReplyThread } from './hermes-auto-reply';

export const DEFAULT_OPENROUTER_AUTO_REPLY_MODEL = 'nvidia/nemotron-3-super-120b-a12b:free';
export const DEFAULT_OPENROUTER_AUTO_REPLY_FALLBACK_MODELS: string[] = [];

export interface AutoReplyThreadMessage {
  role: 'buyer' | 'seller';
  content: string;
  time?: string;
  imageUrls?: string[];
}

export interface OpenRouterAutoReplyContext extends HermesAutoReplyContext {
  threadMessages?: AutoReplyThreadMessage[];
  imageDataUrls?: string[];
  imageUrls?: string[];
  dashboardUrl?: string;
}

function compactText(input = '', max = 1200): string {
  return String(input).replace(/\s+/g, ' ').trim().slice(0, max);
}

function splitModelList(input = ''): string[] {
  return String(input)
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

function uniqueStrings(items: string[]): string[] {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));
}

export function resolveOpenRouterAutoReplyModel(env: Record<string, string | undefined> = process.env): string {
  return String(env.AUTO_REPLY_OPENROUTER_MODEL || env.OPENROUTER_MODEL || DEFAULT_OPENROUTER_AUTO_REPLY_MODEL).trim() || DEFAULT_OPENROUTER_AUTO_REPLY_MODEL;
}

export function resolveOpenRouterAutoReplyModels(env: Record<string, string | undefined> = process.env): string[] {
  const primary = resolveOpenRouterAutoReplyModel(env);
  const configuredFallbacks = splitModelList(env.AUTO_REPLY_OPENROUTER_FALLBACK_MODELS || env.OPENROUTER_FALLBACK_MODELS || '');
  const fallbacks = configuredFallbacks.length ? configuredFallbacks : DEFAULT_OPENROUTER_AUTO_REPLY_FALLBACK_MODELS;
  return uniqueStrings([primary, ...fallbacks]);
}

export function buildOpenRouterAutoReplyMessages(context: OpenRouterAutoReplyContext): Array<{ role: 'system' | 'user'; content: any }> {
  const thread = (context.threadMessages || []).map((message) => ({
    role: message.role,
    time: message.time || '',
    content: compactText(message.content, 1000),
    imageUrls: (message.imageUrls || []).slice(0, 4),
  }));
  const payload = {
    buyerName: context.buyerName || '구매자',
    productType: context.productType || '기타',
    productName: context.productName || context.productType || '상품',
    latestBuyerMessage: compactText(context.buyerMessage, 1200),
    conversationSummary: summarizeAutoReplyThread(thread),
    threadMessages: thread,
    dashboardUrl: context.dashboardUrl || '',
  };
  const system = [
    'You are a Graytag OTT seller auto-reply agent. Reply in Korean.',
    'Return strict JSON only. No markdown. No commentary.',
    'Schema: {"category":"login_issue|profile_issue|auth_code_request|account_action_needed|general|unknown","risk":"low|medium|high","autoSendAllowed":true,"reply":"...","reason":"...","needsHuman":false,"confidence":0.0}',
    'Analyze the latest buyer message together with the 10-minute conversation chunk, conversation summary, and any attached images/screenshots. Use screenshots to infer the failure step and intent before replying.',
    'If the buyer is only saying thanks/solved/confirmed after help, close with one short greeting such as "네~ 즐거운 사용 되세요!" and do not ask follow-up questions.',
    'Do not send a generic numbered clarification checklist such as login/auth-code/profile/video/error-code choices. If the screenshot/text already shows the likely issue, answer that issue directly. Ask one short targeted follow-up only when the issue truly cannot be inferred.',
    'Keep buyer-facing reply short, warm, practical, and natural. Usually 1-3 short Korean sentences.',
    'Never promise refunds. Never ask for passwords, cookies, admin tokens, or sensitive personal info.',
    'Do not reveal internal systems, dashboards, cookies, sessions, automation, APIs, or model names.',
    'If the request requires operator-only actions such as logging into an OTT account, deleting/creating a profile, changing account settings, refund/dispute/legal handling, or anything you cannot do from the provided context, set needsHuman=true and autoSendAllowed=false. The reply should say the seller will check and guide them shortly.',
    'If the answer is safe and directly answerable from the provided conversation/context/images, set autoSendAllowed=true unless risk exists.',
    context.systemPrompt ? `Operator extra instructions: ${context.systemPrompt.slice(0, 2000)}` : '',
  ].filter(Boolean).join('\n');

  const userContent: any[] = [
    { type: 'text', text: `Context JSON: ${JSON.stringify(payload)}` },
  ];
  const images = [...(context.imageDataUrls || []), ...(context.imageUrls || [])].slice(0, 4);
  for (const url of images) {
    if (url) userContent.push({ type: 'image_url', image_url: { url } });
  }
  return [
    { role: 'system', content: system },
    { role: 'user', content: userContent },
  ];
}

export function buildOpenRouterAutoReplyRequest(context: OpenRouterAutoReplyContext, env: Record<string, string | undefined> = process.env, modelOverride?: string) {
  return {
    model: modelOverride || resolveOpenRouterAutoReplyModel(env),
    messages: buildOpenRouterAutoReplyMessages(context),
    temperature: 0.2,
    max_tokens: 600,
  };
}

export function parseOpenRouterAutoReplyJson(output: string): HermesAutoReplyResult {
  const start = output.indexOf('{');
  const end = output.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('Invalid OpenRouter auto-reply JSON: missing object');
  let parsed: any;
  try {
    parsed = JSON.parse(output.slice(start, end + 1));
  } catch (error: any) {
    throw new Error(`Invalid OpenRouter auto-reply JSON: ${error?.message || error}`);
  }
  if (!parsed || typeof parsed.reply !== 'string' || typeof parsed.category !== 'string') {
    throw new Error('Invalid OpenRouter auto-reply JSON: missing fields');
  }
  const risk = parsed.risk === 'high' || parsed.risk === 'medium' || parsed.risk === 'low' ? parsed.risk : 'high';
  return {
    category: parsed.category,
    risk,
    autoSendAllowed: Boolean(parsed.autoSendAllowed),
    reply: parsed.reply.trim(),
    reason: typeof parsed.reason === 'string' ? parsed.reason : '',
    needsHuman: Boolean(parsed.needsHuman),
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : undefined,
  };
}
