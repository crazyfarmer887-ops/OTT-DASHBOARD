import { randomInt } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { writeJsonAtomic } from '../lib/graytag-sales-session';
import type { SpotifyCredentials } from '../lib/gbuts-spotify';

const ACCOUNT_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const PASSWORD_ALPHABET = `${ACCOUNT_ALPHABET}ABCDEFGHJKMNPQRSTUVWXYZ!@#$`;
const defaultPath = () => process.env.GBUTS_SPOTIFY_NEW_ACCOUNTS_PATH
  || '/home/ubuntu/.hermes/hermes-agent/graytag-aio-manager-0606/data/gbuts-spotify-new-accounts.json';

export function isGeneratedSpotifyLogin(value: unknown): value is Pick<SpotifyCredentials, 'email' | 'password'> {
  if (!value || typeof value !== 'object') return false;
  const credentials = value as Partial<SpotifyCredentials>;
  return typeof credentials.email === 'string' && /^sp[a-z2-9]{10}@jamkkangudok\.com$/.test(credentials.email)
    && typeof credentials.password === 'string' && credentials.password.length === 16
    && [...credentials.password].every(character => PASSWORD_ALPHABET.includes(character))
    && [/[a-z]/, /[A-Z]/, /[2-9]/, /[!@#$]/].every(pattern => pattern.test(credentials.password!));
}

function randomText(alphabet: string, length: number): string {
  return Array.from({ length }, () => alphabet[randomInt(alphabet.length)]).join('');
}

/** One scheduler process owns this journal. Persist before any external Notion write. */
export function getOrCreateSpotifyNewAccountCredentials(orderKey: string, path = defaultPath()): SpotifyCredentials {
  if (!/^[1-9]\d*:[1-9]\d*$/.test(orderKey)) throw new Error('Spotify new-account order identity invalid');
  const store = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : { version: 1, orders: {} };
  if (store?.version !== 1 || !store.orders || typeof store.orders !== 'object' || Array.isArray(store.orders)
    || Object.entries(store.orders).some(([key, value]) => !/^[1-9]\d*:[1-9]\d*$/.test(key)
      || (!isGeneratedSpotifyLogin(value) || typeof (value as SpotifyCredentials).receivedAt !== 'string'
        || !Number.isFinite(Date.parse((value as SpotifyCredentials).receivedAt))))) throw new Error('Spotify new-account journal invalid');
  if (store.orders[orderKey]) return { ...store.orders[orderKey] };
  const reserved = new Set(Object.values(store.orders).map(value => (value as SpotifyCredentials).email));
  let email = '';
  for (let attempt = 0; attempt < 100; attempt++) {
    const candidate = `sp${randomText(ACCOUNT_ALPHABET, 10)}@jamkkangudok.com`;
    if (!reserved.has(candidate)) { email = candidate; break; }
  }
  if (!email) throw new Error('Spotify new-account unique address unavailable');
  // Rejection sampling keeps passwords uniformly random while requiring every character class.
  let password: string;
  do { password = randomText(PASSWORD_ALPHABET, 16); }
  while (![/[a-z]/, /[A-Z]/, /[2-9]/, /[!@#$]/].every(pattern => pattern.test(password)));
  const credentials = { email, password, receivedAt: new Date().toISOString() };
  store.orders[orderKey] = credentials;
  writeJsonAtomic(path, store);
  return { ...credentials };
}
