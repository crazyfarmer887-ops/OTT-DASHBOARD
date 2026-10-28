import { writeFileSync, chmodSync } from "node:fs";
import { loadGbutsSession } from "../src/lib/gbuts-session";
import { createGbutsOttSellerClient } from "../src/lib/gbuts-ott-client";
import { readGbutsOttStore } from "../src/lib/gbuts-ott-store";
import {
  features,
  time,
  hash,
  hasDeliveryEvidence,
  type Features,
} from "../src/support/policy";
const root =
    process.env.GBUTS_SUPPORT_ROOT || "/home/ubuntu/.config/gbuts/support",
  session = loadGbutsSession();
if (!session) throw Error("SESSION_REQUIRED");
const api = createGbutsOttSellerClient(session.token),
  seller = await api.sellerAccountSeq(),
  store = readGbutsOttStore();
const collected: Array<{ features: Features; sourceHash: string }> = [];
for (const order of Object.values(store.orders)
  .filter((o) => o.roomId && o.delivery === "confirmed")
  .slice()
  .reverse()) {
  const listing = store.listings[order.listingId];
  if (!listing) continue;
  try {
    const c = await api.getChat(order.roomId!);
    if (
      c.members.length !== 2 ||
      !c.members.some(
        (m) => m && typeof m === "object" && "seq" in m && m.seq === seller,
      ) ||
      !c.members.some(
        (m) =>
          m && typeof m === "object" && "seq" in m && m.seq === order.userSeq,
      )
    )
      continue;
    let perRoom = 0;
    const messages = [...c.messages].sort(
      (a, b) => time(a.createdAt) - time(b.createdAt),
    );
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (
        m.senderSeq !== order.userSeq ||
        m.messageType !== "TEXT" ||
        time(m.createdAt) < Date.now() - 7 * 86400000
      )
        continue;
      const delivered = hasDeliveryEvidence(messages.slice(0, i), seller);
      const f = features(m.message, listing.serviceType, delivered, 0);
      if (!f.intents.length) continue;
      collected.push({
        features: f,
        sourceHash: hash([order.roomId, m.senderSeq, m.createdAt, m.message]),
      });
      if (++perRoom >= 3) break;
    }
  } catch {
    /* Unavailable historical rooms are never guessed. */
  }
  if (collected.length >= 36) break;
}
const path = root + "/replay-features.json";
writeFileSync(
  path,
  JSON.stringify(
    collected.map((c) => c.features),
    null,
    2,
  ),
  { mode: 0o600 },
);
chmodSync(path, 0o600);
writeFileSync(
  root + "/replay-provenance.json",
  JSON.stringify(
    collected.map((c) => ({
      sourceHash: c.sourceHash,
      featuresHash: hash(c.features),
    })),
  ),
  { mode: 0o600 },
);
console.log(
  JSON.stringify({
    actualHistoricalInquiries: collected.length,
    identityFreeFeatures: true,
  }),
);
