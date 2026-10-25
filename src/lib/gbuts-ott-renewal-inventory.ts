import { getGeneratedAccountPartyMax, type GeneratedAccountStore } from './generated-accounts';
import { buildPartyAccessDeliverySnapshotByMember, resolvePartyAccessDeliverySnapshotByListing, partyAccessAccountKey, extractPartyAccessTokensFromText, partyAccessTokenHash, type PartyAccessLinkStore } from './party-access';
import type { PartyMaintenanceChecklistStore } from './party-maintenance-checklist';
import { isGraytagAccessNoticeCredential } from './graytag-fill';
import { dedupeGraytagManagementDeals } from './graytag-management-snapshot';
import { koreaToday, ottDate, type GbutsOttManagement } from './gbuts-ott';
import { extractDeliveredAccountFromChats, type DeliveredAccountChatLike } from './deal-delivered-account';

/** Fresh open deals only: do not hydrate chat credentials, replay closed history,
 * revoke links or replace the full account-management cache with a partial view. */
export function buildGbutsRenewalInventory(generated: GeneratedAccountStore, openDeals: any[], access: PartyAccessLinkStore,
  maintenance: PartyMaintenanceChecklistStore, serviceType = '디즈니플러스'): GbutsOttManagement {
  const accounts = Object.values(generated).filter(a => a.serviceType === serviceType).map(a => ({
    email: a.email, serviceType: a.serviceType, totalSlots: getGeneratedAccountPartyMax(a.serviceType), members: [] as any[],
    expiryDate: a.expiryDate, generatedAccount: { paymentStatus: a.paymentStatus },
  }));
  const onSaleByKeepAcct: Record<string, any[]> = {};
  const snapshots = buildPartyAccessDeliverySnapshotByMember(access, { includeManagementSynthetic: false });
  const aliases = new Map(accounts.flatMap(a => [a.email, maintenance[partyAccessAccountKey(a.serviceType, a.email)]?.changedAccountEmail]
    .filter((email): email is string => !!email).map(email => [email.trim().toLowerCase(), a] as const)));
  for (const deal of dedupeGraytagManagementDeals(openDeals)) {
    if (!deal.productTypeString) throw new Error('그레이태그 현재 거래의 서비스 종류 확인이 필요합니다.');
    if (deal.productTypeString !== serviceType) continue;
    const snapshot = resolvePartyAccessDeliverySnapshotByListing(snapshots, { serviceType, dealUsid: deal.dealUsid, productUsid: deal.productUsid });
    const email = String(snapshot?.accountEmail || deal.keepAcct || '').trim();
    if (!email.includes('@') || isGraytagAccessNoticeCredential(email)) throw new Error('그레이태그 재등록 거래의 계정 연결 확인이 필요합니다.');
    const account = aliases.get(email.toLowerCase());
    if (!account) continue;
    if (deal.dealStatus === 'OnSale') (onSaleByKeepAcct[account.email] ||= []).push(deal);
    else account.members.push(deal);
  }
  return { services: [{ serviceType, accounts }], onSaleByKeepAcct };
}

/** Resolve only fresh selected-service rows, from seller-authored delivery evidence.
 * No chat send, synthetic access mapping, credential persistence or full-cache write. */
export async function resolveGbutsRenewalDealAccounts(deals: any[], access: PartyAccessLinkStore, serviceType: string,
  readChats: (deal: any) => Promise<DeliveredAccountChatLike[]>, now = new Date()): Promise<any[]> {
  const snapshots = buildPartyAccessDeliverySnapshotByMember(access, { includeManagementSynthetic: false });
  const result: any[] = [];
  for (const deal of dedupeGraytagManagementDeals(deals)) {
    if (deal.productTypeString !== serviceType) { result.push(deal); continue; }
    const endDate = ottDate(deal.endDateTime);
    if (endDate && endDate < koreaToday(now)) continue;
    const snapshot = resolvePartyAccessDeliverySnapshotByListing(snapshots, { serviceType, dealUsid: deal.dealUsid, productUsid: deal.productUsid });
    const known = String(snapshot?.accountEmail || deal.keepAcct || '').trim();
    if (known.includes('@') && !isGraytagAccessNoticeCredential(known)) { result.push(deal); continue; }
    const candidates = new Map<string, string>();
    for (const chat of await readChats(deal)) {
      if (!(chat.owned ?? chat.isOwned ?? false) || chat.informationMessage || chat.messageType === 'Information') continue;
      const emails = extractPartyAccessTokensFromText(String(chat.message || '')).flatMap(token => {
        const record = access[partyAccessTokenHash(token)];
        return record && !record.revokedAt && record.serviceType === serviceType ? [record.accountEmail] : [];
      });
      const direct = extractDeliveredAccountFromChats([chat]); if (direct) emails.push(direct);
      for (const value of emails) if (value.includes('@') && !isGraytagAccessNoticeCredential(value)) candidates.set(value.trim().toLowerCase(), value.trim());
    }
    if (candidates.size > 1) throw new Error('현재 거래의 전달 계정을 하나로 확인하지 못했습니다.');
    result.push(candidates.size ? { ...deal, keepAcct: [...candidates.values()][0] } : deal);
  }
  return result;
}
