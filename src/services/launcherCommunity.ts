import { fetchLauncherApi } from './launcherApi';

const CLIENT_KEY = 'navithlabs.client-id.v1';

export interface LauncherAnnouncement { id: number; title: string; body: string; link?: string | null; created_at?: string }
export interface CommunityFeed {
  announcements: LauncherAnnouncement[];
  maintenance: { enabled: boolean; message: string };
}

export function launcherClientId(): string {
  try {
    const saved = localStorage.getItem(CLIENT_KEY);
    if (saved && /^[a-zA-Z0-9_-]{8,96}$/.test(saved)) return saved;
    const id = globalThis.crypto?.randomUUID?.().replace(/-/g, '') || `nl_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
    localStorage.setItem(CLIENT_KEY, id);
    return id;
  } catch {
    return `nl_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
  }
}

async function post(path: string, payload: Record<string, unknown>): Promise<void> {
  const response = await fetchLauncherApi(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`Community API ${response.status}`);
}

export async function sendLauncherHeartbeat(version: string): Promise<void> {
  await post('/launcher-api/stats/heartbeat', { client_id: launcherClientId(), launcher_version: version });
}

export async function recordLauncherLaunch(version: string, loader: string, eventId: number): Promise<void> {
  await post('/launcher-api/stats/launch', { client_id: launcherClientId(), minecraft_version: version, loader, event_id: eventId });
}

export async function fetchCommunityFeed(): Promise<CommunityFeed> {
  const response = await fetchLauncherApi('/launcher-api/announcements', { cache: 'no-store', headers: { Accept: 'application/json' } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Community API ${response.status}`);
  return {
    announcements: Array.isArray(payload.announcements) ? payload.announcements : [],
    maintenance: { enabled: Boolean(payload.maintenance?.enabled), message: String(payload.maintenance?.message || '') },
  };
}
