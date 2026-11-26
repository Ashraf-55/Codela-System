export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string, public fields?: Record<string, string[]>) { super(message); }
}
export const badRequest = (m: string, f?: Record<string, string[]>) => new HttpError(400, 'BAD_REQUEST', m, f);
export const unauthorized = () => new HttpError(401, 'UNAUTHORIZED', 'Authentication required');
export const forbidden = (m = 'You do not have permission to perform this action') => new HttpError(403, 'FORBIDDEN', m);
export const notFound = (m = 'Not found') => new HttpError(404, 'NOT_FOUND', m);
export const conflict = (m: string) => new HttpError(409, 'CONFLICT', m);
