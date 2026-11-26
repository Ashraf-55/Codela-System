/** Content-based upload validation. The declared MIME type and the file extension are NEVER trusted: the bytes decide. */
export type Purpose = 'avatar' | 'logo' | 'site' | 'product' | 'document' | 'medical' | 'education' | 'video';
export const PURPOSES: readonly Purpose[] = ['avatar', 'logo', 'site', 'product', 'document', 'medical', 'education', 'video'];
export interface Detected { mime: string; ext: string; kind: 'image' | 'document' | 'video' }

const MB = 1024 * 1024;
export const MAX_VIDEO_BYTES = 150 * 1024 * 1024;
export const RULES: Record<Purpose, { maxBytes: number; kinds: ('image' | 'document' | 'video')[]; visibility: 'public' | 'private' }> = {
  avatar: { maxBytes: 2 * MB, kinds: ['image'], visibility: 'private' },
  logo: { maxBytes: 2 * MB, kinds: ['image'], visibility: 'public' },
  site: { maxBytes: 5 * MB, kinds: ['image'], visibility: 'public' }, // website gallery, team photos, SEO share image
  product: { maxBytes: 5 * MB, kinds: ['image'], visibility: 'public' },
  document: { maxBytes: 10 * MB, kinds: ['image', 'document'], visibility: 'private' },
  medical: { maxBytes: 10 * MB, kinds: ['image', 'document'], visibility: 'private' },
  education: { maxBytes: 10 * MB, kinds: ['image', 'document'], visibility: 'private' },
  video: { maxBytes: MAX_VIDEO_BYTES, kinds: ['video'], visibility: 'private' }, // uploaded through the streaming route only (never buffered in memory)
};
export const MAX_UPLOAD_BYTES = 10 * MB;

const startsWith = (b: Buffer, sig: number[], off = 0) => b.length >= off + sig.length && sig.every((v, i) => b[off + i] === v);
const OFFICE: Record<string, { mime: string; marker: string }> = {
  docx: { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', marker: 'word/' },
  xlsx: { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', marker: 'xl/' },
  pptx: { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', marker: 'ppt/' },
};
const EXT = (name: string) => (/\.([A-Za-z0-9]{1,8})$/.exec(name)?.[1] ?? '').toLowerCase();

/** Video containers we host: MP4 (ISO base media, `ftyp` box) and WebM (EBML header with the `webm` doctype). Decided from the first bytes only, so it works while streaming. */
export function detectVideoHead(head: Buffer): Detected | null {
  if (head.length >= 12 && head.subarray(4, 8).toString('latin1') === 'ftyp') return { mime: 'video/mp4', ext: 'mp4', kind: 'video' };
  if (head.length >= 4 && startsWith(head, [0x1a, 0x45, 0xdf, 0xa3]) && head.subarray(0, 64).toString('latin1').includes('webm')) return { mime: 'video/webm', ext: 'webm', kind: 'video' };
  return null;
}

/** Returns the detected type, or null when the bytes are not an allowed format (SVG, HTML, scripts, executables, archives ... are all rejected). */
export function detectFile(buf: Buffer, originalName: string): Detected | null {
  if (buf.length < 4) return null;
  const vid = detectVideoHead(buf); if (vid) return vid;
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { mime: 'image/png', ext: 'png', kind: 'image' };
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return { mime: 'image/jpeg', ext: 'jpg', kind: 'image' };
  if (buf.subarray(0, 6).toString('latin1') === 'GIF87a' || buf.subarray(0, 6).toString('latin1') === 'GIF89a') return { mime: 'image/gif', ext: 'gif', kind: 'image' };
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return { mime: 'image/webp', ext: 'webp', kind: 'image' };
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return { mime: 'application/pdf', ext: 'pdf', kind: 'document' };
  if (startsWith(buf, [0x50, 0x4b, 0x03, 0x04])) { // ZIP container: only genuine OOXML whose extension matches its internal structure
    const o = OFFICE[EXT(originalName)]; if (!o) return null;
    const head = buf.toString('latin1'); // entry names are stored in clear text in local headers and the central directory
    if (head.includes('[Content_Types].xml') && head.includes(o.marker)) return { mime: o.mime, ext: EXT(originalName), kind: 'document' };
    return null;
  }
  const ext = EXT(originalName);
  if (ext === 'txt' || ext === 'csv') { // plain text: valid UTF-8, no NUL bytes, and not markup/script
    if (buf.includes(0)) return null;
    let text: string; try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { return null; }
    if (/^\s*(<\?xml|<!doctype|<html|<svg|<script|#!)/i.test(text)) return null;
    return { mime: ext === 'csv' ? 'text/csv' : 'text/plain', ext, kind: 'document' };
  }
  return null;
}

export type Verdict = { ok: true; detected: Detected; safeName: string } | { ok: false; status: number; code: string; message: string };
export function validateUpload(purpose: string, buf: Buffer, originalName: string): Verdict {
  if (!(PURPOSES as readonly string[]).includes(purpose)) return { ok: false, status: 400, code: 'BAD_REQUEST', message: 'Unknown upload purpose' };
  const rule = RULES[purpose as Purpose];
  if (buf.length === 0) return { ok: false, status: 400, code: 'BAD_REQUEST', message: 'Empty file' };
  if (buf.length > rule.maxBytes) return { ok: false, status: 413, code: 'FILE_TOO_LARGE', message: `File exceeds the ${Math.floor(rule.maxBytes / MB)} MB limit for ${purpose}` };
  const d = detectFile(buf, originalName);
  if (!d) return { ok: false, status: 415, code: 'UNSUPPORTED_FILE_TYPE', message: 'File type is not allowed' };
  if (!rule.kinds.includes(d.kind)) return { ok: false, status: 415, code: 'UNSUPPORTED_FILE_TYPE', message: `${purpose} accepts ${rule.kinds.join('/')} files only` };
  return { ok: true, detected: d, safeName: sanitizeName(originalName, d.ext) };
}

/** Strips paths, control/bidi characters and anything odd; always ends with the DETECTED extension. */
export function sanitizeName(name: string, ext: string): string {
  const base = name.replace(/\\/g, '/').split('/').pop()!.replace(/\.[^.]*$/, '')
    .normalize('NFKC').replace(/[\p{Cc}\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu, '').replace(/[^\p{L}\p{N}._ -]/gu, '_').replace(/^[.\s]+/, '').trim().slice(0, 80);
  return `${base || 'file'}.${ext}`;
}
