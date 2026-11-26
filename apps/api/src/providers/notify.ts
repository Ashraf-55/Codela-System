import type { NotificationProvider, Providers } from '../outbox';

/**
 * Real delivery adapters over plain HTTPS (no extra npm dependencies). Each one only exists when its credentials are set,
 * so a missing key yields status "no_provider" in the outbox (honest) instead of a pretend delivery.
 * None of these has been exercised against the live services from the authoring environment (no network): only request
 * shaping and error handling are unit-tested with an injected fetch. See docs/NOTIFICATIONS.md.
 */
type F = typeof fetch;
const timeout = () => AbortSignal.timeout(15_000);
async function expectOk(r: Response, what: string): Promise<Record<string, any>> {
  if (r.ok) return (await r.json().catch(() => ({}))) as Record<string, any>;
  const body = (await r.text().catch(() => '')).slice(0, 200).replace(/\s+/g, ' ');
  throw new Error(`${what} responded ${r.status}${body ? `: ${body}` : ''}`); // message is stored in outbox.last_error; never include credentials
}
const esc = (t: string) => t.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/** Transactional email through Resend's REST API (https://resend.com/docs/api-reference/emails/send-email). */
export function resendEmail(o: { apiKey: string; from: string; fetchImpl?: F }): NotificationProvider {
  const f = o.fetchImpl ?? fetch;
  return { async send(m) {
    if (!m.to.includes('@')) throw new Error('Invalid recipient e-mail');
    const html = `<div dir="auto" style="font-family:system-ui,Segoe UI,Tahoma,sans-serif;line-height:1.6">${esc(m.body).replace(/\n/g, '<br>')}</div>`;
    const j = await expectOk(await f('https://api.resend.com/emails', { method: 'POST', headers: { authorization: `Bearer ${o.apiKey}`, 'content-type': 'application/json' }, body: JSON.stringify({ from: o.from, to: [m.to], subject: m.subject ?? 'Codela', text: m.body, html }), signal: timeout() }), 'Resend');
    return typeof j.id === 'string' ? { id: j.id } : undefined;
  } };
}

/** SMS through Twilio's REST API (https://www.twilio.com/docs/messaging/api/message-resource). `from` = number or messaging-service SID (MG...). */
export function twilioSms(o: { accountSid: string; authToken: string; from: string; statusCallback?: string; fetchImpl?: F }): NotificationProvider {
  const f = o.fetchImpl ?? fetch;
  return { async send(m) {
    if (!/^\+\d{8,15}$/.test(m.to)) throw new Error('Recipient must be in E.164 format (+20...)');
    const form = new URLSearchParams({ To: m.to, Body: m.body.slice(0, 1500) }); form.set(o.from.startsWith('MG') ? 'MessagingServiceSid' : 'From', o.from); if (o.statusCallback) form.set('StatusCallback', o.statusCallback);
    const j = await expectOk(await f(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(o.accountSid)}/Messages.json`, { method: 'POST', headers: { authorization: `Basic ${Buffer.from(`${o.accountSid}:${o.authToken}`).toString('base64')}`, 'content-type': 'application/x-www-form-urlencoded' }, body: form, signal: timeout() }), 'Twilio');
    return typeof j.sid === 'string' ? { id: j.sid } : undefined;
  } };
}

/**
 * WhatsApp through Meta's Cloud API. Business-initiated messages outside the 24h customer-service window MUST use a pre-approved
 * template: set `templateName` (+ language) to send template messages with the text as the single body parameter; without it a
 * free-form text message is sent (works only inside the 24h window / with the Meta test number to allow-listed recipients).
 */
export function whatsappCloud(o: { token: string; phoneNumberId: string; apiVersion?: string; templateName?: string; templateLang?: string; fetchImpl?: F }): NotificationProvider {
  const f = o.fetchImpl ?? fetch;
  return { async send(m) {
    const to = m.to.replace(/^\+/, ''); if (!/^\d{8,15}$/.test(to)) throw new Error('Recipient must be an international phone number');
    const payload = o.templateName
      ? { messaging_product: 'whatsapp', to, type: 'template', template: { name: o.templateName, language: { code: o.templateLang ?? 'ar' }, components: [{ type: 'body', parameters: [{ type: 'text', text: m.body.slice(0, 1000) }] }] } }
      : { messaging_product: 'whatsapp', to, type: 'text', text: { body: m.body.slice(0, 4000) } };
    const j = await expectOk(await f(`https://graph.facebook.com/${o.apiVersion ?? 'v21.0'}/${encodeURIComponent(o.phoneNumberId)}/messages`, { method: 'POST', headers: { authorization: `Bearer ${o.token}`, 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: timeout() }), 'WhatsApp Cloud API');
    const id = j.messages?.[0]?.id; return typeof id === 'string' ? { id } : undefined;
  } };
}

export function providersFromEnv(env: NodeJS.ProcessEnv = process.env, fetchImpl?: F): Providers {
  const p: Providers = {};
  if (env.RESEND_API_KEY && env.EMAIL_FROM) p.email = resendEmail({ apiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM, fetchImpl });
  if (env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM) p.sms = twilioSms({ accountSid: env.TWILIO_ACCOUNT_SID, authToken: env.TWILIO_AUTH_TOKEN, from: env.TWILIO_FROM, statusCallback: env.PUBLIC_API_URL ? `${env.PUBLIC_API_URL.replace(/\/$/, '')}/api/v1/webhooks/twilio-status` : undefined, fetchImpl });
  if (env.WHATSAPP_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID) p.whatsapp = whatsappCloud({ token: env.WHATSAPP_TOKEN, phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID, templateName: env.WHATSAPP_TEMPLATE_NAME, templateLang: env.WHATSAPP_TEMPLATE_LANG, fetchImpl });
  return p;
}
