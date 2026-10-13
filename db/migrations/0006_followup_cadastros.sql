-- 0006: Follow-up — pacientes, consultas e modelos de acompanhamento (Etapa 8).
-- Planos gerados, etapas e histórico ficam na 0007.

-- ---------------------------------------------------------------------------
-- Pacientes (cadastro enxuto; nomes iguais são permitidos)
-- ---------------------------------------------------------------------------
create table public.fu_patients (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  name text not null,
  -- Normalizado em E.164 (+5511987654321) pelo servidor; opcional.
  phone text,
  notes text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fu_patients_name_check check (char_length(name) between 1 and 120 and name = btrim(name) and name !~ '[[:cntrl:]]'),
  constraint fu_patients_phone_check check (phone is null or phone ~ '^\+[1-9][0-9]{7,14}$'),
  constraint fu_patients_notes_check check (
    notes is null or (char_length(notes) between 1 and 1000 and notes = btrim(notes) and notes !~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]')
  ),
  constraint fu_patients_id_user_key unique (id, user_id)
);
create index fu_patients_user_name_idx on public.fu_patients (user_id, lower(name));
create trigger fu_patients_set_updated_at before update on public.fu_patients
  for each row execute function app_private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Consultas realizadas (várias por paciente; nunca sobrescritas no cadastro)
-- ---------------------------------------------------------------------------
create table public.fu_consultations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  patient_id uuid not null,
  consult_date date not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fu_consultations_date_check check (consult_date >= date '2000-01-01'),
  constraint fu_consultations_notes_check check (
    notes is null or (char_length(notes) between 1 and 2000 and notes = btrim(notes) and notes !~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]')
  ),
  constraint fu_consultations_id_user_key unique (id, user_id),
  constraint fu_consultations_id_patient_user_key unique (id, patient_id, user_id),
  -- Paciente do MESMO usuário; paciente com consultas não pode ser excluído.
  constraint fu_consultations_patient_fkey foreign key (patient_id, user_id) references public.fu_patients (id, user_id) on delete restrict
);
create index fu_consultations_patient_idx on public.fu_consultations (user_id, patient_id, consult_date desc);

-- Data civil de São Paulo; sem consultas futuras nesta versão. Paciente arquivado não recebe consulta nova.
create or replace function app_private.fu_consultations_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  archived timestamptz;
begin
  if new.consult_date > (now() at time zone 'America/Sao_Paulo')::date then
    raise exception 'fu_consult_future' using errcode = 'P0001';
  end if;
  if tg_op = 'INSERT' then
    select p.archived_at into archived from public.fu_patients p where p.id = new.patient_id and p.user_id = new.user_id for share;
    if found and archived is not null then
      raise exception 'fu_patient_archived' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function app_private.fu_consultations_guard() from public;
create trigger fu_consultations_guard before insert or update of consult_date on public.fu_consultations
  for each row execute function app_private.fu_consultations_guard();
create trigger fu_consultations_set_updated_at before update on public.fu_consultations
  for each row execute function app_private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Modelos de acompanhamento e suas etapas
-- ---------------------------------------------------------------------------
create table public.fu_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  name text not null,
  description text,
  -- Incrementada a cada edição; os planos guardam a versão copiada.
  version integer not null default 1,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fu_templates_name_check check (char_length(name) between 1 and 80 and name = btrim(name) and name !~ '[[:cntrl:]]'),
  constraint fu_templates_description_check check (
    description is null or (char_length(description) between 1 and 500 and description = btrim(description) and description !~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]')
  ),
  constraint fu_templates_version_check check (version >= 1),
  constraint fu_templates_id_user_key unique (id, user_id)
);
create unique index fu_templates_user_name_key on public.fu_templates (user_id, lower(name));
create trigger fu_templates_set_updated_at before update on public.fu_templates
  for each row execute function app_private.set_updated_at();

create table public.fu_template_steps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  template_id uuid not null,
  -- Dias corridos após a consulta (D0 = dia da consulta). Limite documentado: 3650 (10 anos).
  day_offset integer not null,
  message text not null,
  position smallint not null,
  created_at timestamptz not null default now(),
  constraint fu_template_steps_offset_check check (day_offset between 0 and 3650),
  constraint fu_template_steps_message_check check (
    char_length(message) between 1 and 2000 and message = btrim(message) and message !~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]'
  ),
  constraint fu_template_steps_position_check check (position between 0 and 99),
  -- Intervalos repetidos no mesmo modelo não são permitidos nesta versão.
  constraint fu_template_steps_offset_key unique (template_id, day_offset),
  constraint fu_template_steps_template_fkey foreign key (template_id, user_id) references public.fu_templates (id, user_id) on delete cascade
);
create index fu_template_steps_template_idx on public.fu_template_steps (template_id, position);

-- ---------------------------------------------------------------------------
-- RLS e permissões
-- ---------------------------------------------------------------------------
alter table public.fu_patients enable row level security;
alter table public.fu_patients force row level security;
alter table public.fu_consultations enable row level security;
alter table public.fu_consultations force row level security;
alter table public.fu_templates enable row level security;
alter table public.fu_templates force row level security;
alter table public.fu_template_steps enable row level security;
alter table public.fu_template_steps force row level security;

revoke all on table public.fu_patients, public.fu_consultations, public.fu_templates, public.fu_template_steps from public;

grant select, delete on table public.fu_patients to app_runtime;
grant insert (user_id, name, phone, notes) on table public.fu_patients to app_runtime;
grant update (name, phone, notes, archived_at) on table public.fu_patients to app_runtime;

-- Paciente da consulta é fixo (sem UPDATE em patient_id).
grant select, delete on table public.fu_consultations to app_runtime;
grant insert (user_id, patient_id, consult_date, notes) on table public.fu_consultations to app_runtime;
grant update (consult_date, notes) on table public.fu_consultations to app_runtime;

-- Modelos não são excluídos (arquivar); a origem dos planos continua rastreável.
grant select on table public.fu_templates to app_runtime;
grant insert (user_id, name, description) on table public.fu_templates to app_runtime;
grant update (name, description, version, archived_at) on table public.fu_templates to app_runtime;

-- Etapas do modelo: a edição substitui a lista inteira (excluir + inserir) numa transação.
grant select, delete on table public.fu_template_steps to app_runtime;
grant insert (user_id, template_id, day_offset, message, position) on table public.fu_template_steps to app_runtime;

do $$
declare
  t text;
begin
  foreach t in array array['fu_patients', 'fu_consultations', 'fu_templates', 'fu_template_steps'] loop
    execute format('create policy %1$s_select_own on public.%1$s for select to app_runtime using (user_id = app_private.current_user_id())', t);
    execute format('create policy %1$s_insert_own on public.%1$s for insert to app_runtime with check (user_id = app_private.current_user_id())', t);
    execute format('create policy %1$s_update_own on public.%1$s for update to app_runtime using (user_id = app_private.current_user_id()) with check (user_id = app_private.current_user_id())', t);
    execute format('create policy %1$s_delete_own on public.%1$s for delete to app_runtime using (user_id = app_private.current_user_id())', t);
  end loop;
end
$$;
