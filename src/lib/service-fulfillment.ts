export type FulfillmentMode = 'credentials' | 'invitation';

export interface ServiceFulfillmentPolicy {
  readonly serviceType: string;
  readonly graytagCategory: string;
  readonly mode: FulfillmentMode;
  readonly requiresCredentials: boolean;
  readonly requiresProfileNickname: boolean;
  readonly supportsAccessLink: boolean;
  readonly supportsGeneratedAccount: boolean;
  readonly supportsEmailAlias: boolean;
  readonly supportsAutoFill: boolean;
  readonly supportsRenewal: boolean;
  readonly supportsUndercutter: boolean;
}

export type ServiceFulfillmentCapability =
  | 'requiresCredentials'
  | 'requiresProfileNickname'
  | 'supportsAccessLink'
  | 'supportsGeneratedAccount'
  | 'supportsEmailAlias'
  | 'supportsAutoFill'
  | 'supportsRenewal'
  | 'supportsUndercutter';

const credentialPolicy = (
  serviceType: string,
  graytagCategory: string,
  supportsUndercutter: boolean,
): ServiceFulfillmentPolicy => Object.freeze({
  serviceType,
  graytagCategory,
  mode: 'credentials',
  requiresCredentials: true,
  requiresProfileNickname: true,
  supportsAccessLink: true,
  supportsGeneratedAccount: true,
  supportsEmailAlias: true,
  supportsAutoFill: true,
  supportsRenewal: true,
  supportsUndercutter,
});

export const SERVICE_FULFILLMENT_POLICIES: Readonly<Record<string, ServiceFulfillmentPolicy>> = Object.freeze({
  넷플릭스: credentialPolicy('넷플릭스', 'Netflix', true),
  디즈니플러스: credentialPolicy('디즈니플러스', 'disney', true),
  왓챠플레이: credentialPolicy('왓챠플레이', 'WatchaPlay', false),
  웨이브: credentialPolicy('웨이브', 'wavve', true),
  티빙: credentialPolicy('티빙', 'tving', true),
  유튜브: Object.freeze({
    serviceType: '유튜브',
    graytagCategory: 'youtube',
    mode: 'invitation',
    requiresCredentials: false,
    requiresProfileNickname: false,
    supportsAccessLink: false,
    supportsGeneratedAccount: false,
    supportsEmailAlias: false,
    supportsAutoFill: false,
    supportsRenewal: false,
    supportsUndercutter: false,
  }),
});

export function getServiceFulfillmentPolicy(serviceType: unknown): ServiceFulfillmentPolicy | null {
  const normalized = typeof serviceType === 'string' ? serviceType.trim() : '';
  return Object.prototype.hasOwnProperty.call(SERVICE_FULFILLMENT_POLICIES, normalized)
    ? SERVICE_FULFILLMENT_POLICIES[normalized]
    : null;
}

export function graytagCategoryForService(serviceType: unknown): string | null {
  return getServiceFulfillmentPolicy(serviceType)?.graytagCategory ?? null;
}

export function serviceSupports(
  serviceType: unknown,
  capability: ServiceFulfillmentCapability,
): boolean {
  return getServiceFulfillmentPolicy(serviceType)?.[capability] === true;
}
