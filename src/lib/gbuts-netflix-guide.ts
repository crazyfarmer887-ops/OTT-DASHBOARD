import { existsSync, readFileSync } from 'node:fs';

// Public, credential-free asset uploaded through the official seller image endpoint.
export const NETFLIX_GUIDE_ASSET = {
  version: 'netflix-email-real-v1',
  sha256: '20cea3138402f9c2b5bac1b70994f94f992d90801794681884e854170cf274bd',
  url: 'https://d2127ils61dstw.cloudfront.net/upload/2026-10-28/e046120a18964b36a186301209f0a081.jpg',
} as const;
export const NETFLIX_PORTAL_GUIDE_ASSET = {
  version: 'netflix-portal-real-v1',
  sha256: 'e06176b8d0a4353ee628db8d2fea2372e32607721e8d0a5da6f533dbde1fe2ef',
  url: 'https://d2127ils61dstw.cloudfront.net/upload/2026-10-29/549b8d0859004db18fafec9b7bd8e532.jpg',
} as const;
export function isGbutsGuideImageUrl(value: unknown): value is string {
  return value === NETFLIX_GUIDE_ASSET.url || value === NETFLIX_PORTAL_GUIDE_ASSET.url;
}
export interface NetflixGuideConfig { enabled: boolean; activatedAt: string; allowedAccountEmails: string[] }
export interface NetflixGuideDelivery {
  version: string; assetHash: string; url: string; roomId: string;
  state: 'ready' | 'attempted' | 'confirmed' | 'blocked';
  createdAt: string; attemptedAt?: string; confirmedAt?: string;
}
export function validNetflixGuideDelivery(value: unknown): value is NetflixGuideDelivery {
  const d = value as NetflixGuideDelivery | undefined;
  return !!d && d.version === NETFLIX_GUIDE_ASSET.version && d.assetHash === NETFLIX_GUIDE_ASSET.sha256
    && isGbutsGuideImageUrl(d.url) && /^[A-Za-z0-9_-]{1,128}$/.test(d.roomId)
    && ['ready', 'attempted', 'confirmed', 'blocked'].includes(d.state) && Number.isFinite(Date.parse(d.createdAt))
    && (!['attempted', 'confirmed'].includes(d.state) || Number.isFinite(Date.parse(d.attemptedAt || '')))
    && (d.state !== 'confirmed' || Number.isFinite(Date.parse(d.confirmedAt || '')));
}
export function readNetflixGuideConfig(path = process.env.GBUTS_NETFLIX_GUIDE_CONFIG_PATH
  || '/home/ubuntu/.config/gbuts/netflix-email-guide.json'): NetflixGuideConfig | null {
  if (!existsSync(path)) return null;
  const c = JSON.parse(readFileSync(path, 'utf8'));
  if (typeof c.enabled !== 'boolean' || !Number.isFinite(Date.parse(c.activatedAt))
    || !Array.isArray(c.allowedAccountEmails) || !c.allowedAccountEmails.length
    || c.allowedAccountEmails.some((x: unknown) => typeof x !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x)))
    throw new Error('넷플릭스 안내 이미지 설정을 확인해주세요.');
  return c;
}
