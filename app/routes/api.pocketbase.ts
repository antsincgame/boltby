import { type ActionFunctionArgs, type LoaderFunctionArgs } from '@remix-run/cloudflare';

const POCKETBASE_URL = process.env.POCKETBASE_URL || 'http://localhost:8090';

const ALLOWED_PATH_PREFIXES = ['/api/collections', '/api/records', '/api/health', '/api/admins'];

function isPathSafe(path: string): boolean {
  if (!path.startsWith('/api/')) {
    return false;
  }

  if (path.includes('..') || path.includes('\\')) {
    return false;
  }

  return ALLOWED_PATH_PREFIXES.some((prefix) => path.startsWith(prefix));
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
      const resp = await fetch(`${POCKETBASE_URL}/api/collections`, { signal: AbortSignal.timeout(5000) });
      const data = await resp.json();

      return Response.json(data);
    } catch (error: any) {
      return Response.json({ ok: false, error: error.message }, { status: 503 });
    }
  }

  return Response.json({ error: 'Unknown action' }, { status: 400 });
}

export async function action({ request }: ActionFunctionArgs) {
  const body = await request.json<{ path: string; method?: string; data?: any }>();
  const { path, method = 'GET', data } = body;

  if (!isPathSafe(path)) {
    return Response.json({ ok: false, error: `Forbidden path: ${path}` }, { status: 403 });
  }

  const allowedMethods = ['GET', 'POST', 'PATCH', 'DELETE'];

  if (!allowedMethods.includes(method.toUpperCase())) {
    return Response.json({ ok: false, error: `Forbidden method: ${method}` }, { status: 405 });
  }

  try {
    const resp = await fetch(`${POCKETBASE_URL}${path}`, {
      method: method.toUpperCase(),
      headers: { 'Content-Type': 'application/json' },
      body: data ? JSON.stringify(data) : undefined,
      signal: AbortSignal.timeout(10000),
    });

    const result = await resp.json();

    return Response.json(result, { status: resp.status });
  } catch (error: any) {
    return Response.json({ ok: false, error: error.message }, { status: 503 });
  }
}
