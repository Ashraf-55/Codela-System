export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public fields?: Record<string, string[]>) { super(message); }
}
export type Scope = 'tenant' | 'platform' | 'portal';
const cookie = (name: string) => (typeof document === 'undefined' ? '' : document.cookie.split('; ').find((c) => c.startsWith(name + '='))?.split('=')[1] ?? '');

export interface Res<T> { data: T; meta?: { total: number; page: number; pageSize: number } }
/** Browser API client. All calls go through the same-origin proxy (/api/v1/*), which forwards cookies and the tenant host. */
export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; scope?: Scope; site?: string } = {}): Promise<Res<T>> {
  const method = opts.method ?? 'GET';
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET') { const t = cookie(opts.scope === 'platform' ? 'pcsrf' : opts.scope === 'portal' ? 'cust_csrf' : 'csrf'); if (t) headers['x-csrf-token'] = t; }
  if (opts.site) headers['x-codela-site'] = opts.site;
  const res = await fetch(`/api/v1${path}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body), credentials: 'same-origin', cache: 'no-store' });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, json?.error?.code ?? 'ERROR', json?.error?.message ?? res.statusText, json?.error?.fields);
  return json as Res<T>;
}

/** Uploads a file (raw body, type detected server-side from the bytes). Returns the stored file record incl. its url. */
export async function uploadFile(purpose: string, file: File): Promise<{ id: string; url: string; name: string; mime: string; size: number }> {
  const t = cookie('csrf'); const headers: Record<string, string> = { 'content-type': 'application/octet-stream', 'x-file-name': encodeURIComponent(file.name) };
  if (t) headers['x-csrf-token'] = t;
  const res = await fetch(`/api/v1/tenant/files?purpose=${encodeURIComponent(purpose)}`, { method: 'POST', headers, body: file, credentials: 'same-origin', cache: 'no-store' });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, json?.error?.code ?? 'ERROR', json?.error?.message ?? res.statusText, json?.error?.fields);
  return json.data;
}

/** Uploads a lesson's hosted video (streamed, with progress) or its downloadable material, tied to that lesson. Returns the stored file; the caller then saves `fileId` on the lesson. */
export function uploadLessonMedia(kind: 'video' | 'material', lessonId: string, file: File, onProgress?: (pct: number) => void): Promise<{ id: string; name: string; mime: string; size: number }> {
  return new Promise((resolve, reject) => {
    const t = cookie('csrf'); const xhr = new XMLHttpRequest();
    xhr.open('POST', kind === 'video' ? `/api/v1/tenant/files/video?entityId=${encodeURIComponent(lessonId)}` : `/api/v1/tenant/files?purpose=education&entityType=lesson&entityId=${encodeURIComponent(lessonId)}`);
    xhr.setRequestHeader('content-type', 'application/octet-stream'); xhr.setRequestHeader('x-file-name', encodeURIComponent(file.name)); if (t) xhr.setRequestHeader('x-csrf-token', t);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(Math.round((e.loaded / e.total) * 100)); };
    xhr.onerror = () => reject(new ApiError(0, 'NETWORK', 'Network error while uploading'));
    xhr.onload = () => { let j: any = {}; try { j = JSON.parse(xhr.responseText); } catch { /* not JSON */ } if (xhr.status >= 200 && xhr.status < 300) resolve(j.data); else reject(new ApiError(xhr.status, j?.error?.code ?? 'ERROR', j?.error?.message ?? xhr.statusText, j?.error?.fields)); };
    xhr.send(file);
  });
}
