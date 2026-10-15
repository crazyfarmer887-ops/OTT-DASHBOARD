import { createDecipheriv, createHash } from 'node:crypto';
import catalog from './linkid-catalog.json';

export type LinkidProfile = { index: number; uid: number; name: string; money: number; newAlarm: boolean };
export type LinkidParty = { id: number; service: string; owner: boolean; startDate: string; endDate: string; state: number;
  members: number; capacity: number; participants: Array<{ uid: number; name: string; joinedAt: string; state: number }> };
export type LinkidNotice = { id: number; type: number; date: string; partyId: number; title: string };
export type LinkidMessage = { id: number; writer: number; date: string; text: string };
export type LinkidRoom = { id: number; partyId: number; ownerId: number; memberId: number; name: string; messages: LinkidMessage[] };
export type LinkidSnapshot = { profile: LinkidProfile; parties: LinkidParty[]; notices: LinkidNotice[]; rooms: LinkidRoom[]; updatedAt: string };
export class LinkidError extends Error {
  constructor(message: string, readonly kind: 'auth' | 'rate' | 'provider' | 'schema' = 'provider') { super(message); }
}
const positive = (x: unknown): number => { const n = Number(x); if (!Number.isSafeInteger(n) || n < 1) throw new LinkidError('링키드 응답 형식을 확인해야 합니다.', 'schema'); return n; };
const text = (x: unknown) => typeof x === 'string' ? x.slice(0, 4000) : '';
const list = (x: unknown): any[] => { if (!Array.isArray(x)) throw new LinkidError('링키드 목록 응답 형식이 바뀌었습니다.', 'schema'); return x; };
export function linkidTime(value: string): number {
  return Date.parse(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(value) ? `${value.replace(' ', 'T')}+09:00` : value);
}
export function decodeLinkidMessage(raw: string): string {
  if (!raw) return '';
  if (raw.length > 64000) return '[메시지를 링키드에서 확인해주세요]';
  try {
    const data = Buffer.from(raw, 'base64');
    if (data.subarray(0, 8).toString() !== 'Salted__') return '[메시지 형식 확인 필요]';
    const salt = data.subarray(8, 16); let key = Buffer.alloc(0); let previous = Buffer.alloc(0);
    while (key.length < 48) { previous = createHash('md5').update(Buffer.concat([previous, Buffer.from('$specialchaat$1@'), salt])).digest(); key = Buffer.concat([key, previous]); }
    const decipher = createDecipheriv('aes-256-cbc', key.subarray(0, 32), key.subarray(32, 48));
    const decoded: unknown = JSON.parse(Buffer.concat([decipher.update(data.subarray(16)), decipher.final()]).toString('utf8'));
    return typeof decoded === 'string' ? decoded : '[메시지 형식 확인 필요]';
  } catch { return '[메시지를 링키드에서 확인해주세요]'; }
}
export function linkidNotice(raw: any): LinkidNotice {
  const type = positive(raw.type);
  const titleKey = (catalog.events as Record<string, string>)[String(type)];
  const title = (catalog.eventTitles as Record<string, string>)[titleKey] || '링키드 새 알림';
  return { id: positive(raw.id), type, date: text(raw.date), partyId: Number(raw.partyid) || 0,
    title: title.replace(/<[^>]*>/g, '').replace(/\{[^}]+\}/g, '').trim() || '링키드 새 알림' };
}
export function parseLinkidCredentials(input: unknown): { token: string; provider: string; providerId: string } {
  let raw: any = input;
  if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch { throw new LinkidError('링키드 쿠키 JSON을 확인해주세요.', 'schema'); } }
  if (Array.isArray(raw)) {
    const entries = raw.filter(x => ['token', 'provider', 'providerId'].includes(x?.name));
    if (entries.some(x => !/^(\.)?linkid\.pw$/.test(String(x.domain || '')))) throw new LinkidError('링키드 사이트에서 내보낸 연결 정보만 사용할 수 있습니다.', 'schema');
    const names = new Set<string>();
    for (const item of entries) { if (names.has(item.name)) throw new LinkidError('중복 연결 정보가 있습니다.', 'schema'); names.add(item.name); }
    raw = Object.fromEntries(entries.map(x => [x.name, x.value]));
  }
  if (!raw || typeof raw !== 'object') throw new LinkidError('연결 정보를 확인해주세요.', 'schema');
  const values = ['token', 'provider', 'providerId'].map(k => {
    const value = raw[k];
    if (typeof value !== 'string' || !value || value.length > 4096 || /[\s\x00-\x1f\x7f]/.test(value)) throw new LinkidError('링키드 로그인 연결 정보가 누락되었거나 잘못되었습니다.', 'schema');
    return value;
  });
  return { token: values[0], provider: values[1], providerId: values[2] };
}
export class LinkidClient {
  private lastRequestAt = 0;
  constructor(private readonly fetcher: typeof fetch = fetch, private readonly spacingMs = 2500) {}
  private async post(path: string, data: Record<string, unknown>): Promise<any> {
    const delay = this.spacingMs - (Date.now() - this.lastRequestAt);
    if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
    this.lastRequestAt = Date.now();
    let response: Response;
    try { response = await this.fetcher(`https://linkid.pw${path}`, { method: 'POST', headers: {
      'content-type': 'application/json', 'version-service': '3.0.1', origin: 'https://linkid.pw',
    }, body: JSON.stringify(data), signal: AbortSignal.timeout(20000) }); }
    catch { throw new LinkidError('링키드에 연결하지 못했습니다. 잠시 후 다시 확인합니다.'); }
    if (response.status === 429) throw new LinkidError('링키드 요청 제한으로 잠시 기다린 뒤 다시 확인합니다.', 'rate');
    if ([401, 403].includes(response.status)) throw new LinkidError('링키드 로그인을 다시 연결해주세요.', 'auth');
    if (!response.ok) throw new LinkidError(`링키드 ${path} 조회 실패 (${response.status}).`);
    let result: any;
    try { result = await response.json(); } catch { throw new LinkidError('링키드 응답을 읽지 못했습니다.', 'schema'); }
    if (result?.result !== undefined && result.result !== 0) {
      if (result.result === 10003) throw new LinkidError('링키드 로그인을 다시 연결해주세요.', 'auth');
      throw new LinkidError(`링키드에서 요청을 처리하지 못했습니다 (${Number(result.result) || '형식 확인'}).`);
    }
    return result;
  }
  async auth(sid: string): Promise<{ uid: number; index: number; name: string }> {
    const raw = await this.post('/api/users/auth', { sid });
    return { uid: positive(raw.uid), index: positive(raw.acc_idx), name: text(raw.nickname) };
  }
  async login(provider: string, providerId: string): Promise<string> {
    const raw = await this.post('/api/login', { provider, provider_id: providerId, pushTokenKey: '' });
    if (typeof raw.sid !== 'string' || !raw.sid || raw.sid.length > 4096) throw new LinkidError('링키드 서버 세션 연결에 실패했습니다.', 'auth');
    return raw.sid;
  }
  async profiles(sid: string): Promise<LinkidProfile[]> {
    const raw = await this.post('/api/users/list_subaccount', { sid });
    const profiles = list(raw.userlist).map(x => ({ index: positive(x.acc_idx), uid: positive(x.uid), name: text(x.nickname), money: Number(x.money) || 0, newAlarm: x.new_alarm === 1 }));
    if (!profiles.length || profiles.length > 5 || new Set(profiles.map(x => x.index)).size !== profiles.length || new Set(profiles.map(x => x.uid)).size !== profiles.length)
      throw new LinkidError('링키드 프로필 목록을 확인해야 합니다.', 'schema');
    return profiles;
  }
  async select(sid: string, profile: LinkidProfile): Promise<void> {
    await this.post('/api/users/change_subaccount', { sid, acc_idx: profile.index });
    const auth = await this.auth(sid);
    if (auth.uid !== profile.uid || auth.index !== profile.index) throw new LinkidError('프로필이 일치하지 않아 조회를 중단했습니다.', 'auth');
  }
  async notices(sid: string): Promise<LinkidNotice[]> {
    const notices = new Map<number, LinkidNotice>();
    for (const read of [0, 1]) {
      let lastidx = 0; let count = 0; let complete = false;
      for (let page = 0; page < 50; page++) {
        const raw = await this.post('/api/users/alarmlist', { sid, read, lastidx });
        const entries = list(raw.list).map(linkidNotice);
        entries.forEach(x => notices.set(x.id, x)); count += entries.length;
        if (!entries.length || count >= Number(raw.totalcnt)) { complete = true; break; }
        const next = entries[entries.length - 1].id;
        if (next === lastidx) throw new LinkidError('알림 목록의 다음 페이지를 확인하지 못했습니다.', 'schema');
        lastidx = next;
      }
      if (!complete) throw new LinkidError('링키드 알림이 많아 전체 확인이 필요합니다.', 'schema');
    }
    return [...notices.values()].sort((a, b) => b.id - a.id);
  }
  async snapshot(sid: string, profile: LinkidProfile, sinceMs: number): Promise<LinkidSnapshot> {
    await this.select(sid, profile);
    const raw = await this.post('/api/party/tri_my', { sid });
    const parties: LinkidParty[] = []; const rooms: LinkidRoom[] = [];
    for (const entry of list(raw.party)) {
      const id = positive(entry.partyid);
      const info = await this.post('/api/party/tri_partyinfo', { sid, partyid: id });
      const p = info.party;
      if (!p || positive(p.partyid) !== id) throw new LinkidError('파티 정보를 확인하지 못했습니다.', 'schema');
      parties.push({ id, service: (catalog.services as Record<string, string>)[String(p.serv)] || `서비스 ${p.serv}`, owner: p.ownerid === profile.uid,
        startDate: text(p.startdate), endDate: text(p.enddate), state: Number(p.state), members: Number(p.members) || 0, capacity: Number(p.maxmemb) || 0,
        participants: list(info.member).map(x => ({ uid: positive(x.uid), name: text(x.nickname), joinedAt: text(x.jointime || x.joindate), state: Number(x.state) })) });
      const roomList = list(await this.post('/chat/room/list', { sid, partyid: id,
        ...(p.ownerid !== profile.uid ? { ownerid: p.ownerid, memberid: profile.uid } : {}) }));
      for (const room of roomList) {
        const roomId = positive(room.id); const ownerId = positive(room.ownerid); const memberId = positive(room.memberid);
        if (![ownerId, memberId].includes(profile.uid)) throw new LinkidError('다른 프로필의 채팅이 반환되어 조회를 중단했습니다.', 'schema');
        const messages: LinkidMessage[] = []; let complete = false;
        for (let page = 0; page < 50; page++) {
          const history = await this.post('/chat/room/reload', { sid, partyid: id, ownerid: ownerId, memberid: memberId, mindex: page * 20, size: 20 });
          const batch = list(history.items).map(x => ({ id: positive(x.id), writer: Number(x.writer), date: text(x.date), text: decodeLinkidMessage(typeof x.message === 'string' ? x.message : '') }));
          messages.push(...batch);
          if (!batch.length || batch.some(x => Number.isFinite(linkidTime(x.date)) && linkidTime(x.date) < sinceMs) || page + 1 >= Number(history.totalPage)) { complete = true; break; }
        }
        if (!complete) throw new LinkidError('채팅 메시지가 많아 전체 확인이 필요합니다.', 'schema');
        const target = parties[parties.length - 1].participants.find(x => x.uid === (ownerId === profile.uid ? memberId : ownerId));
        rooms.push({ id: roomId, partyId: id, ownerId, memberId, name: target?.name || '파티 채팅', messages: [...new Map(messages.map(x => [x.id, x])).values()].sort((a, b) => b.id - a.id) });
      }
    }
    const notices = await this.notices(sid);
    const auth = await this.auth(sid);
    if (auth.uid !== profile.uid) throw new LinkidError('조회 중 프로필이 바뀌어 결과를 보류했습니다.', 'auth');
    return { profile, parties, notices, rooms, updatedAt: new Date().toISOString() };
  }
}
