import { atom } from 'nanostores';

export interface PocketBaseConnectionState {
  url: string;
  isConnected: boolean;
  status: 'checking' | 'connected' | 'disconnected';
}

const DEFAULT_URL = 'http://localhost:8090';

export const pocketbaseConnection = atom<PocketBaseConnectionState>({
  url: DEFAULT_URL,
  isConnected: false,
  status: 'checking',
});

let healthCheckInterval: ReturnType<typeof setInterval> | null = null;
let healthCheckRunning = false;

export async function checkPocketBaseHealth(url?: string): Promise<boolean> {
  const pbUrl = url || pocketbaseConnection.get().url;

  try {
    const resp = await fetch(`${pbUrl}/api/health`, { signal: AbortSignal.timeout(3000) });
    return resp.ok;
  } catch {
    return false;
  }
}

export async function initPocketBaseConnection() {
  const savedUrl = typeof window !== 'undefined' ? localStorage.getItem('pocketbase_url') : null;
  const url = savedUrl || DEFAULT_URL;

  pocketbaseConnection.set({ url, isConnected: false, status: 'checking' });

  const ok = await checkPocketBaseHealth(url);
  pocketbaseConnection.set({ url, isConnected: ok, status: ok ? 'connected' : 'disconnected' });

  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
  }

  healthCheckInterval = setInterval(async () => {
    if (healthCheckRunning) {
      return;
    }

    healthCheckRunning = true;

    try {
      const currentUrl = pocketbaseConnection.get().url;
      const healthy = await checkPocketBaseHealth(currentUrl);
      const prev = pocketbaseConnection.get();

      if (prev.isConnected !== healthy) {
        pocketbaseConnection.set({ ...prev, isConnected: healthy, status: healthy ? 'connected' : 'disconnected' });
      }
    } finally {
      healthCheckRunning = false;
    }
  }, 30000);
}

export function setPocketBaseUrl(url: string) {
  if (typeof window !== 'undefined') {
    localStorage.setItem('pocketbase_url', url);
  }

  pocketbaseConnection.set({ url, isConnected: false, status: 'checking' });
  checkPocketBaseHealth(url)
    .then((ok) => {
      pocketbaseConnection.set({ url, isConnected: ok, status: ok ? 'connected' : 'disconnected' });
    })
    .catch(() => {
      pocketbaseConnection.set({ url, isConnected: false, status: 'disconnected' });
    });
}
