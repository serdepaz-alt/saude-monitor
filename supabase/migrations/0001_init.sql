-- Monitor de Saúde: esquema inicial
create extension if not exists pgcrypto;

create schema if not exists identity;
create schema if not exists health;
create schema if not exists messaging;

-- ===== Equipe (acesso ao painel) =====
create table public.staff (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role    text not null check (role in ('clinician','admin','viewer'))
);
alter table public.staff enable row level security;
create policy staff_self on public.staff for select to authenticated using (user_id = auth.uid());

create or replace function public.is_staff() returns boolean
language sql security definer set search_path = '' stable as $$
  select exists (select 1 from public.staff where user_id = auth.uid())
$$;

-- ===== IDENTIDADE (dados pessoais; campos sensíveis cifrados na aplicação com AES-256-GCM) =====
create table identity.patients (
  id          uuid primary key default gen_random_uuid(),
  full_name   text not null,
  cpf_enc     text not null,
  cpf_hash    text unique not null,      -- HMAC: busca/duplicidade sem decifrar
  birth_date  date not null,
  phone_enc   text not null,             -- E.164, ex.: +5571999999999
  phone_hash  text not null,
  email       text,
  created_at  timestamptz not null default now()
);
create index on identity.patients (phone_hash);

-- Única ponte entre identidade e saúde
create table identity.patient_pseudonym (
  patient_id uuid primary key references identity.patients(id) on delete cascade,
  pseudo_id  uuid unique not null default gen_random_uuid()
);

create table identity.consents (
  id          uuid primary key default gen_random_uuid(),
  patient_id  uuid not null references identity.patients(id) on delete cascade,
  purpose     text not null check (purpose in ('monitoring','whatsapp_contact','data_sharing')),
  granted     boolean not null default true,
  granted_at  timestamptz not null default now(),
  revoked_at  timestamptz,
  evidence    text
);
create index on identity.consents (patient_id, purpose);

-- ===== SAÚDE (somente pseudo_id; sem nome, CPF ou telefone) =====
create table health.measurements (
  id          bigint generated always as identity primary key,
  pseudo_id   uuid not null,
  type        text not null check (type in ('heart_rate','spo2','glucose','weight')),
  value       numeric(6,1) not null,
  unit        text not null,
  context     text,
  measured_at timestamptz not null,
  source      text not null check (source in ('device','manual','clinic')),
  device_id   text,
  created_at  timestamptz not null default now()
);
create index on health.measurements (pseudo_id, type, measured_at desc);

create table health.reference_ranges (
  pseudo_id uuid not null,
  type      text not null,
  context   text not null default 'default',
  warn_low  numeric, warn_high numeric,
  crit_low  numeric, crit_high numeric,
  set_by    text not null,
  updated_at timestamptz not null default now(),
  primary key (pseudo_id, type, context)
);

create table health.interpretations (
  id             bigint generated always as identity primary key,
  measurement_id bigint not null references health.measurements(id) on delete cascade,
  pseudo_id      uuid not null,
  severity       text not null check (severity in ('normal','attention','urgent')),
  message_key    text not null,
  reviewed_by    text,
  created_at     timestamptz not null default now()
);
create index on health.interpretations (pseudo_id, created_at desc);

-- ===== MENSAGERIA =====
create table messaging.outbox (
  id            uuid primary key default gen_random_uuid(),
  pseudo_id     uuid not null,
  template_name text not null,
  variables     jsonb not null,          -- sem dados pessoais; o nome é resolvido no envio
  status        text not null default 'pending'
                check (status in ('pending','sending','sent','delivered','read','failed')),
  wa_message_id text unique,
  attempts      int not null default 0,
  error         text,
  scheduled_for timestamptz not null default now(),
  sent_at       timestamptz
);
create index on messaging.outbox (status, scheduled_for);

create table messaging.audit_log (
  id        bigint generated always as identity primary key,
  actor     text not null,
  action    text not null,
  pseudo_id uuid,
  at        timestamptz not null default now()
);

-- ===== RLS =====
alter table identity.patients          enable row level security;
alter table identity.patient_pseudonym enable row level security;
alter table identity.consents          enable row level security;
alter table health.measurements        enable row level security;
alter table health.reference_ranges    enable row level security;
alter table health.interpretations     enable row level security;
alter table messaging.outbox           enable row level security;
alter table messaging.audit_log        enable row level security;

-- Identidade e mensageria: nenhuma policy => inacessíveis a anon/authenticated.
-- Só a service_role (functions no servidor) acessa.
revoke all on schema identity, messaging from anon, authenticated;

grant usage on schema identity, health, messaging to service_role;
grant all on all tables    in schema identity, health, messaging to service_role;
grant all on all sequences in schema identity, health, messaging to service_role;

-- Saúde: leitura apenas para equipe autenticada
grant usage on schema health to authenticated;
grant select on health.measurements, health.interpretations, health.reference_ranges to authenticated;

create policy staff_read_measurements   on health.measurements    for select to authenticated using (public.is_staff());
create policy staff_read_interpretations on health.interpretations for select to authenticated using (public.is_staff());
create policy staff_read_ranges          on health.reference_ranges for select to authenticated using (public.is_staff());

-- Dica: dê acesso à equipe com
--   insert into public.staff (user_id, role) values ('<uuid do usuário em auth.users>', 'clinician');
