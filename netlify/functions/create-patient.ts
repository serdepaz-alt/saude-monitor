import { audit, json, requireStaff } from './_lib/auth';
import { blindIndex, encrypt } from './_lib/crypto';
import { identity } from './_lib/db';

function validCpf(c: string) {
  if (!/^\d{11}$/.test(c) || /^(\d)\1+$/.test(c)) return false;
  const dv = (n: number) => {
    let s = 0;
    for (let i = 0; i < n; i++) s += Number(c[i]) * (n + 1 - i);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(c[9]) && dv(10) === Number(c[10]);
}

export default async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'Método não permitido' }, 405);
  const staff = await requireStaff(req);
  if (!staff || staff.role === 'viewer') return json({ error: 'Não autorizado' }, 401);

  const b = await req.json().catch(() => null);
  if (!b) return json({ error: 'JSON inválido' }, 400);

  const cpf = String(b.cpf ?? '').replace(/\D/g, '');
  const email = String(b.email ?? '').trim().toLowerCase();

  // Telefone agora é opcional (só informativo); o contato é por e-mail.
  let phone = String(b.phone ?? '').replace(/\D/g, '');
  if (phone) {
    if (phone.length <= 11) phone = '55' + phone; // assume Brasil
    phone = '+' + phone;
  }

  if (String(b.full_name ?? '').trim().length < 3) return json({ error: 'Informe o nome completo' }, 400);
  if (!validCpf(cpf)) return json({ error: 'CPF inválido' }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 254) return json({ error: 'E-mail inválido' }, 400);
  if (phone && !/^\+55\d{10,11}$/.test(phone)) return json({ error: 'Telefone inválido. Use DDD + número' }, 400);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.birth_date ?? '')) return json({ error: 'Data de nascimento inválida' }, 400);
  if (!b.consent_monitoring) return json({ error: 'O consentimento para monitoramento é obrigatório' }, 400);

  const { data: p, error } = await identity().from('patients').insert({
    full_name: String(b.full_name).trim(),
    cpf_enc: encrypt(cpf), cpf_hash: blindIndex(cpf),
    email_enc: encrypt(email), email_hash: blindIndex(email),
    phone_enc: phone ? encrypt(phone) : null, phone_hash: phone ? blindIndex(phone) : null,
    birth_date: b.birth_date,
  }).select('id').single();

  if (error?.code === '23505') return json({ error: 'Já existe paciente com este CPF' }, 409);
  if (error || !p) return json({ error: 'Falha ao cadastrar' }, 500);

  const { data: link, error: e2 } = await identity().from('patient_pseudonym').insert({ patient_id: p.id }).select('pseudo_id').single();
  const evidence = `staff:${staff.id}; termo v1; ${new Date().toISOString()}`;
  const consents = [{ patient_id: p.id, purpose: 'monitoring', evidence }];
  if (b.consent_email) consents.push({ patient_id: p.id, purpose: 'email_contact', evidence });
  const { error: e3 } = await identity().from('consents').insert(consents);

  if (e2 || e3 || !link) {
    await identity().from('patients').delete().eq('id', p.id); // desfaz (cascade)
    return json({ error: 'Falha ao registrar consentimentos' }, 500);
  }

  await audit(`staff:${staff.id}`, 'create_patient', link.pseudo_id);
  return json({ pseudo_id: link.pseudo_id }, 201);
};
