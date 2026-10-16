import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { Patient } from '../App';

interface Props { selected: string | null; onSelect: (p: Patient) => void }

const empty = { full_name: '', cpf: '', birth_date: '', phone: '', consent_monitoring: false, consent_whatsapp: false };

export default function Patients({ selected, onSelect }: Props) {
  const [list, setList] = useState<Patient[]>([]);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(empty);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api<Patient[]>('list-patients').then(setList).catch((e) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      await api('create-patient', form);
      setForm(empty); setAdding(false); load();
    } catch (err) {
      setError((err as Error).message);
    } finally { setBusy(false); }
  }

  const set = (k: keyof typeof empty) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  return (
    <div className="patients">
      <div className="row">
        <h2>Pacientes</h2>
        <button className="link" onClick={() => setAdding(!adding)}>{adding ? 'Cancelar' : 'Novo paciente'}</button>
      </div>

      {adding && (
        <form onSubmit={create} className="panel compact">
          <label>Nome completo<input required value={form.full_name} onChange={set('full_name')} /></label>
          <label>CPF<input required inputMode="numeric" value={form.cpf} onChange={set('cpf')} /></label>
          <label>Data de nascimento<input required type="date" value={form.birth_date} onChange={set('birth_date')} /></label>
          <label>WhatsApp (com DDD)<input required inputMode="tel" value={form.phone} onChange={set('phone')} /></label>
          <label className="check"><input type="checkbox" checked={form.consent_monitoring} onChange={set('consent_monitoring')} />
            O paciente autorizou o monitoramento da sua saúde</label>
          <label className="check"><input type="checkbox" checked={form.consent_whatsapp} onChange={set('consent_whatsapp')} />
            O paciente autorizou receber resultados por WhatsApp</label>
          <button className="primary" disabled={busy}>{busy ? 'Salvando…' : 'Cadastrar paciente'}</button>
        </form>
      )}

      {error && <p role="alert" className="error">{error}</p>}

      <ul className="plist">
        {list.map((p) => (
          <li key={p.pseudo_id}>
            <button className={p.pseudo_id === selected ? 'active' : ''} onClick={() => onSelect(p)}>
              {p.name}
            </button>
          </li>
        ))}
        {!list.length && !error && <li className="muted">Nenhum paciente cadastrado ainda.</li>}
      </ul>
    </div>
  );
}
