-- Permite o consentimento 'email_contact' na tabela de consentimentos.
-- Sem isso, o cadastro de paciente falha com "Falha ao registrar consentimentos".
-- Rode no SQL Editor do Supabase. Pode rodar mais de uma vez.

alter table identity.consents drop constraint if exists consents_purpose_check;
alter table identity.consents
  add constraint consents_purpose_check
  check (purpose in ('monitoring','whatsapp_contact','email_contact','data_sharing'));
