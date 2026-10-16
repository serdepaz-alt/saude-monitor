import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './lib/supabase';
import Login from './pages/Login';
import Patients from './pages/Patients';
import PatientDetail from './pages/PatientDetail';

export interface Patient { name: string; birth_date: string; pseudo_id: string }

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [selected, setSelected] = useState<Patient | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true); });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (!ready) return null;
  if (!session) return <Login />;

  return (
    <div className="shell">
      <aside className="side">
        <header className="side-head">
          <h1>Monitor de Saúde</h1>
          <button className="link" onClick={() => supabase.auth.signOut()}>Sair</button>
        </header>
        <Patients selected={selected?.pseudo_id ?? null} onSelect={setSelected} />
      </aside>
      <main className="main">
        {selected ? (
          <PatientDetail key={selected.pseudo_id} patient={selected} />
        ) : (
          <div className="empty">
            <h2>Selecione um paciente</h2>
            <p>Escolha alguém na lista ao lado para ver as medições e registrar uma nova leitura.</p>
          </div>
        )}
        <footer className="note">
          Apoio à decisão. Não substitui avaliação clínica. Em emergência, ligue 192 (SAMU).
        </footer>
      </main>
    </div>
  );
}
