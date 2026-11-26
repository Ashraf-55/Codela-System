import { headers } from 'next/headers';
export const API_URL = process.env.API_URL ?? 'http://127.0.0.1:4000';
export const ROOT_DOMAIN = process.env.ROOT_DOMAIN ?? 'localhost';

/** Server-side API call. `tenantHost` selects the tenant for public site endpoints. */
export async function serverApi<T = any>(path: string, tenantHost?: string): Promise<{ ok: boolean; status: number; data: T | null; meta?: any }> {
  try {
    const h: Record<string, string> = {}; if (tenantHost) h['x-forwarded-host'] = tenantHost;
    const res = await fetch(`${API_URL}/api/v1${path}`, { headers: h, cache: 'no-store' });
    const json = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data: res.ok ? (json.data as T) : null, meta: json.meta };
  } catch { return { ok: false, status: 503, data: null }; }
}
export const requestHost = async () => (await headers()).get('host') ?? '';
