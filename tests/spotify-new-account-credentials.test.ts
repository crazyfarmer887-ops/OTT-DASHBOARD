import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getOrCreateSpotifyNewAccountCredentials } from '../src/scheduler/spotify-new-account-credentials';
import { createGbutsSpotifyNotionClient } from '../src/scheduler/gbuts-spotify-sync';

const directories: string[] = [];
const temporaryPath = () => {
  const directory = mkdtempSync(join(tmpdir(), 'spotify-credentials-'));
  directories.push(directory);
  return join(directory, 'accounts.json');
};
afterEach(() => directories.splice(0).forEach(path => rmSync(path, { recursive: true, force: true })));

describe('Spotify new-account credentials', () => {
  it('uses short unique addresses and 16-character mixed passwords, saved privately once per order', () => {
    const path = temporaryPath();
    const accounts = Array.from({ length: 100 }, (_, index) => getOrCreateSpotifyNewAccountCredentials(`17124:${index + 1}`, path));
    expect(new Set(accounts.map(account => account.email)).size).toBe(100);
    expect(new Set(accounts.map(account => account.password)).size).toBe(100);
    for (const account of accounts) {
      expect(account.email).toMatch(/^sp[a-z2-9]{10}@jamkkangudok\.com$/);
      expect(account.password).toHaveLength(16);
      for (const pattern of [/[a-z]/, /[A-Z]/, /[2-9]/, /[!@#$]/]) expect(account.password).toMatch(pattern);
      expect(account.password).not.toMatch(/[01IlO\s]/);
    }
    const saved = readFileSync(path, 'utf8');
    expect(getOrCreateSpotifyNewAccountCredentials('17124:1', path)).toEqual(accounts[0]);
    expect(readFileSync(path, 'utf8')).toBe(saved);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it('fails without rotating credentials when the saved journal is damaged', () => {
    const path = temporaryPath();
    writeFileSync(path, '{"version":1,"orders":{"17124:1":{"email":"invalid"}}}');
    const original = readFileSync(path, 'utf8');
    expect(() => getOrCreateSpotifyNewAccountCredentials('17124:1', path)).toThrow('journal invalid');
    expect(readFileSync(path, 'utf8')).toBe(original);
    expect(() => getOrCreateSpotifyNewAccountCredentials('../bad', path)).toThrow('identity invalid');
  });

  it('reuses persisted credentials after an uncertain Notion creation and keeps both completion checks off', async () => {
    const path = temporaryPath();
    const bodies: any[] = [];
    const transport = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      bodies.push(body);
      if (bodies.length === 1) throw new Error('connection lost');
      return new Response(JSON.stringify({ id: 'new-page', properties: body.properties }));
    }) as unknown as typeof fetch;
    const client = createGbutsSpotifyNotionClient('test-token', undefined, transport,
      order => getOrCreateSpotifyNewAccountCredentials(order, path));
    await expect(client.createNewAccountRequestRow('17124:1')).rejects.toThrow('connection lost');
    const row = await client.createNewAccountRequestRow('17124:1');
    expect(bodies[1]).toEqual(bodies[0]);
    const saved = getOrCreateSpotifyNewAccountCredentials('17124:1', path);
    expect(row).toMatchObject({ email: saved.email, password: saved.password, registered: false, invited: false });
  });
});
