import { afterEach, describe, expect, it, vi } from 'vitest';
import { chmodSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { disneyEveryviewAccountKey } from '../src/lib/gbuts-disney-everyview';
import { emptyGbutsOttStore } from '../src/lib/gbuts-ott';
import { publishEveryviewDisneySeat, readEveryviewDisneyPublishJournal, writeEveryviewDisneyPublishJournal,
  type EveryviewDisneyPublishDeps, type EveryviewDisneyPublishJournal, type EveryviewDisneyPublicationProof } from '../src/scheduler/everyview-disney-publish';

const request = { accountEmail: 'disney@example.com', accountEndDate: '2027-01-24', profileNumber: 6 as const,
  title: '디즈니 프리미엄 30일', description: '참여일부터 30일 이용 가능합니다.' };
const now = new Date('2026-10-29T00:00:00Z'), key = disneyEveryviewAccountKey(request.accountEmail);
const proof: EveryviewDisneyPublicationProof = { partyId: 123, owned: true, serviceCode: 'disney_plus', accountEmail: request.accountEmail,
  shareType: 'ACCOUNT', periodTermType: 'ROLLING', usageDays: 30, totalUsageFee: 2910, oneDayUsageFee: 97, monthUsageFee: 2910,
  shareEndDate: null, buyerCapacity: 1, profileNumber: 6, emailAccessVerified: true };
function fixture() {
  let store = emptyGbutsOttStore(), journal: EveryviewDisneyPublishJournal = { version: 1, records: {} }, safe = true;
  const steps: string[] = [], submit = vi.fn(async () => { steps.push('submit');return { ok: true, partyId: 123 }; });
  const verify = vi.fn(async () => proof), recover = vi.fn(async (): Promise<number|null> => null);
  const deps: EveryviewDisneyPublishDeps = { withInventory: async work => { steps.push('lock');return work(); },
    readInventory: () => structuredClone(store), writeInventory: value => { store = structuredClone(value);steps.push('inventory'); },
    readJournal: () => structuredClone(journal), writeJournal: value => { journal = structuredClone(value);steps.push(`journal:${value.records[key]?.state}`); },
    preflight: async () => ({ accountHash: key, accountEndDate: request.accountEndDate, verifiedAt: now.toISOString(),
      accountCapacity: 6, committedOtherPlaces: 5, profile6Available: true, otherSourcesComplete: true,
      currentAdvertisementsReserved: true, syncReady: true, cutoffReady: true, profileDeliveryReady: true, credentialsValidated: true }),
    credentials: async () => ({ id: request.accountEmail, password: 'private-password',
      emailAccessUrl: `https://email-verify.one/email/mail/${request.accountEmail}`, emailAccessPin:'123456' }), submit, verify, recover,
    safeToRun: () => safe, now: () => now };
  return { deps, steps, submit, verify, recover, store: () => store, journal: () => journal, setSafe: (value: boolean) => { safe = value; } };
}

describe('Everyview Disney publication intent', () => {
  it('recovers a single uniquely correlated party after timeout without a second POST', async () => {
    const f=fixture(),shortRequest={...request,title:'디즈니 3개월'},title='디즈니 3개월 [ABCDEF123456]';
    let published=false;
    f.deps.correlation={code:()=> 'ABCDEF123456',snapshot:async()=>({complete:true,checkedAt:now.toISOString(),parties:published
      ?[{partyId:123,partyType:'free',title,serviceCode:'disney_plus',serviceName:'디즈니+'}]:[]}),savedTitle:async()=>title};
    f.deps.submit=vi.fn(async()=>{published=true;throw Error('timeout');});
    expect(await publishEveryviewDisneySeat(shortRequest,f.deps)).toMatchObject({state:'held',reason:'SUBMISSION_UNCONFIRMED'});
    expect((f.store() as any).everyviewDisneyIntents[key]).toMatchObject({state:'attempted',title,monitors:{cutoffDays:30,profileNumber:6}});
    expect(await publishEveryviewDisneySeat(shortRequest,f.deps)).toEqual({state:'confirmed',partyId:123});
    expect((f.store() as any).everyviewDisneyIntents[key]).toMatchObject({state:'confirmed',partyId:123});
    expect(f.deps.submit).toHaveBeenCalledTimes(1);
  });
  it('does not resubmit or guess if a title marker produces multiple candidates', async () => {
    const f=fixture(),shortRequest={...request,title:'디즈니 3개월'},title='디즈니 3개월 [ABCDEF123456]';let published=false;
    f.deps.correlation={code:()=> 'ABCDEF123456',snapshot:async()=>({complete:true,checkedAt:now.toISOString(),parties:published
      ?[123,124].map(partyId=>({partyId,partyType:'free' as const,title,serviceCode:'disney_plus',serviceName:'디즈니+'})):[]}),savedTitle:async()=>title};
    f.deps.submit=vi.fn(async()=>{published=true;throw Error('timeout');});
    await publishEveryviewDisneySeat(shortRequest,f.deps);
    expect(await publishEveryviewDisneySeat(shortRequest,f.deps)).toMatchObject({state:'held',reason:'SUBMISSION_UNCONFIRMED'});
    expect(f.deps.submit).toHaveBeenCalledTimes(1);
  });
  it('holds profile 6 and the intent under the inventory lock before a single POST', async () => {
    const f = fixture();
    expect(await publishEveryviewDisneySeat(request, f.deps)).toEqual({ state: 'confirmed', partyId: 123 });
    expect(f.steps).toEqual(['lock', 'inventory', 'journal:attempted', 'submit', 'journal:created', 'inventory', 'journal:confirmed']);
    const input = f.submit.mock.calls[0][0] as any;
    expect(input).toMatchObject({ paymentType: 'PERIOD', periodTermType: 'ROLLING', usageDays: 30,
      totalUsageFee: 2910, oneDayUsageFee: 97, monthUsageFee: 2910, shareEndDate: null, shareUserCnt: 1 });
    expect(input.services[0].additionalInfo).toContain('이메일 인증 주소');expect(input.services[0].additionalInfo).toContain('이메일 PIN');
    expect(f.store().disneyEveryview![key].snapshots['123']).toMatchObject({ complete: false, claims: [{ profileNumber: 6 }] });
    expect(JSON.stringify(f.journal())).not.toContain('private-password');
    expect(JSON.stringify(f.journal())).not.toContain(request.accountEmail);
  });
  it('does not resubmit after a timeout, and recovers only an independently verified matching party', async () => {
    const f = fixture();f.deps.submit = vi.fn(async () => { throw Error('timeout'); });
    expect(await publishEveryviewDisneySeat(request, f.deps)).toMatchObject({ state: 'held', reason: 'SUBMISSION_UNCONFIRMED' });
    expect(f.store().disneyEveryview![key].partyIds).toEqual([]);
    expect(await publishEveryviewDisneySeat(request, f.deps)).toMatchObject({ state: 'held', reason: 'SUBMISSION_UNCONFIRMED' });
    expect(f.deps.submit).toHaveBeenCalledTimes(1);
    f.recover.mockResolvedValue(123);f.verify.mockResolvedValueOnce({ ...proof, totalUsageFee: 2900 });
    expect(await publishEveryviewDisneySeat(request, f.deps)).toMatchObject({ state: 'held', reason: 'PUBLICATION_UNCONFIRMED' });
    expect(await publishEveryviewDisneySeat(request, f.deps)).toEqual({ state: 'confirmed', partyId: 123 });
    expect(f.deps.submit).toHaveBeenCalledTimes(1);
  });
  it('does not publish if any evidence, cutoff, account, or worker readiness is missing', async () => {
    for (const patch of [{ syncReady: false }, { cutoffReady: false }, { profileDeliveryReady: false }, { credentialsValidated: false },
      { otherSourcesComplete: false }, { currentAdvertisementsReserved: false }, { committedOtherPlaces: 4 },
      { accountCapacity: 5 }, { profile6Available: false }, { accountEndDate: '2027-01-25' }, { verifiedAt: '2026-10-28T00:00:00Z' }]) {
      const f = fixture(), base = f.deps.preflight;f.deps.preflight = async (...args) => ({ ...await base(...args), ...patch });
      expect(await publishEveryviewDisneySeat(request, f.deps)).toMatchObject({ state: 'held' });expect(f.submit).not.toHaveBeenCalled();
    }
    const f = fixture();f.deps.now = () => new Date('2026-12-25T00:00:00+09:00');
    expect(await publishEveryviewDisneySeat(request, f.deps)).toMatchObject({ state: 'held', reason: 'CUTOFF_REACHED_OR_INVALID' });expect(f.submit).not.toHaveBeenCalled();
  });
  it('holds unknown or incomplete proof without resubmitting or disclosing credentials', async () => {
    const f = fixture();f.verify.mockResolvedValue({ ...proof, owned: false });
    expect(await publishEveryviewDisneySeat(request, f.deps)).toMatchObject({ state: 'held', reason: 'PUBLICATION_UNCONFIRMED' });
    expect(f.journal().records[key]).toMatchObject({ state: 'created', partyId: 123 });
    expect(await publishEveryviewDisneySeat(request, f.deps)).toMatchObject({ state: 'held', reason: 'PUBLICATION_UNCONFIRMED' });
    expect(f.submit).toHaveBeenCalledTimes(1);
  });
  it('preserves an already observed inventory snapshot during idempotent verification', async () => {
    const f = fixture();await publishEveryviewDisneySeat(request, f.deps);
    const store = f.store();store.disneyEveryview![key].snapshots['123'].complete = true;f.deps.writeInventory(store);
    expect(await publishEveryviewDisneySeat(request, f.deps)).toEqual({ state: 'confirmed', partyId: 123 });
    expect(f.store().disneyEveryview![key].snapshots['123'].complete).toBe(true);
    expect(f.submit).toHaveBeenCalledTimes(1);
  });
  it('fails safely when the durable journal cannot be saved after the hold', async () => {
    const f = fixture();f.deps.writeJournal = () => { throw Error('disk'); };
    await expect(publishEveryviewDisneySeat(request, f.deps)).rejects.toThrow('disk');
    expect(f.submit).not.toHaveBeenCalled();expect(f.store().disneyEveryview![key].partyIds).toEqual([]);
  });
});

describe('private publication journal', () => {
  afterEach(() => vi.unstubAllEnvs());
  it('stores only in an owner-only file and rejects a public journal', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ev-publish-')), path = join(dir, 'journal.json');
    try {
      vi.stubEnv('EVERYVIEW_DISNEY_PUBLISH_JOURNAL_PATH', path);
      writeEveryviewDisneyPublishJournal({ version: 1, records: {} });
      expect(statSync(path).mode & 0o777).toBe(0o600);expect(readEveryviewDisneyPublishJournal()).toEqual({ version: 1, records: {} });
      chmodSync(path, 0o644);expect(() => readEveryviewDisneyPublishJournal()).toThrow('PRIVATE_FILE_REQUIRED');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
