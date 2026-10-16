import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { api } from '../lib/api';
import type { Patient } from '../App';
import { LABELS, SEVERITY_LABEL, TYPES, UNITS, type MeasurementType, type Severity } from '../../shared/interpret';

const SEVERITY_ICON: Record<Severity, string> = { normal: '✓', attention: '⚠', urgent: '⛔' };

interface Row { id: number; type: MeasurementType; value: number; unit: string; measured_at: string; context: string | null; source: string }

export default function PatientDetail({ patient }: { patient: Patient }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [sev, setSev] = useState<Record<number, Severity>>({});
  const [type, setType] = useState<MeasurementType>('heart_rate');
  const [value, setValue] = useState('');
  const [context, setContext] = useState('default');
  const [msg, setMsg] = useState<{ severity: Severity; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const h = supabase.schema('health');
    const [m, i] = await Promise.all([
      h.from('measurements').select('id,type,value,unit,measured_at,context,source')
        .eq('pseudo_id', patient.pseudo_id).order('measured_at', { ascending: false }).limit(100),
      h.from('interpretations').select('measurement_id,severity')
        .eq('pseudo_id', patient.pseudo_id).order('created_at', { ascending: false }).limit(100),
    ]);
    setRows((m.data as Row[]) ?? []);
    setSev(Object.fromEntries((i.data ?? []).map((x: any) => [x.measurement_id, x.severity])));
  }, [patient.pseudo_id]);
  useEffect(() => { load(); }, [load]);

  const latest = useMemo(
    () => TYPES.map((t) => rows.find((r) => r.type === t)),
    [rows],
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      const r = await api<{ severity: Severity; advice: string }>('ingest-measurement', {
        pseudo_id: patient.pseudo_id, type, value: Number(value.replace(',', '.')), context,
      });
      setMsg({ severity: r.severity, text: r.advice });
      setValue(''); load();
    } catch (err) {
      setMsg({ severity: 'urgent', text: (err as Error).message });
    } finally { setBusy(false); }
  }

  return (
    <section>
      <h2 className="name">{patient.name}</h2>

      <div className="latest">
        {TYPES.map((t, i) => {
          const r = latest[i];
          const s = r ? sev[r.id] : undefined;
          return (
            <div key={t} className={`reading ${s ?? 'none'}`}>
              <span className="muted">{LABELS[t]}</span>
              <strong>{r ? r.value : '—'}<small> {UNITS[t]}</small></strong>
              <span>{s ? SEVERITY_LABEL[s] : 'Sem medições'}</span>
            </div>
          );
        })}
      </div>

      <form onSubmit={submit} className="panel inline">
        <h3>Registrar medição</h3>
        <label>Tipo
          <select value={type} onChange={(e) => setType(e.target.value as MeasurementType)}>
            {TYPES.map((t) => <option key={t} value={t}>{LABELS[t]} ({UNITS[t]})</option>)}
          </select>
        </label>
        <label>Valor
          <input required inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
        </label>
        <label>Situação
          <select value={context} onChange={(e) => setContext(e.target.value)}>
            <option value="default">Não informada</option>
            <option value="rest">Em repouso</option>
            <option value="exercise">Após exercício</option>
            <option value="fasting">Em jejum</option>
            <option value="post_meal">Após refeição</option>
          </select>
        </label>
        <button className="primary" disabled={busy}>{busy ? 'Registrando…' : 'Registrar medição'}</button>
      </form>

      {msg && (
        <div role="status" className={`alert ${msg.severity}`}>
          <span className="alert-icon" aria-hidden="true">{SEVERITY_ICON[msg.severity]}</span>
          <div>
            <strong>{SEVERITY_LABEL[msg.severity]}</strong>
            <p>{msg.text}</p>
          </div>
        </div>
      )}

      <h3>Histórico</h3>
      <div className="tablewrap">
        <table>
          <thead><tr><th>Data</th><th>Medição</th><th>Valor</th><th>Situação</th><th>Origem</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{new Date(r.measured_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</td>
                <td>{LABELS[r.type]}</td>
                <td>{r.value} {r.unit}</td>
                <td><span className={`pill ${sev[r.id] ?? 'none'}`}>{sev[r.id] ? SEVERITY_LABEL[sev[r.id]] : '—'}</span></td>
                <td>{r.source === 'device' ? 'Dispositivo' : r.source === 'clinic' ? 'Clínica' : 'Manual'}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={5} className="muted">Nenhuma medição registrada.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}
