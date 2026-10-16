import { audit, json, requireStaff } from './_lib/auth';
import { identity } from './_lib/db';

export default async (req: Request) => {
  const staff = await requireStaff(req);
  if (!staff) return json({ error: 'Não autorizado' }, 401);

  const { data, error } = await identity()
    .from('patients')
    .select('full_name, birth_date, patient_pseudonym(pseudo_id)')
    .order('full_name');
  if (error) return json({ error: 'Falha ao listar' }, 500);

  const patients = (data ?? []).map((p: any) => ({
    name: p.full_name,
    birth_date: p.birth_date,
    pseudo_id: Array.isArray(p.patient_pseudonym) ? p.patient_pseudonym[0]?.pseudo_id : p.patient_pseudonym?.pseudo_id,
  }));

  await audit(`staff:${staff.id}`, 'list_patients');
  return json(patients);
};
