# Monitor de Saúde

Monitoramento de frequência cardíaca, saturação, glicemia e peso, com dados pessoais separados dos registros clínicos e envio individual de resultados por WhatsApp.

React + Vite (Netlify) · Netlify Functions · Supabase (Postgres) · WhatsApp Cloud API

## Como a privacidade funciona

- `identity.*`: nome, CPF e telefone. CPF e telefone são **cifrados na aplicação (AES-256-GCM)**; a chave fica só nas variáveis do Netlify.
- `health.*`: medições e interpretações referenciam apenas `pseudo_id`. Nada identifica a pessoa.
- Só as functions (com `service_role`) cruzam `pseudo_id → paciente`, e cada acesso vai para `messaging.audit_log`.
- O navegador (chave `anon`) só lê `health.*`, e apenas se o usuário estiver em `public.staff`.

## Passo a passo

### 1. Supabase
1. Crie o projeto (região `South America (São Paulo)`).
2. Rode `supabase/migrations/0001_init.sql` no SQL Editor (ou use o workflow `db-migrate`).
3. **Project Settings → API → Exposed schemas**: adicione `health`, `identity` e `messaging`.
4. Crie um usuário em *Authentication → Users* e libere o acesso:
   ```sql
   insert into public.staff (user_id, role) values ('<UUID DO USUÁRIO>', 'clinician');
   ```

### 2. Chaves
```bash
openssl rand -base64 32   # DATA_ENC_KEY
openssl rand -base64 32   # HASH_KEY
openssl rand -hex 24      # INGEST_API_KEY e WA_VERIFY_TOKEN
```
**Guarde `DATA_ENC_KEY` em um cofre.** Sem ela, CPF e telefone não podem ser recuperados.

### 3. WhatsApp (Meta for Developers)
1. Crie um app *Business* e ative *WhatsApp*. Anote `WA_PHONE_ID`, `WA_TOKEN` (use token permanente de usuário do sistema) e `WA_APP_SECRET`.
2. Cadastre o template **`resultado_medicao`** (categoria *Utility*, idioma `pt_BR`):
   ```
   Olá, {{1}}! Sua medição de {{2}} em {{3}} foi {{4}}.
   {{5}}
   Detalhes: {{6}}
   Em caso de emergência, ligue 192.
   ```
3. Webhook: `https://SEU-SITE.netlify.app/.netlify/functions/whatsapp-webhook`, com o `WA_VERIFY_TOKEN`; assine o campo `messages`.

### 4. GitHub e Netlify
```bash
git init && git add . && git commit -m "feat: projeto inicial"
git branch -M main
git remote add origin git@github.com:SEU_USUARIO/saude-monitor.git   # repositório PRIVADO
git push -u origin main
```
No Netlify: *Add new site → Import from Git*. Em *Environment variables*, cadastre todas as chaves de `.env.example`.

### 5. Desenvolvimento local
```bash
cp .env.example .env   # preencha
npm install
npm run dev            # netlify dev: front + functions
npm test
```

## Enviando medições de dispositivos
```bash
curl -X POST https://SEU-SITE.netlify.app/.netlify/functions/ingest-measurement \
  -H "x-api-key: $INGEST_API_KEY" -H "content-type: application/json" \
  -d '{"pseudo_id":"<uuid>","type":"spo2","value":93,"context":"rest"}'
```
Tipos: `heart_rate`, `spo2`, `glucose`. Normal: sem envio. Atenção: mensagem na fila (próximo ciclo de 5 min). Urgente: envio imediato.

## Peso: um caso à parte
Diferente dos outros três parâmetros, peso não tem uma faixa fixa de "normal". A classificação compara a nova pesagem com a anterior do mesmo paciente: variação de 3% ou mais vira atenção, e de 6% ou mais vira urgente (ver `WEIGHT_CHANGE_THRESHOLDS` em `shared/interpret.ts`). A primeira pesagem de um paciente é sempre normal, pois ainda não há o que comparar.

## Faixas individuais por paciente
Sem faixa cadastrada, o sistema usa os padrões de `shared/interpret.ts`. Para personalizar (vale para frequência cardíaca, saturação e glicemia; peso usa a regra de variação acima):
```sql
insert into health.reference_ranges (pseudo_id, type, warn_low, warn_high, crit_low, crit_high, set_by)
values ('<uuid>', 'glucose', 80, 160, 60, 250, 'dra.fulana')
on conflict (pseudo_id, type, context) do update
  set warn_low=excluded.warn_low, warn_high=excluded.warn_high,
      crit_low=excluded.crit_low, crit_high=excluded.crit_high, updated_at=now();
```

## Antes de usar com pacientes reais
- **Revisão clínica** de todos os limites e textos (`shared/interpret.ts`). Os valores atuais são exemplos.
- **LGPD**: base legal para dados de saúde, RIPD, encarregado (DPO), política de retenção e fluxo de exclusão.
- **MFA** para a equipe (Supabase Auth) e perfis de acesso revisados.
- Fallback (SMS/ligação) para alertas urgentes com falha de entrega (veja `messaging.outbox.status = 'failed'`).
- Backups cifrados e plano de rotação de chaves.

## Próximos passos sugeridos
Tela de faixas individuais, resumo diário/semanal para leituras normais, análise de tendência (leituras sucessivas), painel de alertas urgentes e fila de respostas dos pacientes.
