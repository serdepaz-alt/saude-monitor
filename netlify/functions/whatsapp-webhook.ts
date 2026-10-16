import { audit } from './_lib/auth';
import { blindIndex, safeEqual, verifyMetaSignature } from './_lib/crypto';
import { identity, messaging } from './_lib/db';

const RANK: Record<string, number> = { pending: 0, sending: 1, sent: 2, delivered: 3, read: 4, failed: 5 };
const OPT_OUT = ['PARAR', 'SAIR', 'STOP', 'CANCELAR'];

export default async (req: Request) => {
  // Verificação inicial do webhook (Meta)
  if (req.method === 'GET') {
    const u = new URL(req.url);
    const ok = u.searchParams.get('hub.mode') === 'subscribe' &&
      safeEqual(u.searchParams.get('hub.verify_token') ?? '', process.env.WA_VERIFY_TOKEN ?? '');
    return ok ? new Response(u.searchParams.get('hub.challenge') ?? '') : new Response('forbidden', { status: 403 });
  }
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });

  const raw = await req.text();
  if (!verifyMetaSignature(raw, req.headers.get('x-hub-signature-256'))) return new Response('invalid signature', { status: 401 });

  const payload = JSON.parse(raw);
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value ?? {};

      // Status de entrega
      for (const s of value.statuses ?? []) {
        const { data: row } = await messaging().from('outbox').select('id,status').eq('wa_message_id', s.id).maybeSingle();
        if (!row || (RANK[s.status] ?? -1) <= RANK[row.status]) continue; // nunca regredir status
        await messaging().from('outbox').update({
          status: s.status,
          error: s.status === 'failed' ? JSON.stringify(s.errors ?? []).slice(0, 500) : null,
        }).eq('id', row.id);
      }

      // Respostas do paciente
      for (const msg of value.messages ?? []) {
        const text = String(msg.text?.body ?? '').trim().toUpperCase();
        const { data: p } = await identity().from('patients').select('id').eq('phone_hash', blindIndex('+' + msg.from)).maybeSingle();
        if (!p) continue;
        const { data: link } = await identity().from('patient_pseudonym').select('pseudo_id').eq('patient_id', p.id).single();

        if (OPT_OUT.includes(text)) {
          await identity().from('consents').update({ revoked_at: new Date().toISOString() })
            .eq('patient_id', p.id).eq('purpose', 'whatsapp_contact').is('revoked_at', null);
          await audit('patient', 'whatsapp_opt_out', link?.pseudo_id);
        } else {
          await audit('patient', 'inbound_message_needs_review', link?.pseudo_id); // fila para atendimento humano
        }
      }
    }
  }
  return new Response('ok');
};
