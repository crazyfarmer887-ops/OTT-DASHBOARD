export const DASHBOARD_TITLE_BASE = "OTT dashboard";

const ROUTE_TITLES: Array<{ pattern: RegExp; title: string }> = [
  { pattern: /^\/$/, title: "홈" },
  { pattern: /^\/manage\/?$/, title: "계정 관리" },
  { pattern: /^\/profit\/?$/, title: "수익" },
  { pattern: /^\/price(?:\/[^/?#]+)?\/?$/, title: "가격" },
  { pattern: /^\/write\/?$/, title: "글 작성" },
  { pattern: /^\/chat\/?$/, title: "채팅" },
  { pattern: /^\/edit-price\/?$/, title: "게시물 관리" },
  { pattern: /^\/party-info\/?$/, title: "파티 정보" },
  { pattern: /^\/youtube-invites\/?$/, title: "유튜브 초대 운영" },
  { pattern: /^\/everyview\/?$/, title: "에브리뷰 관리" },
  { pattern: /^\/my\/?$/, title: "내 계정" },
  { pattern: /^\/(?:dashboard\/)?access\/[^/?#]+\/?$/, title: "계정 정보 접근" },
];

export function dashboardPageTitleForPath(pathname: string): string {
  const normalizedPath = normalizePathname(pathname);
  if (normalizedPath.startsWith('/spotify-invites')) return 'Spotify 초대 | 대시보드';
  if (normalizedPath.startsWith('/gbuts-sales')) return '벗츠 OTT 판매글 작성 | 대시보드';
  if (normalizedPath === '/gbuts-accounts') return '벗츠 계정 관리 | 대시보드';
  if (normalizedPath === '/gbuts') return '벗츠 판매 관리 | 대시보드';
  if (normalizedPath === '/gbuts-orders') return '벗츠 주문·전달 관리 | 대시보드';
  const match = ROUTE_TITLES.find((route) => route.pattern.test(normalizedPath));
  return match ? `${DASHBOARD_TITLE_BASE} | ${match.title}` : DASHBOARD_TITLE_BASE;
}

function normalizePathname(pathname: string): string {
  const rawPath = String(pathname || "/").split(/[?#]/, 1)[0] || "/";
  const withoutDashboardPrefix = rawPath.startsWith("/dashboard/") && !rawPath.startsWith("/dashboard/access/")
    ? rawPath.slice("/dashboard".length) || "/"
    : rawPath;
  return withoutDashboardPrefix.startsWith("/") ? withoutDashboardPrefix : `/${withoutDashboardPrefix}`;
}
