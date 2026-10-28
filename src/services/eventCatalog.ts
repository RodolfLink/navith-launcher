import { fetchLauncherApi } from './launcherApi';

export interface ServerAsset {
  id?: string;
  name?: string;
  filename: string;
  url: string;
  sha256?: string | null;
  size?: number | null;
  enabled?: boolean;
}

export interface ServerManifest {
  format_version: number;
  base_archive_url?: string | null;
  config_archive_url?: string | null;
  files: ServerAsset[];
  excluded_files: string[];
  archive_index?: ServerAsset[];
}

export interface LauncherServer {
  id: number;
  name: string;
  subtitle?: string | null;
  description?: string | null;
  server_ip: string;
  minecraft_version: string;
  loader: string;
  loader_version?: string | null;
  banner_url?: string | null;
  logo_url?: string | null;
  menu_background?: string | null;
  music_url?: string | null;
  music_title?: string | null;
  music_author?: string | null;
  status?: string | null;
  event_status?: string | null;
  publication_status?: string | null;
  publication_state?: string | null;
  is_finalized?: boolean;
  finalized_at?: string | null;
  ended_at?: string | null;
  tags?: string[];
  links?: Record<string, string>;
  availability?: 'open' | 'full' | 'maintenance' | string;
  maintenance_message?: string | null;
  content_revision: number;
  content_manifest: ServerManifest;
  is_private: boolean;
  updated_at?: string | null;
}

export interface InvitedEvent {
  server: LauncherServer;
  accessToken: string;
  instanceId: string;
  installedRevision: number;
}

const INVITED_EVENTS_KEY = 'navithlabs.invited-events.v1';
const PENDING_EVENT_CLEANUP_KEY = 'navithlabs.pending-event-cleanup.v1';

function randomInstanceId(serverId: number): string {
  const suffix = globalThis.crypto?.randomUUID?.().replace(/-/g, '') || `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  return `event_${serverId}_${suffix}`;
}

function parseInvitedEvent(value: unknown): InvitedEvent | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<InvitedEvent>;
  const server = candidate.server;
  if (!server || typeof server !== 'object' || !Number.isFinite(Number(server.id)) || !server.name) return null;
  if (!candidate.accessToken || typeof candidate.accessToken !== 'string') return null;
  if (!candidate.instanceId || !/^event_[a-zA-Z0-9_-]+$/.test(candidate.instanceId)) return null;
  return {
    server: server as LauncherServer,
    accessToken: candidate.accessToken,
    instanceId: candidate.instanceId,
    installedRevision: Math.max(0, Number(candidate.installedRevision) || 0),
  };
}

export function loadInvitedEvents(): InvitedEvent[] {
  try {
    const saved = localStorage.getItem(INVITED_EVENTS_KEY);
    if (!saved) return [];
    const parsed: unknown = JSON.parse(saved);
    return Array.isArray(parsed) ? parsed.map(parseInvitedEvent).filter((event): event is InvitedEvent => Boolean(event)) : [];
  } catch {
    return [];
  }
}

export function saveInvitedEvents(events: InvitedEvent[]): void {
  localStorage.setItem(INVITED_EVENTS_KEY, JSON.stringify(events));
}

export function loadPendingEventCleanups(): string[] {
  try {
    const saved = localStorage.getItem(PENDING_EVENT_CLEANUP_KEY);
    if (!saved) return [];
    const parsed: unknown = JSON.parse(saved);
    return Array.isArray(parsed)
      ? [...new Set(parsed.filter((id): id is string => typeof id === 'string' && /^event_[a-zA-Z0-9_-]+$/.test(id)))]
      : [];
  } catch {
    return [];
  }
}

export function queueEventCleanups(instanceIds: string[]): void {
  const pending = new Set(loadPendingEventCleanups());
  instanceIds.forEach(id => {
    if (/^event_[a-zA-Z0-9_-]+$/.test(id)) pending.add(id);
  });
  localStorage.setItem(PENDING_EVENT_CLEANUP_KEY, JSON.stringify([...pending]));
}

export function completeEventCleanups(instanceIds: string[]): void {
  const completed = new Set(instanceIds);
  localStorage.setItem(PENDING_EVENT_CLEANUP_KEY, JSON.stringify(loadPendingEventCleanups().filter(id => !completed.has(id))));
}

async function readApiResponse<T>(response: Response, fallback: string): Promise<T> {
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const validation = payload.errors && typeof payload.errors === 'object'
      ? Object.values(payload.errors as Record<string, unknown>).flat().find((message): message is string => typeof message === 'string')
      : undefined;
    const message = typeof payload.message === 'string' ? payload.message : validation;
    const error = new Error(message || fallback) as Error & { status?: number; code?: string };
    error.status = response.status;
    const code = payload.code ?? payload.error_code;
    if (typeof code === 'string') error.code = code;
    if (response.status >= 500) error.name = 'LauncherApiUnavailableError';
    throw error;
  }
  return payload as T;
}

const FINAL_EVENT_STATES = new Set(['finished', 'finalized', 'finalised', 'completed', 'ended', 'closed', 'cancelled', 'canceled', 'terminated', 'archived']);

export function isFinalizedEvent(server: LauncherServer): boolean {
  const metadata = server as LauncherServer & { state?: string | null; finalized?: boolean };
  const statuses = [server.availability, server.status, server.event_status, server.publication_status, server.publication_state, metadata.state];
  return metadata.is_finalized === true
    || metadata.finalized === true
    || Boolean(server.finalized_at || server.ended_at)
    || statuses.some(status => typeof status === 'string' && FINAL_EVENT_STATES.has(status.trim().toLowerCase()));
}

export function isFinalizedEventError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const details = error as { status?: number; code?: string };
  return details.status === 404
    || details.status === 410
    || ['event_finalized', 'event_finished', 'event_ended', 'invitation_revoked'].includes(details.code?.toLowerCase() || '');
}

export async function redeemEventCode(code: string): Promise<{ server: LauncherServer; accessToken: string }> {
  const response = await fetchLauncherApi('/launcher-api/servers/redeem', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ code: code.trim() }),
  });
  const payload = await readApiResponse<{ server: LauncherServer; access_token: string }>(response, 'No se pudo comprobar el código.');
  if (!payload.server || !payload.access_token) throw new Error('La respuesta de la web no incluye el acceso al evento.');
  return { server: payload.server, accessToken: payload.access_token };
}

export async function refreshInvitedEvent(event: InvitedEvent): Promise<LauncherServer> {
  const response = await fetchLauncherApi(`/launcher-api/servers/${event.server.id}`, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${event.accessToken}` },
    cache: 'no-store',
  });
  const payload = await readApiResponse<{ server: LauncherServer }>(response, 'No se pudo actualizar la información del evento.');
  if (!payload.server) throw new Error('La web no devolvió los datos del evento.');
  return payload.server;
}

export function createInvitedEvent(server: LauncherServer, accessToken: string): InvitedEvent {
  return {
    server,
    accessToken,
    instanceId: randomInstanceId(server.id),
    installedRevision: 0,
  };
}

export function eventFolder(instanceId: string, baseDirectory: string): string {
  const separator = baseDirectory.includes('\\') ? '\\' : '/';
  return `${baseDirectory.replace(/[\\/]+$/, '')}${separator}modpacks${separator}${instanceId}`;
}
