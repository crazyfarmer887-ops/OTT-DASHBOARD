import { describe, expect, test } from 'vitest';
import {
  SERVICE_FULFILLMENT_POLICIES,
  getServiceFulfillmentPolicy,
  graytagCategoryForService,
  serviceSupports,
} from '../src/lib/service-fulfillment';

describe('service fulfillment policy', () => {
  test('YouTube is invitation-only and enables no credential capabilities', () => {
    expect(getServiceFulfillmentPolicy('유튜브')).toEqual({
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
    });
  });

  test('Netflix keeps the existing credential fulfillment capabilities', () => {
    expect(getServiceFulfillmentPolicy('넷플릭스')).toEqual({
      serviceType: '넷플릭스',
      graytagCategory: 'Netflix',
      mode: 'credentials',
      requiresCredentials: true,
      requiresProfileNickname: true,
      supportsAccessLink: true,
      supportsGeneratedAccount: true,
      supportsEmailAlias: true,
      supportsAutoFill: true,
      supportsRenewal: true,
      supportsUndercutter: true,
    });
  });

  test.each([
    {
      serviceType: '디즈니플러스',
      graytagCategory: 'disney',
      mode: 'credentials',
      requiresCredentials: true,
      requiresProfileNickname: true,
      supportsAccessLink: true,
      supportsGeneratedAccount: true,
      supportsEmailAlias: true,
      supportsAutoFill: true,
      supportsRenewal: true,
      supportsUndercutter: true,
    },
    {
      serviceType: '왓챠플레이',
      graytagCategory: 'WatchaPlay',
      mode: 'credentials',
      requiresCredentials: true,
      requiresProfileNickname: true,
      supportsAccessLink: true,
      supportsGeneratedAccount: true,
      supportsEmailAlias: true,
      supportsAutoFill: true,
      supportsRenewal: true,
      supportsUndercutter: false,
    },
    {
      serviceType: '웨이브',
      graytagCategory: 'wavve',
      mode: 'credentials',
      requiresCredentials: true,
      requiresProfileNickname: true,
      supportsAccessLink: true,
      supportsGeneratedAccount: true,
      supportsEmailAlias: true,
      supportsAutoFill: true,
      supportsRenewal: true,
      supportsUndercutter: true,
    },
    {
      serviceType: '티빙',
      graytagCategory: 'tving',
      mode: 'credentials',
      requiresCredentials: true,
      requiresProfileNickname: true,
      supportsAccessLink: true,
      supportsGeneratedAccount: true,
      supportsEmailAlias: true,
      supportsAutoFill: true,
      supportsRenewal: true,
      supportsUndercutter: true,
    },
  ] as const)('$serviceType keeps its complete credential fulfillment policy', expectedPolicy => {
    expect(getServiceFulfillmentPolicy(expectedPolicy.serviceType)).toEqual(expectedPolicy);
  });

  test('unknown services fail closed instead of inheriting capabilities', () => {
    expect(getServiceFulfillmentPolicy('알 수 없는 서비스')).toBeNull();
    expect(getServiceFulfillmentPolicy('')).toBeNull();
    expect(serviceSupports('알 수 없는 서비스', 'supportsAutoFill')).toBe(false);
    expect(graytagCategoryForService('알 수 없는 서비스')).toBeNull();
  });

  test.each(['__proto__', 'constructor', 'toString'])(
    'special or inherited key %s fails closed',
    serviceType => {
      expect(getServiceFulfillmentPolicy(serviceType)).toBeNull();
      expect(graytagCategoryForService(serviceType)).toBeNull();
      expect(serviceSupports(serviceType, 'supportsAutoFill')).toBe(false);
    },
  );

  test.each([null, undefined, 0, false, {}, []])(
    'non-string input %j fails closed',
    serviceType => {
      expect(getServiceFulfillmentPolicy(serviceType)).toBeNull();
      expect(graytagCategoryForService(serviceType)).toBeNull();
      expect(serviceSupports(serviceType, 'supportsAutoFill')).toBe(false);
    },
  );

  test('the policy registry and every exposed policy are frozen against mutation', () => {
    expect(Object.isFrozen(SERVICE_FULFILLMENT_POLICIES)).toBe(true);

    for (const policy of Object.values(SERVICE_FULFILLMENT_POLICIES)) {
      expect(Object.isFrozen(policy)).toBe(true);
    }

    const netflixPolicy = getServiceFulfillmentPolicy('넷플릭스');
    expect(netflixPolicy).not.toBeNull();
    expect(() => {
      (netflixPolicy as { supportsAutoFill: boolean }).supportsAutoFill = false;
    }).toThrow(TypeError);
    expect(serviceSupports('넷플릭스', 'supportsAutoFill')).toBe(true);
  });

  test('maps every supported service to its current Graytag category', () => {
    expect(Object.fromEntries([
      '넷플릭스',
      '디즈니플러스',
      '왓챠플레이',
      '웨이브',
      '티빙',
      '유튜브',
    ].map(service => [service, graytagCategoryForService(service)]))).toEqual({
      넷플릭스: 'Netflix',
      디즈니플러스: 'disney',
      왓챠플레이: 'WatchaPlay',
      웨이브: 'wavve',
      티빙: 'tving',
      유튜브: 'youtube',
    });
  });
});
