import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { resolveEmailAliasFill, updateEmailAliasPin, verifyEmailAliasPinUpdate } from '../src/api/email-alias-fill';

const originalPinStorePath = process.env.EMAIL_ALIAS_PIN_STORE_PATH;

afterEach(() => {
  if (originalPinStorePath === undefined) delete process.env.EMAIL_ALIAS_PIN_STORE_PATH;
  else process.env.EMAIL_ALIAS_PIN_STORE_PATH = originalPinStorePath;
});

describe('resolveEmailAliasFill tving aliases', () => {
  test('treats Graytag 티방/Tving account labels as 티빙 and fills email/PIN memo from tving alias', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'alias-pins-'));
    const pinPath = join(dir, 'alias-pins.json');
    writeFileSync(pinPath, JSON.stringify({ 90210: { pin: '123456' } }));
    process.env.EMAIL_ALIAS_PIN_STORE_PATH = pinPath;

    const result = await resolveEmailAliasFill({
      accountEmail: 'gtwalve4',
      serviceType: '티방',
      aliases: [
        { id: 100, email: 'tving-old@example.com', enabled: true },
        { id: 90210, email: 'wavve7.example@aleeas.com', enabled: true },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.emailId).toBe(90210);
    expect(result.pin).toBe('123456');
    expect(result.memo).toContain('https://email-verify.one/email/mail/90210');
    expect(result.memo).toContain('핀번호는 : 123456입니다!');
  });

  test('binds a 티빙 gtwavve account to the same-number Wavve alias before generic service fallback', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'alias-pins-'));
    const pinPath = join(dir, 'alias-pins.json');
    writeFileSync(pinPath, JSON.stringify({
      100: { pin: '777777' },
      999: { pin: '999999' },
    }));
    process.env.EMAIL_ALIAS_PIN_STORE_PATH = pinPath;

    const result = await resolveEmailAliasFill({
      accountEmail: 'gtwavve7',
      serviceType: '티빙',
      aliases: [
        { id: 100, email: 'wavve7.example@aleeas.com', enabled: true },
        { id: 999, email: 'wavve99.example@aleeas.com', enabled: true },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.emailId).toBe(100);
    expect(result.pin).toBe('777777');
  });

  test('binds 티빙 manual double-pass IDs to their corrected Wavve aliases before generic fallback', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'alias-pins-'));
    const pinPath = join(dir, 'alias-pins.json');
    writeFileSync(pinPath, JSON.stringify({
      444: { pin: '444444' },
      555: { pin: '555555' },
      4444: { pin: '890827' },
    }));
    process.env.EMAIL_ALIAS_PIN_STORE_PATH = pinPath;

    const aliases = [
      { id: 444, email: 'wavve4.hyperlink631@aleeas.com', enabled: true },
      { id: 555, email: 'wavve5.unused706@aleeas.com', enabled: true },
      { id: 4444, email: 'wavve4444.prozac789@aleeas.com', enabled: true },
    ];

    const tving4 = await resolveEmailAliasFill({ accountEmail: 'gtwavve4', serviceType: '티빙', aliases });
    const tving444 = await resolveEmailAliasFill({ accountEmail: 'gtwavve444', serviceType: '티빙', aliases });
    const tving4444 = await resolveEmailAliasFill({ accountEmail: 'gtwavve4444', serviceType: '티빙', aliases });

    expect(tving4).toMatchObject({ ok: true, emailId: 444, pin: '444444' });
    expect(tving444).toMatchObject({ ok: true, emailId: 4444, email: 'wavve4444.prozac789@aleeas.com', pin: '890827' });
    expect(tving4444).toMatchObject({ ok: true, emailId: 444, email: 'wavve4.hyperlink631@aleeas.com', pin: '444444' });
  });

  test('verifies the selected email dashboard alias PIN really changed after update', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'alias-pins-'));
    const pinPath = join(dir, 'alias-pins.json');
    writeFileSync(pinPath, JSON.stringify({ 90210: { pin: '111111', updatedAt: 'old' } }));
    process.env.EMAIL_ALIAS_PIN_STORE_PATH = pinPath;

    await updateEmailAliasPin({
      accountEmail: 'gtwalve4',
      serviceType: '티방',
      pin: '987654',
      aliases: [{ id: 90210, email: 'wavve7.example@aleeas.com', enabled: true }],
    }, '2026-04-28T00:00:00.000Z');

    expect(verifyEmailAliasPinUpdate(90210, '987654')).toMatchObject({ ok: true, pin: '987654' });
    expect(verifyEmailAliasPinUpdate(90210, '111111')).toMatchObject({ ok: false });
  });

  test('updates the selected email dashboard alias PIN with a six digit value', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'alias-pins-'));
    const pinPath = join(dir, 'alias-pins.json');
    writeFileSync(pinPath, JSON.stringify({ 90210: { pin: '111111', updatedAt: 'old' } }));
    process.env.EMAIL_ALIAS_PIN_STORE_PATH = pinPath;

    const result = await updateEmailAliasPin({
      accountEmail: 'gtwalve4',
      serviceType: '티방',
      pin: '987654',
      aliases: [
        { id: 90210, email: 'wavve7.example@aleeas.com', enabled: true },
      ],
    }, '2026-04-28T00:00:00.000Z');

    expect(result.ok).toBe(true);
    expect(result.emailId).toBe(90210);
    expect(result.pin).toBe('987654');
    const store = JSON.parse(readFileSync(pinPath, 'utf8'));
    expect(store['90210']).toMatchObject({ pin: '987654', updatedAt: '2026-04-28T00:00:00.000Z' });
  });
});
