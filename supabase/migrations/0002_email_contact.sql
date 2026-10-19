-- Troca do canal de contato: WhatsApp -> e-mail (Resend).
-- Rode no SQL Editor do Supabase. Pode rodar mais de uma vez.

-- E-mail do paciente: cifrado na aplicação (AES-256-GCM) + índice cego, como CPF e telefone.
alter table identity.patients add column if not exists email_enc text;
alter table identity.patients add column if not exists email_hash text;
create index if not exists patients_email_hash_idx on identity.patients (email_hash);

-- Telefone passa a ser opcional.
alter table identity.patients alter column phone_enc drop not null;
alter table identity.patients alter column phone_hash drop not null;

-- Pacientes que já consentiram contato por WhatsApp continuam sem e-mail até cadastrarem um.
-- Se a tabela consents tiver um CHECK limitando "purpose", inclua 'email_contact' nele, por exemplo:
--   alter table identity.consents drop constraint consents_purpose_check;
--   alter table identity.consents add constraint consents_purpose_check
--     check (purpose in ('monitoring','whatsapp_contact','email_contact'));
