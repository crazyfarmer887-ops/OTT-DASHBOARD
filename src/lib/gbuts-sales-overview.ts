import { GBUTS_OTT_CATEGORIES, activeOttOrder, koreaToday, ottDate, type GbutsOttStore } from './gbuts-ott';
import type { GbutsOttPost } from './gbuts-ott-client';

const SERVICES = { ...GBUTS_OTT_CATEGORIES, 스포티파이: 20 };

export function buildGbutsSalesOverview(posts: GbutsOttPost[], store: GbutsOttStore, now = new Date()) {
  const current = posts.filter(post => ottDate(post.subscriptionEndsAt) >= koreaToday(now) && post.status !== 'REFUNDED');
  const orders = Object.values(store.orders).filter(order => activeOttOrder(order, now));
  return {
    services: Object.entries(SERVICES).map(([serviceType, category]) => {
      const listings = current.filter(post => post.category1.seq === category);
      const listingIds = new Set(Object.values(store.listings).filter(listing => listing.serviceType === serviceType).map(listing => listing.id));
      const activeOrders = orders.filter(order => listingIds.has(order.listingId));
      return { serviceType, listings: listings.length,
        recruiting: listings.filter(post => post.status === 'ON_SALE').reduce((n, post) => n + Math.max(0, post.memberLimit - post.memberCount), 0),
        members: listings.reduce((n, post) => n + post.memberCount, 0),
        confirmed: activeOrders.filter(order => order.delivery === 'confirmed').length,
        pending: activeOrders.filter(order => order.delivery !== 'confirmed').length,
        invitationFlow: serviceType === '스포티파이' };
    }),
    listings: current.map(post => ({ seq: post.seq, serviceType: Object.entries(SERVICES).find(([, category]) => category === post.category1.seq)?.[0] || '기타',
      memberCount: post.memberCount, memberLimit: post.memberLimit, status: post.status, endDate: ottDate(post.subscriptionEndsAt),
      dailyPrice: post.priceType === 'DAY' ? Number(post.price) : null })),
    lastSuccess: store.lastSuccess, lastError: store.lastError, updatedAt: now.toISOString(),
  };
}
