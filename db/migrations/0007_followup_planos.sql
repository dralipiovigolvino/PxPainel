-- 0007: Follow-up — planos de acompanhamento gerados, etapas e histórico (Etapa 9).
-- Um plano por consulta; etapas COPIADAS do modelo (editar/arquivar o modelo não muda planos).

-- Registrar consulta é idempotente por formulário (duplo envio não cria duas consultas).
alter table public.fu_consultations add column request_id uuid;
create unique index fu_consultations_request_key on public.fu_consultations (user_id, request_id) where request_id is not null;
grant insert (request_id) on table public.fu_consultations to app_runtime;

-- ---------------------------------------------------------------------------
-- Planos (um por consulta)
-- ---------------------------------------------------------------------------
create table public.fu_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  patient_id uuid not null,
  consultation_id uuid not null,
  -- Origem (rastreável) + cópia do nome e da versão aplicados.
  template_id uuid,
  template_name text not null,
  template_version integer not null,
  request_id uuid not null,
  status text not null default 'ativo',
  canceled_at timestamptz,
  cancel_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fu_plans_status_check check (status in ('ativo', 'cancelado')),
  constraint fu_plans_cancel_check check (
    (status = 'ativo' and canceled_at is null and cancel_reason is null) or (status = 'cancelado' and canceled_at is not null)
  ),
  constraint fu_plans_reason_check check (
    cancel_reason is null or (char_length(cancel_reason) between 1 and 300 and cancel_reason = btrim(cancel_reason) and cancel_reason !~ '[[:cntrl:]]')
  ),
  constraint fu_plans_template_name_check check (char_length(template_name) between 1 and 80),
  constraint fu_plans_template_version_check check (template_version >= 1),
  constraint fu_plans_consultation_key unique (consultation_id),
  constraint fu_plans_request_key unique (user_id, request_id),
  constraint fu_plans_id_user_key unique (id, user_id),
  -- Consulta E paciente do mesmo usuário (o paciente do plano é o da consulta).
  constraint fu_plans_consultation_fkey foreign key (consultation_id, patient_id, user_id)
    references public.fu_consultations (id, patient_id, user_id) on delete restrict,
  constraint fu_plans_template_fkey foreign key (template_id, user_id) references public.fu_templates (id, user_id) on delete restrict
);
create index fu_plans_patient_idx on public.fu_plans (user_id, patient_id);
create trigger fu_plans_set_updated_at before update on public.fu_plans
  for each row execute function app_private.set_updated_at();

-- Cancelado é final; o instante do cancelamento é do servidor.
create or replace function app_private.fu_plans_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'cancelado' then
    raise exception 'fu_plan_canceled' using errcode = 'P0001';
  end if;
  if new.status = 'cancelado' then
    new.canceled_at := now();
  end if;
  return new;
end;
$$;
revoke all on function app_private.fu_plans_guard() from public;
create trigger fu_plans_guard before update on public.fu_plans
  for each row execute function app_private.fu_plans_guard();

-- ---------------------------------------------------------------------------
-- Etapas geradas
-- ---------------------------------------------------------------------------
create table public.fu_steps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  plan_id uuid not null,
  -- Intervalo ORIGINAL (o rótulo "D7" continua mesmo se a etapa for remarcada).
  day_offset integer not null,
  -- Cópia do texto do modelo (com variáveis) e ajuste opcional só desta etapa.
  message text not null,
  custom_message text,
  -- Data calculada (consulta + intervalo) e data prevista atual (difere quando remarcada).
  original_date date not null,
  due_date date not null,
  rescheduled_at timestamptz,
  status text not null default 'pendente',
  done_at timestamptz,
  -- Texto renderizado no momento da realização (registro; não comprova envio).
  done_text text,
  note text,
  canceled_at timestamptz,
  cancel_kind text,
  cancel_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fu_steps_offset_check check (day_offset between 0 and 3650),
  constraint fu_steps_message_check check (
    char_length(message) between 1 and 2000 and message !~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]'
  ),
  constraint fu_steps_custom_check check (
    custom_message is null or (char_length(custom_message) between 1 and 2000 and custom_message !~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]')
  ),
  constraint fu_steps_dates_check check (
    original_date between date '2000-01-01' and date '2100-12-31' and due_date between date '2000-01-01' and date '2100-12-31'
  ),
  constraint fu_steps_status_check check (status in ('pendente', 'realizado', 'cancelado')),
  constraint fu_steps_state_check check (
    (status = 'pendente' and done_at is null and done_text is null and canceled_at is null and cancel_kind is null and cancel_reason is null)
    or (status = 'realizado' and done_at is not null and done_text is not null and canceled_at is null and cancel_kind is null)
    or (status = 'cancelado' and canceled_at is not null and cancel_kind in ('cancelado', 'substituido') and done_at is null)
  ),
  constraint fu_steps_done_text_check check (done_text is null or char_length(done_text) between 1 and 4000),
  constraint fu_steps_note_check check (
    note is null or (char_length(note) between 1 and 1000 and note = btrim(note) and note !~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]')
  ),
  constraint fu_steps_reason_check check (
    cancel_reason is null or (char_length(cancel_reason) between 1 and 300 and cancel_reason = btrim(cancel_reason) and cancel_reason !~ '[[:cntrl:]]')
  ),
  constraint fu_steps_id_user_key unique (id, user_id),
  constraint fu_steps_plan_fkey foreign key (plan_id, user_id) references public.fu_plans (id, user_id) on delete cascade
);
-- Sem duas etapas vivas com o mesmo intervalo no plano (canceladas/substituídas ficam no histórico).
create unique index fu_steps_plan_offset_key on public.fu_steps (plan_id, day_offset) where status <> 'cancelado';
create index fu_steps_user_status_due_idx on public.fu_steps (user_id, status, due_date, id);
create index fu_steps_plan_idx on public.fu_steps (plan_id, day_offset);
create trigger fu_steps_set_updated_at before update on public.fu_steps
  for each row execute function app_private.set_updated_at();

-- Transições permitidas (para o papel do app):
--   pendente → realizado | cancelado; pendente pode mudar data, ajuste de texto e observação;
--   realizado → pendente (desfazer, limpa a realização) ou só observação;
--   cancelado é final; plano cancelado não recebe etapas nem mudanças.
-- Instantes (realização/cancelamento) vêm do servidor.
create or replace function app_private.fu_steps_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  plan_status text;
begin
  select p.status into plan_status from public.fu_plans p where p.id = new.plan_id for share;
  if tg_op = 'INSERT' then
    if plan_status = 'cancelado' then
      raise exception 'fu_plan_canceled' using errcode = 'P0001';
    end if;
    return new;
  end if;
  if old.status = 'cancelado' then
    raise exception 'fu_step_locked' using errcode = 'P0001';
  end if;
  -- Cancelar o plano cancela as pendentes na mesma transação (plano já cancelado + etapa → cancelado).
  if plan_status = 'cancelado' and not (old.status = 'pendente' and new.status = 'cancelado') then
    raise exception 'fu_plan_canceled' using errcode = 'P0001';
  end if;
  if old.status = 'realizado' then
    if new.status = 'pendente' then
      new.done_at := null;
      new.done_text := null;
      return new;
    end if;
    if new.status <> 'realizado' or new.due_date is distinct from old.due_date or new.original_date is distinct from old.original_date
       or new.custom_message is distinct from old.custom_message or new.done_text is distinct from old.done_text then
      raise exception 'fu_step_locked' using errcode = 'P0001';
    end if;
    return new;
  end if;
  -- old.status = 'pendente'
  if new.status = 'realizado' then
    new.done_at := now();
  elsif new.status = 'cancelado' then
    new.canceled_at := now();
  end if;
  return new;
end;
$$;
revoke all on function app_private.fu_steps_guard() from public;
create trigger fu_steps_guard before insert or update on public.fu_steps
  for each row execute function app_private.fu_steps_guard();

-- ---------------------------------------------------------------------------
-- Histórico de ações (somente inclusão). Pertence ao paciente; detalhes sem segredos.
-- ---------------------------------------------------------------------------
create table public.fu_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  patient_id uuid not null,
  consultation_id uuid,
  plan_id uuid,
  step_id uuid,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint fu_events_action_check check (action in (
    'plano_criado', 'plano_substituido', 'plano_cancelado', 'consulta_data_corrigida',
    'etapa_realizada', 'etapa_desfeita', 'etapa_remarcada', 'etapa_cancelada',
    'mensagem_ajustada', 'mensagem_copiada', 'observacao_registrada'
  )),
  constraint fu_events_patient_fkey foreign key (patient_id, user_id) references public.fu_patients (id, user_id) on delete cascade,
  -- Vínculos opcionais, sempre do mesmo usuário (MATCH SIMPLE: nulos não são conferidos).
  constraint fu_events_consultation_fkey foreign key (consultation_id, user_id) references public.fu_consultations (id, user_id) on delete cascade,
  constraint fu_events_plan_fkey foreign key (plan_id, user_id) references public.fu_plans (id, user_id) on delete cascade,
  constraint fu_events_step_fkey foreign key (step_id, user_id) references public.fu_steps (id, user_id) on delete cascade
);
create index fu_events_patient_idx on public.fu_events (user_id, patient_id, created_at);

-- ---------------------------------------------------------------------------
-- RLS e permissões
-- ---------------------------------------------------------------------------
alter table public.fu_plans enable row level security;
alter table public.fu_plans force row level security;
alter table public.fu_steps enable row level security;
alter table public.fu_steps force row level security;
alter table public.fu_events enable row level security;
alter table public.fu_events force row level security;

revoke all on table public.fu_plans, public.fu_steps, public.fu_events from public;

-- Planos e etapas não são excluídos pelo app (cancelados ficam no histórico).
grant select on table public.fu_plans to app_runtime;
grant insert (user_id, patient_id, consultation_id, template_id, template_name, template_version, request_id) on table public.fu_plans to app_runtime;
grant update (status, cancel_reason, template_id, template_name, template_version) on table public.fu_plans to app_runtime;

grant select on table public.fu_steps to app_runtime;
grant insert (user_id, plan_id, day_offset, message, original_date, due_date) on table public.fu_steps to app_runtime;
grant update (due_date, original_date, rescheduled_at, custom_message, status, done_text, note, cancel_kind, cancel_reason) on table public.fu_steps to app_runtime;

grant select on table public.fu_events to app_runtime;
grant insert (user_id, patient_id, consultation_id, plan_id, step_id, action, details) on table public.fu_events to app_runtime;

do $$
declare
  t text;
begin
  foreach t in array array['fu_plans', 'fu_steps', 'fu_events'] loop
    execute format('create policy %1$s_select_own on public.%1$s for select to app_runtime using (user_id = app_private.current_user_id())', t);
    execute format('create policy %1$s_insert_own on public.%1$s for insert to app_runtime with check (user_id = app_private.current_user_id())', t);
  end loop;
  foreach t in array array['fu_plans', 'fu_steps'] loop
    execute format('create policy %1$s_update_own on public.%1$s for update to app_runtime using (user_id = app_private.current_user_id()) with check (user_id = app_private.current_user_id())', t);
  end loop;
end
$$;
