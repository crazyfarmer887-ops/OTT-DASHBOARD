export type GraytagAccountId = 'primary' | 'youtube-invite-sales' | 'secondary';
export type DashboardWorkspace = GraytagAccountId | 'gbuts' | 'linkid';

const GRAYTAG_ACCOUNT_STORAGE_KEY = 'aio.graytagAccount';
const WORKSPACE_STORAGE_KEY = 'aio.dashboardWorkspace';

function storedPreference(key: string): string | null {
  try { return typeof window === 'undefined' ? null : window.localStorage.getItem(key); }
  catch { return null; }
}

export function getDashboardWorkspace(): DashboardWorkspace {
  const workspace = storedPreference(WORKSPACE_STORAGE_KEY);
  if (workspace === 'secondary' || workspace === 'gbuts' || workspace === 'linkid' || workspace === 'primary' || workspace === 'youtube-invite-sales') return workspace;
  return storedPreference(GRAYTAG_ACCOUNT_STORAGE_KEY) === 'youtube-invite-sales' ? 'youtube-invite-sales' : 'primary';
}

export function setDashboardWorkspace(workspace: DashboardWorkspace): void {
  try {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(WORKSPACE_STORAGE_KEY, workspace);
    if (workspace !== 'gbuts' && workspace !== 'linkid') window.localStorage.setItem(GRAYTAG_ACCOUNT_STORAGE_KEY, workspace);
  } catch { /* Browsers without storage can still navigate to the selected page. */ }
}

export function getGraytagAccountId(): GraytagAccountId {
  const workspace=getDashboardWorkspace();return workspace==='secondary'||workspace==='youtube-invite-sales'?workspace:'primary';
}

export function setGraytagAccountId(accountId: GraytagAccountId): void {
  setDashboardWorkspace(accountId);
}

export function dashboardWorkspaceRedirect(workspace: DashboardWorkspace, path: string): string | null {
  if (path === '/linkid') return null;
  if (path.startsWith('/access/') || path.startsWith('/dashboard/access/')) return null;
  if (workspace === 'linkid') return path === '/linkid' ? null : '/linkid';
  if (workspace !== 'gbuts') return null;
  return ['/gbuts', '/gbuts-sales', '/gbuts-accounts', '/gbuts-orders', '/spotify-invites'].includes(path) ? null : '/gbuts';
}

export function dashboardWorkspaceHome(workspace: DashboardWorkspace): string {
  if (workspace === 'linkid') return '/linkid';
  if (workspace === 'gbuts') return '/gbuts';
  return workspace === 'youtube-invite-sales' ? '/youtube-invites' : '/';
}
