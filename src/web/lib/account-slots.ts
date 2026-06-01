export interface SlotCountsInput {
  totalSlots: number;
  usingCount: number;
  verifyingCount?: number;
  manualCount?: number;
  activeCount?: number;
  recruitingCount?: number;
}

export type SlotState = 'using' | 'verifying' | 'manual' | 'recruiting' | 'active' | 'empty';

export interface VacancyMemberLike {
  dealUsid?: string | null;
  productUsid?: string | null;
  status?: string | null;
  statusName?: string | null;
  endDateTime?: string | null;
  remainderDays?: number | null;
}

export interface VacancyRecruitingProductLike {
  productUsid?: string | null;
  productType?: string | null;
  endDateTime?: string | null;
  remainderDays?: number | null;
}

export interface AccountVacancyInput {
  serviceType: string;
  members?: VacancyMemberLike[];
  maxSlots?: number | null;
  manualCount?: number | null;
  recruitingProducts?: VacancyRecruitingProductLike[];
  now?: Date;
}

export interface AccountVacancyInfo<TProduct extends VacancyRecruitingProductLike = VacancyRecruitingProductLike> {
  maxSlots: number;
  currentUsers: number;
  manualCount: number;
  recruiting: number;
  vacancy: number;
  unfilled: number;
  onSaleList: TProduct[];
}

const PARTY_MAX: Record<string, number> = {
  '넷플릭스': 5,
  '디즈니플러스': 6,
  '왓챠플레이': 4,
  '티빙': 4,
  '웨이브': 4,
  '티빙+웨이브': 4,
};

const CURRENT_MEMBER_STATUSES = new Set(['Using', 'UsingNearExpiration', 'DeliveredAndCheckPrepaid']);
const RECRUITING_STATUSES = new Set(['OnSale', 'Delivered', 'Delivering', 'LendingAcceptanceWaiting', 'Reserved']);

export function getPartyMax(serviceType: string, fallback?: number | null): number {
  const configured = PARTY_MAX[String(serviceType || '').trim()];
  const numericFallback = Number(fallback || 0);
  return Math.max(0, configured || (Number.isFinite(numericFallback) ? numericFallback : 0) || 6);
}

function parseDateOnly(value?: string | null): Date | null {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const compact = raw.match(/^(\d{4})(\d{2})(\d{2})T?/);
  if (compact) return new Date(`${compact[1]}-${compact[2]}-${compact[3]}T00:00:00`);
  const iso = raw.match(/(\d{4})[-./\s]+(\d{1,2})[-./\s]+(\d{1,2})/);
  if (iso) return new Date(`${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}T00:00:00`);
  const short = raw.match(/(\d{2})[-./\s]+(\d{1,2})[-./\s]+(\d{1,2})/);
  if (short) {
    const y = Number(short[1]);
    return new Date(`${y < 50 ? 2000 + y : 1900 + y}-${short[2].padStart(2, '0')}-${short[3].padStart(2, '0')}T00:00:00`);
  }
  return null;
}

function todayStart(now: Date): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d;
}

function isCurrentByTime(value: { endDateTime?: string | null; remainderDays?: number | null }, now: Date, requireDate: boolean): boolean {
  if (typeof value.remainderDays === 'number' && Number.isFinite(value.remainderDays)) return value.remainderDays >= 0;
  const end = parseDateOnly(value.endDateTime);
  if (!end) return !requireDate;
  return end.getTime() >= todayStart(now).getTime();
}

function isAccountChecking(statusName?: string | null): boolean {
  const label = String(statusName || '');
  return label.includes('계정확인중') || label.includes('계정 확인중');
}

export function isCurrentAccountMember(member: VacancyMemberLike, now = new Date()): boolean {
  const status = String(member.status || '');
  if (!(CURRENT_MEMBER_STATUSES.has(status) || isAccountChecking(member.statusName))) return false;
  return isCurrentByTime(member, now, false);
}

export function isActiveRecruitingSlot(item: VacancyMemberLike | VacancyRecruitingProductLike, now = new Date()): boolean {
  const status = 'status' in item ? String(item.status || '') : 'OnSale';
  const statusName = 'statusName' in item ? String(item.statusName || '') : '';
  if (!(RECRUITING_STATUSES.has(status) || statusName.includes('판매중') || statusName.includes('판매 중'))) return false;
  return isCurrentByTime(item, now, true);
}

export function dedupeRecruitingProducts<T extends { productUsid?: string | null }>(products: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const product of products || []) {
    const id = String(product?.productUsid || '').trim();
    if (!id) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(product);
  }
  return out;
}

export function buildAccountSlotStates(input: SlotCountsInput): SlotState[] {
  const total = Math.max(0, input.totalSlots || 0);
  const verifyingCount = Math.max(0, input.verifyingCount || 0);
  const pureUsingCount = Math.max(0, (input.usingCount || 0) - verifyingCount);
  const manualCount = Math.max(0, input.manualCount || 0);
  const recruitingCount = Math.max(0, input.recruitingCount || 0);
  const activeCount = Math.max(0, input.activeCount || 0);
  const states: SlotState[] = [];

  for (let i = 0; i < total; i++) {
    if (i < pureUsingCount) states.push('using');
    else if (i < pureUsingCount + verifyingCount) states.push('verifying');
    else if (i < pureUsingCount + verifyingCount + manualCount) states.push('manual');
    else if (i < pureUsingCount + verifyingCount + manualCount + recruitingCount) states.push('recruiting');
    else if (i < activeCount) states.push('active');
    else states.push('empty');
  }
  return states;
}

export function mergeRecruitingProducts<T extends { productUsid?: string | null }>(existing: T[], additions: T[]): T[] {
  return dedupeRecruitingProducts([...(existing || []), ...(additions || [])]);
}

export function calculateAccountVacancy<TProduct extends VacancyRecruitingProductLike>(input: AccountVacancyInput & { recruitingProducts?: TProduct[] }): AccountVacancyInfo<TProduct> {
  const now = input.now || new Date();
  const maxSlots = getPartyMax(input.serviceType, input.maxSlots);
  const members = input.members || [];
  const currentUsers = members.filter(member => isCurrentAccountMember(member, now)).length;
  const manualCount = Math.max(0, Number(input.manualCount || 0));
  const memberRecruitingProductIds = new Set(
    members
      .filter(member => isActiveRecruitingSlot(member, now))
      .map(member => String(member.productUsid || member.dealUsid || '').trim())
      .filter(Boolean)
  );
  const externalRecruiting = dedupeRecruitingProducts(input.recruitingProducts || [])
    .filter(product => {
      if (product.productType && product.productType !== input.serviceType) return false;
      if (!isActiveRecruitingSlot(product, now)) return false;
      const id = String(product.productUsid || '').trim();
      return !id || !memberRecruitingProductIds.has(id);
    });
  const recruiting = memberRecruitingProductIds.size + externalRecruiting.length;
  const vacancy = Math.max(0, maxSlots - currentUsers - manualCount);
  const unfilled = Math.max(0, vacancy - recruiting);
  return { maxSlots, currentUsers, manualCount, recruiting, vacancy, unfilled, onSaleList: externalRecruiting };
}

export function canAccountReceiveAutoFill(input: {
  email?: string | null;
  vacancy: Pick<AccountVacancyInfo, 'currentUsers' | 'manualCount' | 'unfilled'>;
  generatedPaymentStatus?: string | null;
}): boolean {
  const email = String(input.email || '').trim();
  if (!email || email === '(직접전달)') return false;
  if (input.vacancy.unfilled <= 0) return false;
  if (input.vacancy.currentUsers > 0 || input.vacancy.manualCount > 0) return true;
  return input.generatedPaymentStatus === 'paid';
}
