/** Normalises Egyptian/international phone numbers to E.164 for SMS/WhatsApp ("01012345678" -> "+201012345678"). Returns null when it cannot. */
export function toE164(raw: string, defaultCountry = '20'): string | null {
  const s = raw.replace(/[\s().-]/g, ''); let out: string;
  if (/^\+\d{8,15}$/.test(s)) out = s;
  else if (/^00\d{8,15}$/.test(s)) out = `+${s.slice(2)}`;
  else if (defaultCountry === '20' && /^01[0125]\d{8}$/.test(s)) out = `+20${s.slice(1)}`;
  else return null;
  return /^\+\d{8,15}$/.test(out) ? out : null;
}
