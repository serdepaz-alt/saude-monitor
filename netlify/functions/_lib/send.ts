import { identity, messaging } from './db';
import { decrypt } from './crypto';
import { audit } from './auth';

const MAX_ATTEMPTS = 3;
const clean = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim();
const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

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

function buildEmail(firstName: string, v: Record<string, string>) {
  const name = clean(firstName);
  const measurement = clean(v.measurement);
  const date = clean(v.date);
  const status = clean(v.status);
  const advice = clean(v.advice);
  const link = clean(v.link);

  const subject = `Resultado da sua medição de ${measurement.split(' (')[0]}`;
  const text = [
    `Olá, ${name}!`,
    `Sua medição de ${measurement} em ${date} foi ${status}.`,
    advice,
    link ? `Detalhes: ${link}` : '',
    'Em caso de emergência, ligue 192.',
  ].filter(Boolean).join('\n\n');

  const html = `<div style="font-family:Arial,sans-serif;font-size:16px;line-height:1.5;color:#1a1a1a">
<p>Olá, ${esc(name)}!</p>
<p>Sua medição de <strong>${esc(measurement)}</strong> em ${esc(date)} foi <strong>${esc(status)}</strong>.</p>
<p>${esc(advice)}</p>
${link ? `<p>Detalhes: <a href="${esc(link)}">${esc(link)}</a></p>` : ''}
<p><strong>Em caso de emergência, ligue 192.</strong></p>
</div>`;

  return { subject, text, html };
}

async function sendJob(job: Job) {
  // Identidade só é resolvida aqui, no servidor, no último momento.
  const { data: link } = await identity().from('patient_pseudonym').select('patient_id').eq('pseudo_id', job.pseudo_id).maybeSingle();
  if (!link) return fail(job, 'paciente não encontrado', true);

  const { data: consent } = await identity()
    .from('consents')
    .select('id')
    .eq('patient_id', link.patient_id)
    .eq('purpose', 'email_contact')
    .eq('granted', true)
    .is('revoked_at', null)
    .limit(1);
  if (!consent?.length) return fail(job, 'sem consentimento para e-mail', true);

  const { data: patient } = await identity().from('patients').select('full_name, email_enc').eq('id', link.patient_id).single();
  if (!patient) return fail(job, 'cadastro ausente', true);
  if (!patient.email_enc) return fail(job, 'paciente sem e-mail cadastrado', true);

  const { subject, text, html } = buildEmail(patient.full_name.split(' ')[0], job.variables);

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': job.id, // evita e-mail duplicado em caso de nova tentativa
    },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM,
      to: [decrypt(patient.email_enc)],
      subject,
      text,
      html,
    }),
  });
  const body = await res.json().catch(() => ({}));

  if (!res.ok) return fail(job, JSON.stringify(body).slice(0, 500));

  // A coluna wa_message_id guarda o id da mensagem do provedor (agora, o id do Resend).
  await messaging()
    .from('outbox')
    .update({ status: 'sent', wa_message_id: body.id ?? null, sent_at: new Date().toISOString(), error: null })
    .eq('id', job.id);
  await audit('system:send', 'email_send', job.pseudo_id);
}
