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
  { pattern: /^\/my\/?$/, title: "내 계정" },
  { pattern: /^\/(?:dashboard\/)?access\/[^/?#]+\/?$/, title: "계정 정보 접근" },
];

export function dashboardPageTitleForPath(pathname: string): string {
  const normalizedPath = normalizePathname(pathname);
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
