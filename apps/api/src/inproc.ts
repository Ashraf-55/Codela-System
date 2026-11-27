import { createRequire } from 'node:module';
import inject from 'light-my-request';
import type { RequestListener } from 'node:http';

/**
 * In-process HTTP bridge for scripts/start-all.mjs (Hostinger refuses connections between processes on 127.0.0.1).
 * light-my-request's mock request ignores destroy() once its body was handed over, so a route that aborts a streamed
 * upload (e.g. a disguised video) would wait forever for 'close'. A real socket always closes: emit it. And mark it as
 * server-initiated (_error): there is no remote client in the bridge, so the response must still be delivered.
 */
const LmrRequest = createRequire(import.meta.url)('light-my-request/lib/request.js') as { prototype: { destroy: (e?: Error) => unknown } };
const original = LmrRequest.prototype.destroy;
LmrRequest.prototype.destroy = function (this: { destroyed: boolean; _error?: boolean; _lightMyRequest?: { isDone?: boolean }; emit: (e: string) => void }, error?: Error) {
  this._error = true; // server-side destroy: keep the response (light-my-request would otherwise treat 'close' as a client abort)
  if (this._lightMyRequest?.isDone && !this.destroyed) { this.destroyed = true; process.nextTick(() => this.emit('close')); return this; }
  return original.call(this, error);
};

export interface BridgeRequest { method: string; url: string; headers: Record<string, string>; payload?: Buffer | string }
export interface BridgeResponse { status: number; headers: [string, string][]; body: Buffer }

/** Serve one request through `app` without a socket. The caller is treated as the local website (127.0.0.1). */
export function createBridge(app: RequestListener) {
  return async (r: BridgeRequest): Promise<BridgeResponse> => {
    const res = await inject(app, { method: r.method as 'GET', url: r.url, headers: r.headers, payload: r.payload, remoteAddress: '127.0.0.1' });
    const headers: [string, string][] = [];
    for (const [k, v] of Object.entries(res.headers)) if (v !== undefined) for (const x of ([] as unknown[]).concat(v)) headers.push([k, String(x)]);
    return { status: res.statusCode, headers, body: res.rawPayload };
  };
}
