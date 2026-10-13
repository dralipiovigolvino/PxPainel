-- 0012: Perícias — empresas, perícias e histórico.
-- O valor da perícia é sempre BRUTO e é copiado do padrão da empresa (alterar o padrão não muda
-- perícias existentes). Cada perícia guarda a alíquota de imposto estimado aplicada.
-- Situação (agendada/realizada/cancelada) e recebimento são independentes, como em Plantões.

-- ---------------------------------------------------------------------------
-- Empresas
-- ---------------------------------------------------------------------------
create table public.per_companies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  name text not null,
  default_amount_cents bigint not null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint per_companies_name_check check (char_length(name) between 1 and 80 and name = btrim(name) and name !~ '[[:cntrl:]]'),
  constraint per_companies_amount_check check (default_amount_cents between 1 and 9999999999),
  constraint per_companies_id_user_key unique (id, user_id)
);
create unique index per_companies_user_name_key on public.per_companies (user_id, lower(name));
create trigger per_companies_set_updated_at before update on public.per_companies
  for each row execute function app_private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Perícias
-- ---------------------------------------------------------------------------
create table public.per_exams (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  company_id uuid not null,
  exam_date date not null,
  exam_time time not null,
  -- Valor BRUTO desta perícia (cópia do padrão da empresa, ajustável) e alíquota estimada aplicada.
  amount_cents bigint not null,
  tax_rate_bp integer not null,
  notes text,
  status text not null default 'agendada',
  done_at timestamptz,
  canceled_at timestamptz,
  -- Recebimento: data em que o valor foi recebido (independente da realização).
  received_on date,
  request_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint per_exams_date_check check (exam_date between date '2000-01-01' and date '2100-12-31'),
  constraint per_exams_amount_check check (amount_cents between 1 and 9999999999),
  constraint per_exams_tax_rate_check check (tax_rate_bp between 0 and 10000),
  constraint per_exams_notes_check check (
    notes is null or (char_length(notes) between 1 and 1000 and notes = btrim(notes) and notes !~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]')
  ),
  constraint per_exams_status_check check (status in ('agendada', 'realizada', 'cancelada')),
  constraint per_exams_done_check check ((status = 'realizada') = (done_at is not null)),
  constraint per_exams_cancel_check check ((status = 'cancelada') = (canceled_at is not null)),
  constraint per_exams_receipt_check check (received_on is null or received_on >= date '2000-01-01'),
  constraint per_exams_canceled_receipt_check check (not (status = 'cancelada' and received_on is not null)),
  constraint per_exams_id_user_key unique (id, user_id),
  constraint per_exams_company_fkey foreign key (company_id, user_id) references public.per_companies (id, user_id) on delete restrict
);
create unique index per_exams_request_key on public.per_exams (user_id, request_id) where request_id is not null;
create index per_exams_user_date_idx on public.per_exams (user_id, exam_date, exam_time, id);
create index per_exams_user_company_idx on public.per_exams (user_id, company_id);
create trigger per_exams_set_updated_at before update on public.per_exams
  for each row execute function app_private.set_updated_at();

-- Regras (para o papel do app):
--  - empresa arquivada não recebe perícia nova;
--  - instantes de realização e cancelamento vêm do servidor;
--  - recebimento: data até hoje (São Paulo); cancelada não é recebida;
--  - recebida: valor e alíquota não mudam e não cancela (desfazer o recebimento antes);
--  - realizada → cancelada não é direto (desfazer a realização antes).
create or replace function app_private.per_exams_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  archived timestamptz;
begin
  if tg_op = 'INSERT' or new.company_id is distinct from old.company_id then
    select c.archived_at into archived from public.per_companies c where c.id = new.company_id and c.user_id = new.user_id for share;
    if found and archived is not null then
      raise exception 'per_company_archived' using errcode = 'P0001';
    end if;
  end if;
  if tg_op = 'UPDATE' then
    if old.received_on is not null and new.received_on is not null then
      if new.amount_cents is distinct from old.amount_cents or new.tax_rate_bp is distinct from old.tax_rate_bp
         or new.status = 'cancelada' or new.received_on is distinct from old.received_on then
        raise exception 'per_exam_received' using errcode = 'P0001';
      end if;
    end if;
    if old.status = 'realizada' and new.status = 'cancelada' then
      raise exception 'per_exam_locked' using errcode = 'P0001';
    end if;
  end if;
  if new.received_on is not null and (tg_op = 'INSERT' or old.received_on is null) then
    if new.received_on > (now() at time zone 'America/Sao_Paulo')::date then
      raise exception 'per_receipt_future' using errcode = 'P0001';
    end if;
    if new.status = 'cancelada' then
      raise exception 'per_exam_locked' using errcode = 'P0001';
    end if;
  end if;
  if new.status = 'realizada' and (tg_op = 'INSERT' or old.status <> 'realizada') then
    new.done_at := now();
  elsif new.status <> 'realizada' then
    new.done_at := null;
  end if;
  if new.status = 'cancelada' and (tg_op = 'INSERT' or old.status <> 'cancelada') then
    new.canceled_at := now();
  elsif new.status <> 'cancelada' then
    new.canceled_at := null;
  end if;
  return new;
end;
$$;
revoke all on function app_private.per_exams_guard() from public;
create trigger per_exams_guard before insert or update on public.per_exams
  for each row execute function app_private.per_exams_guard();

-- Realizadas e recebidas não são apagadas pelo app (cancelamento e correções explícitas).
create or replace function app_private.per_exams_delete_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user = 'app_runtime' and (old.status = 'realizada' or old.received_on is not null) then
    raise exception 'per_exam_locked' using errcode = 'P0001';
  end if;
  return old;
end;
$$;
revoke all on function app_private.per_exams_delete_guard() from public;
create trigger per_exams_delete_guard before delete on public.per_exams
  for each row execute function app_private.per_exams_delete_guard();

-- ---------------------------------------------------------------------------
-- Histórico (somente inclusão). Sobrevive à exclusão da perícia (exam_id vira nulo).
-- ---------------------------------------------------------------------------
create table public.per_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  exam_id uuid,
  company_id uuid,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint per_events_action_check check (action ~ '^[a-z_]{3,40}$'),
  constraint per_events_exam_fkey foreign key (exam_id, user_id) references public.per_exams (id, user_id) on delete set null (exam_id),
  constraint per_events_company_fkey foreign key (company_id, user_id) references public.per_companies (id, user_id) on delete cascade
);
create index per_events_exam_idx on public.per_events (user_id, exam_id, created_at);

-- ---------------------------------------------------------------------------
-- RLS e permissões
-- ---------------------------------------------------------------------------
alter table public.per_companies enable row level security;
alter table public.per_companies force row level security;
alter table public.per_exams enable row level security;
alter table public.per_exams force row level security;
alter table public.per_events enable row level security;
alter table public.per_events force row level security;

revoke all on table public.per_companies, public.per_exams, public.per_events from public;

grant select, delete on table public.per_companies to app_runtime;
grant insert (user_id, name, default_amount_cents) on table public.per_companies to app_runtime;
grant update (name, default_amount_cents, archived_at) on table public.per_companies to app_runtime;

-- Instantes de realização/cancelamento são do gatilho; user_id nunca muda.
grant select, delete on table public.per_exams to app_runtime;
grant insert (user_id, company_id, exam_date, exam_time, amount_cents, tax_rate_bp, notes, request_id) on table public.per_exams to app_runtime;
grant update (company_id, exam_date, exam_time, amount_cents, tax_rate_bp, notes, status, received_on) on table public.per_exams to app_runtime;

grant select on table public.per_events to app_runtime;
grant insert (user_id, exam_id, company_id, action, details) on table public.per_events to app_runtime;

do $$
declare
  t text;
begin
  foreach t in array array['per_companies', 'per_exams', 'per_events'] loop
    execute format('create policy %1$s_select_own on public.%1$s for select to app_runtime using (user_id = app_private.current_user_id())', t);
    execute format('create policy %1$s_insert_own on public.%1$s for insert to app_runtime with check (user_id = app_private.current_user_id())', t);
  end loop;
  foreach t in array array['per_companies', 'per_exams'] loop
    execute format('create policy %1$s_update_own on public.%1$s for update to app_runtime using (user_id = app_private.current_user_id()) with check (user_id = app_private.current_user_id())', t);
    execute format('create policy %1$s_delete_own on public.%1$s for delete to app_runtime using (user_id = app_private.current_user_id())', t);
  end loop;
end
$$;
