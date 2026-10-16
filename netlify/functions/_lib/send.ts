import { identity, messaging } from './db';
import { decrypt } from './crypto';
import { audit } from './auth';

const MAX_ATTEMPTS = 3;
const clean = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim(); // WhatsApp não aceita quebras em parâmetros

type Job = {
  id: string;
  pseudo_id: string;
  template_name: string;
  variables: Record<string, string>;
  attempts: number;
};

export async function processOutbox(opts: { limit?: number; id?: string } = {}) {
  let q = messaging()
    .from('outbox')
    .select('id')
    .eq('status', 'pending')
    .lte('scheduled_for', new Date().toISOString())
    .limit(opts.limit ?? 50);
  if (opts.id) q = q.eq('id', opts.id);
  const { data: ids } = await q;

  for (const { id } of ids ?? []) {
    // "Claim" atômico: evita envio duplicado entre o agendador e o disparo imediato.
    const { data: job } = await messaging()
      .from('outbox')
      .update({ status: 'sending' })
      .eq('id', id)
      .eq('status', 'pending')
      .select('*')
      .maybeSingle();
    if (job) await sendJob(job as Job);
  }
}

async function fail(job: Job, error: string, final = false) {
  const attempts = job.attempts + 1;
  await messaging()
    .from('outbox')
    .update({ status: final || attempts >= MAX_ATTEMPTS ? 'failed' : 'pending', attempts, error })
    .eq('id', job.id);
}

async function sendJob(job: Job) {
  // Identidade só é resolvida aqui, no servidor, no último momento.
  const { data: link } = await identity().from('patient_pseudonym').select('patient_id').eq('pseudo_id', job.pseudo_id).maybeSingle();
  if (!link) return fail(job, 'paciente não encontrado', true);

  const { data: consent } = await identity()
    .from('consents')
    .select('id')
    .eq('patient_id', link.patient_id)
    .eq('purpose', 'whatsapp_contact')
    .eq('granted', true)
    .is('revoked_at', null)
    .limit(1);
  if (!consent?.length) return fail(job, 'sem consentimento para WhatsApp', true);

  const { data: patient } = await identity().from('patients').select('full_name, phone_enc').eq('id', link.patient_id).single();
  if (!patient) return fail(job, 'cadastro ausente', true);

  const v = job.variables;
  const params = [patient.full_name.split(' ')[0], v.measurement, v.date, v.status, v.advice, v.link].map(clean);

  const res = await fetch(`https://graph.facebook.com/v21.0/${process.env.WA_PHONE_ID}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.WA_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: decrypt(patient.phone_enc).replace('+', ''),
      type: 'template',
      template: {
        name: job.template_name,
        language: { code: 'pt_BR' },
        components: [{ type: 'body', parameters: params.map((text) => ({ type: 'text', text })) }],
      },
    }),
  });
  const body = await res.json().catch(() => ({}));

  if (!res.ok) return fail(job, JSON.stringify(body?.error ?? body).slice(0, 500));

  await messaging()
    .from('outbox')
    .update({ status: 'sent', wa_message_id: body.messages?.[0]?.id ?? null, sent_at: new Date().toISOString(), error: null })
    .eq('id', job.id);
  await audit('system:send', 'whatsapp_send', job.pseudo_id);
}
