import { describe, expect, test, vi } from 'vitest';
import {
  decideRegistrationReconciliation,
  summarizeRegistrationEvidence,
  type RegistrationEvidenceSnapshot,
} from '../src/renewal/reconciliation';

const captured = (seconds: number) => new Date(Date.parse('2026-08-05T12:00:00.000Z') + seconds * 1000).toISOString();

function negative(seconds: number): RegistrationEvidenceSnapshot {
  return {
    capturedAt: captured(seconds),
    oldDeal: {
      authoritative: true,
      present: true,
      extensionProductExist: false,
      extensionStatus: null,
      dealStatus: 'UsingNearExpiration',
    },
    extensionListing: {
      authoritative: true,
      present: false,
      priceType: null,
      linkedDeal: false,
      targetNewEnd: false,
      productIdPresent: false,
    },
  };
}

function positive(seconds: number): RegistrationEvidenceSnapshot {
  return {
    ...negative(seconds),
    extensionListing: {
      authoritative: true,
      present: true,
      priceType: 'Extended',
      linkedDeal: true,
      targetNewEnd: true,
      productIdPresent: true,
    },
  };
}

describe('pure registration reconciliation decision', () => {
  test('any exact positive extension match is registered', () => {
    expect(decideRegistrationReconciliation([negative(0), positive(5)], {
      minimumNegativeChecks: 3,
      minimumWindowMs: 10_000,
    })).toBe('registered');
  });

  test('three authoritative negatives spanning the configured request window are safe failed', () => {
    expect(decideRegistrationReconciliation([negative(0), negative(5), negative(10)], {
      minimumNegativeChecks: 3,
      minimumWindowMs: 10_000,
    })).toBe('registration_failed_safe');
  });

  test('eventual consistency positive on a later check overrides earlier negatives', () => {
    expect(decideRegistrationReconciliation([negative(0), negative(5), positive(10)], {
      minimumNegativeChecks: 3,
      minimumWindowMs: 10_000,
    })).toBe('registered');
  });

  test('one authoritative negative remains verification needed', () => {
    expect(decideRegistrationReconciliation([negative(0)], {
      minimumNegativeChecks: 3,
      minimumWindowMs: 10_000,
    })).toBe('verification_needed');
  });

  test('contradictory old-deal and seller evidence remains verification needed', () => {
    const contradictory = negative(0);
    contradictory.oldDeal.extensionProductExist = true;
    expect(decideRegistrationReconciliation([contradictory, negative(5), negative(10)], {
      minimumNegativeChecks: 3,
      minimumWindowMs: 10_000,
    })).toBe('verification_needed');
  });

  test('an aged manual job can use two fresh authoritative negatives but never one candidate row alone', () => {
    const policy = {
      minimumNegativeChecks: 3,
      minimumWindowMs: 10_000,
      manualAgedJob: { createdAt: captured(-61), minimumAgeMs: 60_000, freshNegativeChecks: 2 },
    };
    expect(decideRegistrationReconciliation([negative(0)], policy)).toBe('verification_needed');
    expect(decideRegistrationReconciliation([negative(0), negative(1)], policy)).toBe('registration_failed_safe');
  });

  test('stored evidence summary contains booleans and timestamp only, never raw statuses or ids', () => {
    const summary = summarizeRegistrationEvidence(positive(0));
    expect(summary).toEqual(expect.objectContaining({ capturedAt: captured(0), exactMatch: true }));
    expect(JSON.stringify(summary)).not.toMatch(/deal-1|product-1|"UsingNearExpiration"|:"Extended"/);
    expect(Object.values(summary).every((value) => typeof value === 'boolean' || typeof value === 'string')).toBe(true);
  });
});
