-- 0015: Follow-up — duração do acompanhamento, aviso de término e próxima consulta agendada.
--
-- Duração (em dias a partir da consulta, D0) e antecedência do aviso ficam no MODELO e são COPIADAS
-- para o plano ao gerar: alterar o modelo depois não muda planos existentes. Planos antigos ficam sem
-- duração (NULL) até o usuário defini-la explicitamente.
-- O fim do prazo é só um indicador: não realiza, cancela nem esconde etapas.
-- Próxima consulta agendada é um compromisso FUTURO: não é consulta realizada e não gera acompanhamento.

-- ---------------------------------------------------------------------------
-- Modelos e planos: duração e aviso
-- ---------------------------------------------------------------------------
alter table public.fu_templates add column duration_days integer;
alter table public.fu_templates add column notice_days integer;
alter table public.fu_templates add constraint fu_templates_duration_check check (
  (duration_days is null and notice_days is null)
  or (duration_days between 1 and 3650 and notice_days between 0 and duration_days)
);
grant insert (duration_days, notice_days) on table public.fu_templates to app_runtime;
grant update (duration_days, notice_days) on table public.fu_templates to app_runtime;

alter table public.fu_plans add column duration_days integer;
alter table public.fu_plans add column notice_days integer;
alter table public.fu_plans add constraint fu_plans_duration_check check (
  (duration_days is null and notice_days is null)
  or (duration_days between 1 and 3650 and notice_days between 0 and duration_days)
);
grant insert (duration_days, notice_days) on table public.fu_plans to app_runtime;
grant update (duration_days, notice_days) on table public.fu_plans to app_runtime;

-- ---------------------------------------------------------------------------
-- Próxima consulta agendada
-- ---------------------------------------------------------------------------
create table public.fu_appointments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  patient_id uuid not null,
  -- Acompanhamento de origem (o que estava em curso quando a consulta foi agendada), se houver.
  plan_id uuid,
  scheduled_date date not null,
  scheduled_time time,
  status text not null default 'agendada',
  canceled_at timestamptz,
  confirmed_at timestamptz,
  -- Consulta registrada na confirmação do atendimento.
  consultation_id uuid,
  request_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fu_appointments_date_check check (scheduled_date between date '2000-01-01' and date '2100-12-31'),
  constraint fu_appointments_status_check check (status in ('agendada', 'realizada', 'cancelada')),
  constraint fu_appointments_state_check check (
    (status = 'agendada' and canceled_at is null and confirmed_at is null)
    or (status = 'realizada' and confirmed_at is not null and canceled_at is null)
    or (status = 'cancelada' and canceled_at is not null and confirmed_at is null)
  ),
  constraint fu_appointments_id_user_key unique (id, user_id),
  constraint fu_appointments_patient_fkey foreign key (patient_id, user_id) references public.fu_patients (id, user_id) on delete cascade,
  constraint fu_appointments_plan_fkey foreign key (plan_id, user_id) references public.fu_plans (id, user_id) on delete set null (plan_id),
  constraint fu_appointments_consultation_fkey foreign key (consultation_id, patient_id, user_id)
    references public.fu_consultations (id, patient_id, user_id) on delete set null (consultation_id)
);
-- Uma única próxima consulta em aberto por paciente (reagendar altera a mesma).
create unique index fu_appointments_patient_open_key on public.fu_appointments (patient_id) where status = 'agendada';
create unique index fu_appointments_request_key on public.fu_appointments (user_id, request_id) where request_id is not null;
create index fu_appointments_user_date_idx on public.fu_appointments (user_id, status, scheduled_date);
create trigger fu_appointments_set_updated_at before update on public.fu_appointments
  for each row execute function app_private.set_updated_at();

-- Paciente arquivado não recebe agendamento novo; realizada e cancelada são finais;
-- instantes de cancelamento e confirmação vêm do servidor.
create or replace function app_private.fu_appointments_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  archived timestamptz;
begin
  if tg_op = 'INSERT' then
    select p.archived_at into archived from public.fu_patients p where p.id = new.patient_id and p.user_id = new.user_id for share;
    if found and archived is not null then
      raise exception 'fu_patient_archived' using errcode = 'P0001';
    end if;
    new.canceled_at := null;
    new.confirmed_at := null;
    new.status := 'agendada';
    return new;
  end if;
  if old.status <> 'agendada' then
    -- Só o vínculo com a consulta pode ser desfeito (pela exclusão da consulta).
    if new.status is distinct from old.status or new.scheduled_date is distinct from old.scheduled_date
       or new.scheduled_time is distinct from old.scheduled_time then
      raise exception 'fu_appointment_closed' using errcode = 'P0001';
    end if;
    return new;
  end if;
  if new.status = 'cancelada' then
    new.canceled_at := now();
  elsif new.status = 'realizada' then
    new.confirmed_at := now();
  end if;
  return new;
end;
$$;
revoke all on function app_private.fu_appointments_guard() from public;
create trigger fu_appointments_guard before insert or update on public.fu_appointments
  for each row execute function app_private.fu_appointments_guard();

alter table public.fu_appointments enable row level security;
alter table public.fu_appointments force row level security;
revoke all on table public.fu_appointments from public;

-- Sem DELETE: cancelar mantém o registro. Paciente, plano de origem e instantes não são alteráveis.
grant select on table public.fu_appointments to app_runtime;
grant insert (user_id, patient_id, plan_id, scheduled_date, scheduled_time, request_id) on table public.fu_appointments to app_runtime;
grant update (scheduled_date, scheduled_time, status, consultation_id) on table public.fu_appointments to app_runtime;

create policy fu_appointments_select_own on public.fu_appointments for select to app_runtime using (user_id = app_private.current_user_id());
create policy fu_appointments_insert_own on public.fu_appointments for insert to app_runtime with check (user_id = app_private.current_user_id());
create policy fu_appointments_update_own on public.fu_appointments for update to app_runtime
  using (user_id = app_private.current_user_id()) with check (user_id = app_private.current_user_id());

-- ---------------------------------------------------------------------------
-- Histórico: novas ações
-- ---------------------------------------------------------------------------
alter table public.fu_events drop constraint fu_events_action_check;
alter table public.fu_events add constraint fu_events_action_check check (action in (
  'plano_criado', 'plano_substituido', 'plano_cancelado', 'consulta_data_corrigida',
  'etapa_realizada', 'etapa_desfeita', 'etapa_remarcada', 'etapa_cancelada',
  'mensagem_ajustada', 'mensagem_copiada', 'observacao_registrada',
  'prazo_definido', 'proxima_consulta_agendada', 'proxima_consulta_reagendada',
  'proxima_consulta_cancelada', 'proxima_consulta_confirmada'
));
