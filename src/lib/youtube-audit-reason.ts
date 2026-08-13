const YOUTUBE_AUDIT_REASON_PATTERN = /^[\p{L}\p{N} .,!()_'\-]+$/u;

/**
 * Accept only short, human-readable audit text that cannot carry a raw email,
 * URL, query string, or control characters into lifecycle history/audit logs.
 */
export function normalizeYouTubeAuditReason(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  let decoded = value;
  if (value.includes('%')) {
    try { decoded = decodeURIComponent(value); }
    catch { return null; }
  }
  const reason = decoded.trim();
  if (!reason || reason.length > 200 || !YOUTUBE_AUDIT_REASON_PATTERN.test(reason)) return null;
  return reason;
}
