import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  syncFutureSubscriptionRank,
  activateFutureRankDefaults,
} from "../src/scheduler/gbuts-future-rank";
import {
  readSubscriptionRankDefaults,
  writeSubscriptionRankDefaults,
  subscriptionRankPostChain,
  futureSubscriptionRankApplies,
  type SubscriptionRankDefaults,
} from "../src/lib/gbuts-rank-defaults";
import {
  bindSubscriptionRenewal,
  renewYouTubeInvites,
  type InviteClient,
  type YouTubeRenewalStore,
} from "../src/scheduler/gbuts-youtube-renewal";
import {
  reserveSubscriptionRankPlaces,
  adoptSubscriptionRankPost,
  existingOttRankPostSeqs,
  assertSubscriptionRankInventory,
} from "../src/scheduler/gbuts-rank-adoption";
import { emptyGbutsOttStore, accountGbutsInventory, type GbutsOttListing } from "../src/lib/gbuts-ott";
import { disneyEveryviewAccountKey } from "../src/lib/gbuts-disney-everyview";
import {
  readGbutsOttStore,
  writeGbutsOttStore,
} from "../src/lib/gbuts-ott-store";
import {
  writeSpotifyListings,
  readSpotifyListings,
  spotifyPostSeqs,
} from "../src/lib/gbuts-spotify-listings";
let directory: string;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "future-gbuts-"));
  for (const [key, name] of Object.entries({
    GBUTS_RANK_DEFAULTS_PATH: "defaults",
    GBUTS_OTT_STORE_PATH: "ott",
    GBUTS_SPOTIFY_LISTINGS_PATH: "spotify",
    GBUTS_YOUTUBE_RENEWALS_PATH: "youtube",
  }))
    vi.stubEnv(key, join(directory, name + ".json"));
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(directory, { recursive: true, force: true });
});
function fixture(category = 20, type = "INVITE") {
  let now = new Date("2026-10-27T07:00:00Z"),
    allowed = true;
  let s: SubscriptionRankDefaults = activateFutureRankDefaults(
    { version: 1, enabled: false, policies: {} },
    true,
    99,
    now,
  );
  const source: any = {
    seq: 100,
    category1: { seq: category },
    subscriptionType: type,
    priceType: "DAY",
    price: 140,
    memberLimit: 5,
    memberCount: 2,
    status: "ON_SALE",
    subscriptionStartsAt: "2026-10-27 00:00:00",
    subscriptionEndsAt: "2026-12-31 23:59:59",
    countries: ["KR"],
    title: JSON.stringify({ ko: "정확한 제목" }),
    description: "원본 본문",
    noticeBeforeOrder: "구매 전",
    noticeAfterOrder: "구매 후",
    subscriptionPrincipal: type === "SHARE" ? "private-id@example.com" : null,
    subscriptionCredential: type === "SHARE" ? "private-password" : null,
  };
  const posts: Record<number, any> = { 100: source };
  let members: any[] = [1, 2].map((seq) => ({
    seq,
    userSeq: seq + 10,
    status: "APPLY",
    cancelStatus: null,
    createdAt: "2026-10-27 12:00:00",
    subscriptionEndsAt: source.subscriptionEndsAt,
  }));
  const client = {
    getPost: vi.fn(async (seq: number) => structuredClone(posts[seq])),
    listPostsAfter: vi.fn(async (after: number) =>
      Object.values(posts).filter((p) => p.seq > after),
    ),
    latestPostSeq: vi.fn(async () =>
      Math.max(...Object.keys(posts).map(Number)),
    ),
    sellerAccountSeq: vi.fn(async () => 7),
    listSubscriptionPublicRanking: vi.fn(async () =>
      [90, 91, 92, 93, 100].map((seq, i) => ({
        seq,
        sellerSeq: i === 0 ? 8 : 7,
      })),
    ),
    listOttPublicRanking: vi.fn(async () => []),
    listOttMembers: vi.fn(async (seq: number) =>
      seq === 100 ? structuredClone(members) : [],
    ),
    closePost: vi.fn(async (seq: number) => {
      posts[seq].status = "CLOSED";
    }),
    createSubscriptionPost: vi.fn(async (payload: any) => {
      posts[200] = {
        ...payload,
        seq: 200,
        category1: { seq: payload.category },
        memberCount: 0,
        status: "ON_SALE",
      };
      return 200;
    }),
    createYouTubeInvitePost: vi.fn(),
  };
  const reserve = vi.fn(),
    adopt = vi.fn(async () => {});
  const deps = () => ({
    read: () => s,
    write: (value: SubscriptionRankDefaults) => {
      s = value;
    },
    existingPosts: () => ({ covered: new Set<number>(), pending: false }),
    reserve,
    adopt,
    allowed: () => allowed,
    now,
  });
  return {
    client,
    source,
    posts,
    reserve,
    adopt,
    deps,
    run: () => syncFutureSubscriptionRank(client as InviteClient, deps()),
    get state() {
      return s;
    },
    advance(ms = 60_000) {
      now = new Date(now.getTime() + ms);
    },
    pause() {
      allowed = false;
    },
    setMembers(rows: any[]) {
      members = rows;
    },
  };
}
describe("default rank enrollment and transaction", () => {
  it("discovers future Spotify without an opt-in, renews only the remainder and retains original buyer IDs", async () => {
    const f = fixture();
    expect((await f.run()).discovered).toBe(1);
    expect(f.client.closePost).not.toHaveBeenCalled();
    f.advance(360_000);
    await f.run();
    expect(f.client.createSubscriptionPost).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 20,
        subscriptionType: "INVITE",
        memberLimit: 3,
        price: 140,
        title: "정확한 제목",
        description: "원본 본문",
        noticeAfterOrder: "구매 후",
        subscriptionEndsAt: f.source.subscriptionEndsAt,
      }),
    );
    f.advance();
    await f.run();
    expect(f.state.policies["100"].currentPostSeq).toBe(200);
    expect(f.state.policies["100"].members["100:1"].userSeq).toBe(11);
    expect(f.adopt).toHaveBeenCalledOnce();
  });
  it.each([5, 6, 8, 10, 22])(
    "preserves private fields in category %s without writing them to the journal",
    async (category) => {
      const f = fixture(category, "SHARE");
      await f.run();
      f.advance(360_000);
      await f.run();
      expect(f.client.createSubscriptionPost).toHaveBeenCalledWith(
        expect.objectContaining({
          category,
          subscriptionPrincipal: "private-id@example.com",
          subscriptionCredential: "private-password",
          memberLimit: 3,
        }),
      );
      expect(JSON.stringify(f.state)).not.toMatch(
        /private-id|private-password/,
      );
      expect(f.state.policies["100"].pending?.credentialsHash).toMatch(
        /^[a-f0-9]{64}$/,
      );
    },
  );
  it("subtracts a sale arriving while the original closes", async () => {
    const f = fixture();
    await f.run();
    f.advance(360_000);
    f.client.closePost.mockImplementation(async () => {
      f.source.status = "CLOSED";
      f.source.memberCount = 3;
      f.setMembers(
        [1, 2, 3].map((seq) => ({
          seq,
          userSeq: seq + 10,
          status: "APPLY",
          cancelStatus: null,
          createdAt: "2026-10-27 12:00:00",
          subscriptionEndsAt: f.source.subscriptionEndsAt,
        })),
      );
    });
    await f.run();
    expect(f.client.createSubscriptionPost.mock.calls[0][0].memberLimit).toBe(
      2,
    );
  });
  it("does not reopen a manually closed seed or churn for own posts", async () => {
    const f = fixture();
    await f.run();
    f.advance(360_000);
    f.source.status = "CLOSED";
    await f.run();
    expect(f.client.createSubscriptionPost).not.toHaveBeenCalled();
    expect(f.state.policies["100"].enabled).toBe(false);
    const g = fixture();
    await g.run();
    g.advance(360_000);
    g.client.listSubscriptionPublicRanking.mockResolvedValue(
      [90, 91, 92, 93, 100].map((seq) => ({ seq, sellerSeq: 7 })),
    );
    await g.run();
    expect(g.client.closePost).not.toHaveBeenCalled();
  });
  it("does not enroll old-engine replacements or discover while an uncertain old CREATE exists", async () => {
    const f = fixture();
    await syncFutureSubscriptionRank(f.client as InviteClient, {
      ...f.deps(),
      existingPosts: () => ({ covered: new Set([100]), pending: false }),
    });
    expect(Object.keys(f.state.policies)).toHaveLength(0);
    expect(f.state.watermark).toBe(100);
    const g = fixture();
    await syncFutureSubscriptionRank(g.client as InviteClient, {
      ...g.deps(),
      existingPosts: () => ({ covered: new Set(), pending: true }),
    });
    expect(g.client.listPostsAfter).not.toHaveBeenCalled();
    expect(g.state.watermark).toBe(99);
  });
  it("reconciles unknown creation and a failed adoption without repeating CREATE or making a replacement its own seed", async () => {
    const f = fixture();
    await f.run();
    f.advance(360_000);
    const create = f.client.createSubscriptionPost.getMockImplementation()!;
    f.client.createSubscriptionPost.mockImplementation(async (p) => {
      await create(p);
      throw Error("unknown");
    });
    await f.run();
    f.adopt.mockRejectedValueOnce(Error("local write failed"));
    f.advance();
    await f.run();
    expect(f.state.policies["100"].pending?.phase).toBe("publishing");
    f.advance();
    await f.run();
    expect(f.state.policies["100"].currentPostSeq).toBe(200);
    expect(f.client.createSubscriptionPost).toHaveBeenCalledOnce();
    expect(Object.keys(f.state.policies)).toEqual(["100"]);
  });
  it("blocks CREATE when safety changes during closing and honors a separately disabled seed", async () => {
    const f = fixture();
    await f.run();
    f.advance(360_000);
    f.client.closePost.mockImplementation(async () => {
      f.source.status = "CLOSED";
      f.pause();
    });
    await f.run();
    expect(f.client.createSubscriptionPost).not.toHaveBeenCalled();
    expect(f.state.policies["100"].pending?.phase).toBe("closing");
    const g = fixture();
    await g.run();
    g.state.policies["100"].enabled = false;
    g.advance(360_000);
    await g.run();
    expect(g.client.closePost).not.toHaveBeenCalled();
    expect(g.state.policies["100"].enabled).toBe(false);
  });
  it("keeps the original activation cutoff across pause/resume, including Netflix routing", () => {
    const s = activateFutureRankDefaults(
      { version: 1, enabled: false, policies: {} },
      true,
      500,
    );
    activateFutureRankDefaults(s, false, 999);
    writeSubscriptionRankDefaults(s);
    expect(futureSubscriptionRankApplies(501)).toBe(true);
    expect(futureSubscriptionRankApplies(500)).toBe(false);
    activateFutureRankDefaults(s, true, 999);
    expect(s.activatedAfterSeq).toBe(500);
    expect(s.watermark).toBe(500);
  });
});
describe("existing delivery/inventory adoption", () => {
  it("keeps a pending managed replacement reserved, then preserves the account/provider and original buyer records", async () => {
    const f = fixture(5, "SHARE");
    const store = emptyGbutsOttStore();
    store.listings.sale = {
      id: "sale",
      requestHash: "fixture",
      serviceType: "넷플릭스",
      accountEmail: "private-id@example.com",
      emailCodeProvider: "aaryan",
      capacity: 5,
      dailyPrice: 140,
      endDate: "2026-12-31",
      title: "정확한 제목",
      description: "원본 본문",
      state: "registered",
      postSeq: 100,
      createdAt: "2026-10-27T07:00:00Z",
    };
    store.orders["100:1"] = {
      key: "100:1",
      listingId: "sale",
      postSeq: 100,
      memberSeq: 1,
      userSeq: 11,
      name: "buyer",
      status: "APPLY",
      cancelStatus: null,
      startDate: "2026-10-27",
      endDate: "2026-12-31",
      delivery: "confirmed",
      verifiedAt: "2026-10-27T07:00:00Z",
      profileName: "1",
      profileNumber: 1,
      roomId: "original-room",
    };
    writeGbutsOttStore(store);
    const s: YouTubeRenewalStore = { version: 1, policies: {} };
    const p = bindSubscriptionRenewal(
      s,
      f.source,
      true,
      new Date("2026-10-27T07:00:00Z"),
    );
    p.members["100:1"] = {
      postSeq: 100,
      seq: 1,
      userSeq: 11,
      status: "APPLY",
      cancelStatus: null,
      endDate: p.endDate,
    };
    p.pending = { phase: "closing", sourcePostSeq: 100, afterSeq: 100 };
    reserveSubscriptionRankPlaces(s.policies, new Date("2026-10-27T07:00:00Z"));
    const reserved = readGbutsOttStore().listings["rank-auto-100-from-100"];
    expect(reserved).toMatchObject({
      state: "submitting",
      capacity: 4,
      emailCodeProvider: "aaryan",
    });
    await adoptSubscriptionRankPost(p, {
      ...f.source,
      seq: 200,
      memberLimit: 4,
      status: "ON_SALE",
    });
    await adoptSubscriptionRankPost(p, {
      ...f.source,
      seq: 200,
      memberLimit: 4,
      status: "ON_SALE",
    });
    const saved = readGbutsOttStore();
    expect(saved.listings.sale.state).toBe("closed");
    expect(saved.listings[reserved.id]).toMatchObject({
      postSeq: 200,
      capacity: 4,
      state: "registered",
      emailCodeProvider: "aaryan",
    });
    expect(saved.orders["100:1"]).toEqual(store.orders["100:1"]);
  });
  it("retains Spotify original posts and adds replacements to the existing Notion sync set", async () => {
    const f = fixture();
    writeSpotifyListings({
      version: 1,
      listings: {
        spotify: {
          id: "spotify",
          requestHash: "fixture",
          title: "원본",
          description: "본문",
          noticeBeforeOrder: null,
          noticeAfterOrder: null,
          startDate: "2026-10-27",
          endDate: "2026-12-31",
          dailyPrice: 140,
          capacity: 5,
          countries: ["KR"],
          state: "registered",
          postSeq: 100,
          beforePostSeqs: [],
          createdAt: "2026-10-27T07:00:00Z",
        },
      },
    });
    const s: YouTubeRenewalStore = { version: 1, policies: {} };
    const p = bindSubscriptionRenewal(s, f.source, true);
    p.pending = { phase: "publishing", sourcePostSeq: 100, afterSeq: 100 };
    await adoptSubscriptionRankPost(p, {
      ...f.source,
      seq: 200,
      memberLimit: 3,
      status: "ON_SALE",
    });
    expect(spotifyPostSeqs()).toEqual(expect.arrayContaining([100, 200]));
    expect(readSpotifyListings().listings.spotify.postSeq).toBe(100);
    p.currentPostSeq = 200;
    p.posts.push({ seq: 200, capacity: 3 });
    delete p.pending;
    writeSubscriptionRankDefaults({
      ...activateFutureRankDefaults(
        { version: 1, enabled: false, policies: s.policies },
        true,
        99,
      ),
      policies: s.policies,
    });
    expect(subscriptionRankPostChain(100)).toEqual([100, 200]);
  });
  it("excludes exactly an existing policy chain rather than all future posts sharing the account", () => {
    const store = emptyGbutsOttStore();
    const base = {
      serviceType: "넷플릭스",
      accountEmail: "same@example.com",
      capacity: 5,
      dailyPrice: 190,
      endDate: "2026-12-31",
      title: "title",
      description: "body",
      state: "registered",
      createdAt: "2026-10-27T00:00:00Z",
      requestHash: "hash",
    } as const;
    store.listings = {
      old: { ...base, id: "old", postSeq: 100 },
      newer: { ...base, id: "newer", postSeq: 200, repostFrom: "old" },
      unrelated: { ...base, id: "unrelated", postSeq: 300 },
    };
    store.renewals = {
      same: {
        accountEmail: base.accountEmail,
        capacity: 5,
        listingId: "newer",
        enabled: false,
        nextAt: "2026-10-27T00:00:00Z",
      },
    };
    expect([...existingOttRankPostSeqs(store)].sort()).toEqual([100, 200]);
  });
});

it("checks outside-market capacity again after closure and keeps an uncreated managed replacement reserved", async () => {
  const f = fixture(5, "SHARE");
  const inventory = emptyGbutsOttStore();
  inventory.listings.sale = {
    id: "sale",
    requestHash: "hash",
    serviceType: "넷플릭스",
    accountEmail: "private-id@example.com",
    capacity: 5,
    dailyPrice: 140,
    endDate: "2026-12-31",
    title: "title",
    description: "body",
    state: "registered",
    postSeq: 100,
    createdAt: "2026-10-27T07:00:00Z",
  };
  writeGbutsOttStore(inventory);
  const management = {
    services: [
      {
        serviceType: "넷플릭스",
        accounts: [
          {
            email: "private-id@example.com",
            serviceType: "넷플릭스",
            totalSlots: 5,
            members: [] as any[],
            expiryDate: "2026-12-31",
            generatedAccount: { paymentStatus: "paid" },
          },
        ],
      },
    ],
    onSaleByKeepAcct: {},
  };
  const deps = () => ({
    ...f.deps(),
    reserve: reserveSubscriptionRankPlaces,
    adopt: adoptSubscriptionRankPost,
    verify: async (p: any) =>
      assertSubscriptionRankInventory(p, management, []),
  });
  await syncFutureSubscriptionRank(f.client as InviteClient, deps());
  f.advance(360_000);
  f.client.closePost.mockImplementation(async () => {
    f.source.status = "CLOSED";
    management.services[0].accounts[0].members.push({
      dealUsid: "outside",
      status: "Using",
      endDateTime: "2026-12-31",
    });
  });
  await syncFutureSubscriptionRank(f.client as InviteClient, deps());
  expect(f.client.createSubscriptionPost).not.toHaveBeenCalled();
  expect(f.state.policies["100"].pending?.phase).toBe("closing");
  expect(readGbutsOttStore().listings["rank-auto-100-from-100"]).toMatchObject({
    state: "submitting",
    capacity: 3,
  });
});
it("holds generic Disney rank repost before closing when a cross-platform reservation exists", async () => {
  const f=fixture(6,"SHARE"), inventory=emptyGbutsOttStore();
  inventory.listings.sale={ id:"sale",requestHash:"h",serviceType:"디즈니플러스",accountEmail:"private-id@example.com",
    capacity:5,dailyPrice:140,endDate:"2026-12-31",title:"title",description:"body",deliveryMode:"disney-numbered-password",
    state:"registered",postSeq:100,createdAt:"2026-10-27T07:00:00Z" };
  inventory.disneyEveryview={[disneyEveryviewAccountKey("private-id@example.com")]:{partyIds:[],snapshots:{}}};
  writeGbutsOttStore(inventory);
  const management={services:[{serviceType:"디즈니플러스",accounts:[{email:"private-id@example.com",serviceType:"디즈니플러스",
    totalSlots:6,members:[],expiryDate:"2026-12-31",generatedAccount:{paymentStatus:"paid"}}]}],onSaleByKeepAcct:{}};
  const deps=()=>({...f.deps(),reserve:reserveSubscriptionRankPlaces,adopt:adoptSubscriptionRankPost,
    verify:async(p:any)=>assertSubscriptionRankInventory(p,management,[])});
  await syncFutureSubscriptionRank(f.client as InviteClient,deps());f.advance(360_000);
  await syncFutureSubscriptionRank(f.client as InviteClient,deps());
  expect(f.client.closePost).not.toHaveBeenCalled();
  expect(f.client.createSubscriptionPost).not.toHaveBeenCalled();
});
async function dedicatedDisneyRankFixture(options:{kind?:'advertised'|'buyer'|'reserved'; stale?:boolean; quota?:number; outside?:boolean}={}) {
  const f=fixture(6,'SHARE'), inventory=emptyGbutsOttStore();
  inventory.listings.sale={id:'sale',requestHash:'h',serviceType:'디즈니플러스',accountEmail:'private-id@example.com',
    capacity:5,dailyPrice:140,endDate:'2026-12-31',title:'title',description:'body',deliveryMode:'disney-numbered-password',
    state:'registered',postSeq:100,createdAt:'2026-10-27T07:00:00Z'};
  for(let n=1;n<=2;n++) inventory.orders[`100:${n}`]={key:`100:${n}`,listingId:'sale',postSeq:100,memberSeq:n,userSeq:n+10,
    name:`buyer${n}`,status:'APPLY',cancelStatus:null,startDate:'2026-10-27',endDate:'2026-12-31',delivery:'confirmed',
    profileNumber:n,profileName:String(n),verifiedAt:new Date().toISOString()};
  const kind=options.kind||'advertised';
  inventory.disneyEveryview={[disneyEveryviewAccountKey('private-id@example.com')]:{accountCapacity:6,partyIds:[700],
    snapshots:{'700':{source:'everyview:700',complete:true,verifiedAt:new Date(Date.now()-(options.stale?121_000:0)).toISOString(),
      advertisedVacancies:kind==='advertised'?1:0,claims:[{id:'dedicated_700_6',profileNumber:6,kind,
        state:kind==='buyer'?'active':'pending',...(kind==='buyer'?{buyerIdentity:'a'.repeat(64)}:{})}]}}}};
  writeGbutsOttStore(inventory);
  const management={services:[{serviceType:'디즈니플러스',accounts:[{email:'private-id@example.com',serviceType:'디즈니플러스',
    totalSlots:6,members:options.outside?[{dealUsid:'outside',status:'Using',endDateTime:'2026-12-31'}]:[],
    expiryDate:'2026-12-31',generatedAccount:{paymentStatus:'paid'}}]}],onSaleByKeepAcct:{}};
  const deps=()=>({...f.deps(),reserve:reserveSubscriptionRankPlaces,adopt:adoptSubscriptionRankPost,
    verify:async(p:any)=>assertSubscriptionRankInventory(p,management,[])});
  await syncFutureSubscriptionRank(f.client as InviteClient,deps());
  if(options.quota) f.state.policies['100'].capacity=options.quota;
  f.advance(360_000);
  return {f,deps,inventory};
}
it.each(['advertised','buyer','reserved'] as const)('allows generic Disney rank repost with a verified dedicated six (%s)',async kind=>{
  const {f,deps}=await dedicatedDisneyRankFixture({kind});
  await syncFutureSubscriptionRank(f.client as InviteClient,deps());
  expect(f.client.closePost).toHaveBeenCalledTimes(1);
  expect(f.client.createSubscriptionPost).toHaveBeenCalledTimes(1);
  expect(f.client.createSubscriptionPost.mock.calls[0][0].memberLimit).toBe(3);
  expect(readGbutsOttStore().orders['100:1'].profileNumber).toBe(1);
  expect(readGbutsOttStore().orders['100:2'].profileNumber).toBe(2);
});
it.each([{stale:true},{quota:6},{outside:true}])('blocks generic Disney repost if freshness, quota or outside reservations are unsafe: %o',async options=>{
  const {f,deps}=await dedicatedDisneyRankFixture(options);
  await syncFutureSubscriptionRank(f.client as InviteClient,deps());
  expect(f.client.closePost).not.toHaveBeenCalled();expect(f.client.createSubscriptionPost).not.toHaveBeenCalled();
});
it.each(['wrong-profile','unknown','incomplete','missing-snapshot','buyer-mismatch'] as const)('blocks generic Disney repost on %s evidence',async variant=>{
 const {f,deps}=await dedicatedDisneyRankFixture();const store=readGbutsOttStore();
 const entry=store.disneyEveryview![disneyEveryviewAccountKey('private-id@example.com')], snapshot=entry.snapshots['700'];
 if(variant==='wrong-profile') snapshot.claims=[{id:'dedicated',profileNumber:5,kind:'advertised',state:'pending'}];
 if(variant==='unknown') snapshot.claims=[{id:'dedicated',profileNumber:6,kind:'advertised',state:'unknown'}];
 if(variant==='incomplete') snapshot.complete=false;
 if(variant==='missing-snapshot') delete entry.snapshots['700'];
 if(variant==='buyer-mismatch') store.orders['100:1'].userSeq=999;
 writeGbutsOttStore(store);
 if(variant==='buyer-mismatch') await expect(syncFutureSubscriptionRank(f.client as InviteClient,deps())).rejects.toThrow('구매자 연결');
 else await syncFutureSubscriptionRank(f.client as InviteClient,deps());
 expect(f.client.closePost).not.toHaveBeenCalled();expect(f.client.createSubscriptionPost).not.toHaveBeenCalled();
});
it('blocks unbound direct Disney repost while a mapped account exists and its identity is unknown',async()=>{
 const f=fixture(6,'SHARE'), inventory=emptyGbutsOttStore();
 inventory.disneyEveryview={[disneyEveryviewAccountKey('private-id@example.com')]:{partyIds:[],snapshots:{}}};
 writeGbutsOttStore(inventory);
 const deps=()=>({...f.deps(),reserve:reserveSubscriptionRankPlaces,adopt:adoptSubscriptionRankPost,
   verify:async(p:any)=>assertSubscriptionRankInventory(p,{services:[],onSaleByKeepAcct:{}},[])});
 await syncFutureSubscriptionRank(f.client as InviteClient,deps());f.advance(360_000);
 await syncFutureSubscriptionRank(f.client as InviteClient,deps());
 expect(f.client.closePost).not.toHaveBeenCalled();expect(f.client.createSubscriptionPost).not.toHaveBeenCalled();
});
it("preflights public payloads before closing a sellable original", async () => {
  const f = fixture();
  await f.run();
  f.advance(360_000);
  f.source.countries = [];
  await f.run();
  expect(f.client.closePost).not.toHaveBeenCalled();
  expect(f.client.createSubscriptionPost).not.toHaveBeenCalled();
});
it("keeps a failed category isolated from another displaced category", async () => {
  const f = fixture();
  const s: YouTubeRenewalStore = { version: 1, policies: {} };
  bindSubscriptionRenewal(s, f.source, true, new Date("2026-10-27T06:00:00Z"));
  f.posts[101] = {
    ...f.source,
    seq: 101,
    memberCount: 0,
    category1: { seq: 10 },
    subscriptionType: "SHARE",
  };
  bindSubscriptionRenewal(
    s,
    f.posts[101],
    true,
    new Date("2026-10-27T06:00:00Z"),
  );
  f.client.listSubscriptionPublicRanking.mockImplementation(
    async (category) => {
      if (category === 20) throw Error("provider down");
      return [80, 81, 82, 83, 101].map((seq, i) => ({
        seq,
        sellerSeq: i === 0 ? 8 : 7,
      }));
    },
  );
  const result = await renewYouTubeInvites(f.client as InviteClient, {
    read: () => s,
    write: () => {},
    now: new Date("2026-10-27T07:00:00Z"),
  });
  expect(result.errors).toBe(1);
  expect(f.client.closePost).toHaveBeenCalledWith(101);
  expect(s.policies["100"].lastError).toBeTruthy();
});

it("accounts for final-roster buyers before any next polling pass and ignores older member snapshots", async () => {
  const f = fixture(5, "SHARE");
  const store = emptyGbutsOttStore();
  store.listings.sale = {
    id: "sale",
    requestHash: "hash",
    serviceType: "넷플릭스",
    accountEmail: "private-id@example.com",
    capacity: 5,
    dailyPrice: 140,
    endDate: "2026-12-31",
    title: "title",
    description: "body",
    state: "registered",
    postSeq: 100,
    createdAt: "2026-10-27T07:00:00Z",
  };
  writeGbutsOttStore(store);
  const deps = () => ({
    ...f.deps(),
    reserve: reserveSubscriptionRankPlaces,
    adopt: adoptSubscriptionRankPost,
    verify: async () => {},
  });
  await syncFutureSubscriptionRank(f.client as InviteClient, deps());
  f.advance(360_000);
  f.client.closePost.mockImplementation(async () => {
    f.source.status = "CLOSED";
    f.source.memberCount = 3;
    f.setMembers(
      [1, 2, 3].map((seq) => ({
        seq,
        userSeq: 10 + seq,
        status: "APPLY",
        cancelStatus: null,
        createdAt: "2026-10-27 12:00:00",
        subscriptionEndsAt: f.source.subscriptionEndsAt,
      })),
    );
  });
  await syncFutureSubscriptionRank(f.client as InviteClient, deps());
  let saved = readGbutsOttStore();
  expect(saved.orders["100:3"]).toMatchObject({
    userSeq: 13,
    status: "APPLY",
    delivery: "ready",
  });
  expect(saved.listings.sale.state).toBe("closed");
  expect(
    accountGbutsInventory(
      saved,
      "넷플릭스",
      "private-id@example.com",
      new Date("2026-10-27T07:07:00Z"),
    ),
  ).toMatchObject({ currentUsers: 3, recruiting: 2 });
  saved.orders["100:3"].cancelStatus = "REFUNDED";
  saved.orders["100:3"].verifiedAt = "2026-10-27T07:08:00Z";
  writeGbutsOttStore(saved);
  reserveSubscriptionRankPlaces(
    f.state.policies,
    new Date("2026-10-27T07:09:00Z"),
  );
  expect(readGbutsOttStore().orders["100:3"].cancelStatus).toBe("REFUNDED");
});
it.each(["티빙", "웨이브"])(
  "holds an unrefunded missing %s member after moving remaining recruitment",
  (serviceType) => {
    const s = emptyGbutsOttStore();
    const base = {
      requestHash: "hash",
      serviceType,
      accountEmail: "account@example.com",
      dailyPrice: 100,
      endDate: "2026-12-31",
      title: "title",
      description: "body",
      createdAt: "2026-10-27T07:00:00Z",
    };
    s.listings = {
      old: { ...base, id: "old", postSeq: 100, state: "closed", capacity: 4 },
      next: {
        ...base,
        id: "next",
        postSeq: 200,
        state: "registered",
        capacity: 3,
      },
    };
    s.orders["100:1"] = {
      key: "100:1",
      listingId: "old",
      postSeq: 100,
      memberSeq: 1,
      userSeq: 11,
      name: "buyer",
      status: "MISSING",
      cancelStatus: null,
      startDate: "2026-10-27",
      endDate: "2026-12-31",
      delivery: "confirmed",
      verifiedAt: "2026-10-27T07:00:00Z",
    };
    expect(
      accountGbutsInventory(
        s,
        serviceType,
        "account@example.com",
        new Date("2026-10-27T07:00:00Z"),
      ),
    ).toMatchObject({ currentUsers: 1, recruiting: 3 });
  },
);
