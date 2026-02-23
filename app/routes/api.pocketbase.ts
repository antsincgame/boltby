import { type ActionFunctionArgs, type LoaderFunctionArgs } from '@remix-run/cloudflare';

const POCKETBASE_URL = process.env.POCKETBASE_URL || 'http://localhost:8090';
const SUPERUSER_EMAIL = process.env.POCKETBASE_ADMIN_EMAIL || 'admin@bolt.local';
const SUPERUSER_PASSWORD = process.env.POCKETBASE_ADMIN_PASSWORD || 'boltadmin2024';

const ALLOWED_PATH_PREFIXES = ['/api/collections', '/api/records', '/api/health', '/api/admins', '/api/files'];

function isPathSafe(path: string): boolean {
  if (!path.startsWith('/api/')) {
    return false;
  }

  if (path.includes('..') || path.includes('\\')) {
    return false;
  }

  return ALLOWED_PATH_PREFIXES.some((prefix) => path.startsWith(prefix));
}

async function getSuperuserToken(): Promise<string | null> {
  try {
    const resp = await fetch(`${POCKETBASE_URL}/api/collections/_superusers/auth-with-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identity: SUPERUSER_EMAIL, password: SUPERUSER_PASSWORD }),
      signal: AbortSignal.timeout(5000),
    });

    if (!resp.ok) {
      return null;
    }

    const data = (await resp.json()) as { token: string };

    return data.token;
  } catch {
    return null;
  }
}

async function getExistingCollections(token: string): Promise<Set<string>> {
  const resp = await fetch(`${POCKETBASE_URL}/api/collections?perPage=500`, {
    headers: { Authorization: token },
    signal: AbortSignal.timeout(5000),
  });

  if (!resp.ok) {
    return new Set();
  }

  const data = (await resp.json()) as { items?: Array<{ name: string }> };

  return new Set((data.items || []).map((c) => c.name));
}

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const action = url.searchParams.get('action');

  if (action === 'health') {
    try {
      const resp = await fetch(`${POCKETBASE_URL}/api/health`, { signal: AbortSignal.timeout(5000) });
      const data = (await resp.json()) as Record<string, unknown>;

      return Response.json({ ok: resp.ok, ...data });
    } catch (error: any) {
      return Response.json({ ok: false, error: error.message }, { status: 503 });
    }
  }

  if (action === 'collections') {
    try {
      const token = await getSuperuserToken();
      const headers: Record<string, string> = {};

      if (token) {
        headers.Authorization = token;
      }

      const resp = await fetch(`${POCKETBASE_URL}/api/collections?perPage=500`, {
        headers,
        signal: AbortSignal.timeout(5000),
      });
      const data = await resp.json();

      return Response.json(data);
    } catch (error: any) {
      return Response.json({ ok: false, error: error.message }, { status: 503 });
    }
  }

  return Response.json({ error: 'Unknown action' }, { status: 400 });
}

export async function action({ request }: ActionFunctionArgs) {
  const body = await request.json<{
    action?: string;
    path?: string;
    method?: string;
    data?: any;
    collections?: Array<{ name: string; type?: string; schema?: any[] }>;
  }>();

  // --- Auto-setup collections ---
  if (body.action === 'setup-collections' && Array.isArray(body.collections)) {
    const token = await getSuperuserToken();

    if (!token) {
      return Response.json({ ok: false, error: 'PocketBase not available or superuser auth failed' }, { status: 503 });
    }

    const existing = await getExistingCollections(token);
    const results: Array<{ name: string; status: string; error?: string }> = [];
    const headers = { 'Content-Type': 'application/json', Authorization: token };

    for (const col of body.collections) {
      if (!col.name || typeof col.name !== 'string') {
        results.push({ name: '(invalid)', status: 'skipped', error: 'Missing collection name' });
        continue;
      }

      if (existing.has(col.name)) {
        results.push({ name: col.name, status: 'exists' });
        continue;
      }

      try {
        const resp = await fetch(`${POCKETBASE_URL}/api/collections`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            name: col.name,
            type: col.type || 'base',
            schema: col.schema || [],
          }),
          signal: AbortSignal.timeout(10000),
        });

        if (resp.ok) {
          existing.add(col.name);
          results.push({ name: col.name, status: 'created' });
        } else {
          const err = await resp.text();
          results.push({ name: col.name, status: 'error', error: err });
        }
      } catch (error: any) {
        results.push({ name: col.name, status: 'error', error: error.message });
      }
    }

    return Response.json({ ok: true, results });
  }

  // --- Generic proxy ---
  const { path, method = 'GET', data } = body;

  if (!path) {
    return Response.json({ error: 'Missing path' }, { status: 400 });
  }

  if (!isPathSafe(path)) {
    return Response.json({ ok: false, error: `Forbidden path: ${path}` }, { status: 403 });
  }

  const allowedMethods = ['GET', 'POST', 'PATCH', 'DELETE'];

  if (!allowedMethods.includes(method.toUpperCase())) {
    return Response.json({ ok: false, error: `Forbidden method: ${method}` }, { status: 405 });
  }

  try {
    const token = await getSuperuserToken();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };

    if (token) {
      headers.Authorization = token;
    }

    const resp = await fetch(`${POCKETBASE_URL}${path}`, {
      method: method.toUpperCase(),
      headers,
      body: data ? JSON.stringify(data) : undefined,
      signal: AbortSignal.timeout(10000),
    });

    const result = await resp.json();

    return Response.json(result, { status: resp.status });
  } catch (error: any) {
    return Response.json({ ok: false, error: error.message }, { status: 503 });
  }
}
