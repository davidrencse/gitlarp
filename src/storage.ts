// Type of a published-activity entry.
export type Activity = { id: string; project: string; files: number; commits: number; date: string; url?: string };
// Type guard: check that stored data is a valid Activity.
function isActivity(value: unknown): value is Activity {
  // Must be an object.
  if (!value || typeof value !== 'object') return false;
  // Treat it as a record for checking.
  const item = value as Record<string, unknown>;
  // Strings for id and project.
  if (typeof item.id !== 'string' || typeof item.project !== 'string'
    // files must be a safe non-negative integer.
    || typeof item.files !== 'number' || !Number.isSafeInteger(item.files) || item.files < 0
    // commits must be a safe non-negative integer.
    || typeof item.commits !== 'number' || !Number.isSafeInteger(item.commits) || item.commits < 0
    // date must be an ISO-like date string.
    || typeof item.date !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(item.date) || !Number.isFinite(Date.parse(item.date))) return false;
  // If a URL exists:
  if (item.url !== undefined) {
    // It must be a string.
    if (typeof item.url !== 'string') return false;
    // It must be a plain https://github.com URL without credentials.
    if (item.url) { try { const url = new URL(item.url); if (url.origin !== 'https://github.com' || url.username || url.password) return false; } catch { return false; } }
  }
  // All checks passed.
  return true;
}
// Read the default pull-request preference (true when missing or invalid).
export function readPreference() { try { const value: unknown = JSON.parse(localStorage.getItem('gitlarp.defaultPr') || 'null'); return typeof value === 'boolean' ? value : true; } catch { return true; } }
// Read the saved activity list from localStorage.
export function readActivities(key: string): Activity[] {
  // Return it only if it is a valid list of 50 or fewer entries; otherwise an empty list.
  try { const value: unknown = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(value) && value.length <= 50 && value.every(isActivity) ? value : []; } catch { return []; }
}
