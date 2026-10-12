import type { ManagementSubscription, ManagementSubscriptionStore } from '../../lib/management-subscriptions';

export function accountSubscription(store: ManagementSubscriptionStore, service: string, email: string): ManagementSubscription | undefined {
  return store[`${service.trim()}:${email.trim().toLowerCase()}`];
}

export function cancellationSummary(store: ManagementSubscriptionStore) {
  const accounts = Object.values(store).filter(row => !row.billingOwnerKey);
  return {
    accounts,
    newMonthlySavings: accounts.filter(row => row.newlyCancelled).reduce((sum, row) => sum + row.monthlyAmount, 0),
    totalStoppedMonthlyBilling: accounts.reduce((sum, row) => sum + row.monthlyAmount, 0),
  };
}
