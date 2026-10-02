import { existsSync, readFileSync } from 'node:fs';
import { writeJsonAtomic } from './graytag-sales-session';

export const DEFAULT_GBUTS_SESSION_PATH = '/home/ubuntu/.hermes/hermes-agent/graytag-aio-manager-0606/data/gbuts-session.json';

export interface GbutsSession {
  token: string;
  sellerLabel: string;
  connectedAt: string;
}

export function gbutsSessionPath(): string {
  return process.env.GBUTS_SESSION_PATH?.trim() || DEFAULT_GBUTS_SESSION_PATH;
}

export function parseGbutsToken(value: unknown): string {
  if (typeof value !== 'string') throw new Error('GButs login token missing');
  const token = value.trim().replace(/^Bearer\s+/i, '');
  if (!token || token.length > 8192 || /[\s\u0000-\u001f\u007f]/.test(token))
    throw new Error('GButs login token invalid');
  return token;
}

export function loadGbutsSession(path = gbutsSessionPath()): GbutsSession | null {
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<GbutsSession>;
    if (typeof raw.sellerLabel !== 'string' || typeof raw.connectedAt !== 'string') return null;
    return { token: parseGbutsToken(raw.token), sellerLabel: raw.sellerLabel.slice(0, 80), connectedAt: raw.connectedAt };
  } catch { return null; }
}

export function saveGbutsSession(session: GbutsSession, path = gbutsSessionPath()): void {
  writeJsonAtomic(path, { token: parseGbutsToken(session.token), sellerLabel: session.sellerLabel.slice(0, 80),
    connectedAt: session.connectedAt });
}
