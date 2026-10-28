const DEFAULT_API_BASE_URL = 'https://navithlabs-event-console.vercel.app';
const DEFAULT_SERVER_STATUS_BASE_URL = 'https://api.mcsrvstat.us/2';

function normalizeBaseUrl(value: string | undefined): string | undefined {
  const trimmed = value?.trim().replace(/\/+$/, '');
  return trimmed || undefined;
}

const configuredApiBases = (
  String(import.meta.env.VITE_NAVITHLABS_API_BASE_URLS || import.meta.env.VITE_NAVITHLABS_API_BASE_URL || DEFAULT_API_BASE_URL)
)
  .split(',')
  .map(normalizeBaseUrl)
  .filter((value: string | undefined): value is string => Boolean(value));

const uniqueConfiguredApiBases: string[] = [...new Set(configuredApiBases)];
export const LAUNCHER_API_BASE_URLS: string[] = uniqueConfiguredApiBases;
export const LAUNCHER_API_BASE_URL: string = LAUNCHER_API_BASE_URLS[0] || '';
export const LAUNCHER_STORAGE_BASE_URL: string = normalizeBaseUrl(String(import.meta.env.VITE_NAVITHLABS_STORAGE_BASE_URL || ''))
  || LAUNCHER_API_BASE_URL;
export const SERVER_STATUS_BASE_URL: string = normalizeBaseUrl(String(import.meta.env.VITE_SERVER_STATUS_BASE_URL || ''))
  || DEFAULT_SERVER_STATUS_BASE_URL;

function joinUrl(base: string, path: string): string {
  return `${base}/${path.replace(/^\/+/, '')}`;
}

export async function fetchLauncherApi(path: string, init?: RequestInit): Promise<Response> {
  if (LAUNCHER_API_BASE_URLS.length === 0) {
    return new Response(JSON.stringify({ error: 'La API de NavithLabs no está configurada.' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let lastResponse: Response | undefined;
  let lastError: unknown;
  const method = (init?.method || 'GET').toUpperCase();
  const canRetrySafely = method === 'GET' || method === 'HEAD' || method === 'OPTIONS';

  for (let index = 0; index < LAUNCHER_API_BASE_URLS.length; index += 1) {
    const base: string = LAUNCHER_API_BASE_URLS[index] || DEFAULT_API_BASE_URL;
    try {
      const response = await fetch(joinUrl(base, path), init);
      const canTryNext = index < LAUNCHER_API_BASE_URLS.length - 1
        && (response.status === 404 || (canRetrySafely && response.status >= 500));
      if (!canTryNext) return response;
      lastResponse = response;
    } catch (error) {
      if (!canRetrySafely) throw error;
      lastError = error;
    }
  }

  if (lastResponse) return lastResponse;
  throw lastError instanceof Error ? lastError : new Error('No se pudo conectar con la API del launcher.');
}

export function launcherApiUrl(path: string): string {
  if (!LAUNCHER_API_BASE_URL) return path;
  return joinUrl(LAUNCHER_API_BASE_URL, path);
}

export function launcherStorageUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const cleanPath = path.replace(/^\/+/, '').split('/').map(encodeURIComponent).join('/');
  return joinUrl(LAUNCHER_STORAGE_BASE_URL, `storage/${cleanPath}`);
}

export interface MinecraftServerStatus {
  online: boolean;
  players: number;
  maxPlayers: number;
  ping: number | null;
}

export async function fetchMinecraftServerStatus(
  address: string,
  signal?: AbortSignal,
): Promise<MinecraftServerStatus> {
  const response = await fetch(joinUrl(SERVER_STATUS_BASE_URL, encodeURIComponent(address)), {
    cache: 'no-store',
    signal,
  });
  if (!response.ok) throw new Error(`El proveedor de estado respondió ${response.status}.`);

  const data = await response.json();
  const rawPing = data?.ping ?? data?.debug?.ping;
  const parsedPing = rawPing == null ? null : Number(rawPing);
  return {
    online: Boolean(data?.online),
    players: Number(data?.players?.online) || 0,
    maxPlayers: Number(data?.players?.max) || 0,
    ping: parsedPing !== null && Number.isFinite(parsedPing) ? parsedPing : null,
  };
}
