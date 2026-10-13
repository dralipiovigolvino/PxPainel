-- 0008: Plantões — tipos, ocorrências avulsas e histórico (Etapa 10).
-- Séries (0009) e realização/recebimento (0010) vêm depois.

-- Horários: ambos vazios OU início + fim + "termina no dia seguinte".
-- No mesmo dia, fim > início. No dia seguinte, fim <= início (até 24 h; 07:00→07:00 = 24 h).

-- ---------------------------------------------------------------------------
-- Tipos de plantão
-- ---------------------------------------------------------------------------
create table public.pl_types (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  name text not null,
  location text,
  default_amount_cents bigint not null,
  color text not null,
  default_start time,
  default_end time,
  default_end_next_day boolean,
  default_notes text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pl_types_name_check check (char_length(name) between 1 and 60 and name = btrim(name) and name !~ '[[:cntrl:]]'),
  constraint pl_types_location_check check (
    location is null or (char_length(location) between 1 and 120 and location = btrim(location) and location !~ '[[:cntrl:]]')
  ),
  constraint pl_types_amount_check check (default_amount_cents between 1 and 9999999999),
  constraint pl_types_color_check check (color ~ '^#[0-9a-f]{6}$'),
  constraint pl_types_hours_check check (
    (default_start is null and default_end is null and default_end_next_day is null)
    or (default_start is not null and default_end is not null and default_end_next_day is not null
        and (default_end_next_day or default_end > default_start) and (not default_end_next_day or default_end <= default_start))
  ),
  constraint pl_types_notes_check check (
    default_notes is null or (char_length(default_notes) between 1 and 1000 and default_notes = btrim(default_notes) and default_notes !~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]')
  ),
  constraint pl_types_id_user_key unique (id, user_id)
);
create unique index pl_types_user_name_key on public.pl_types (user_id, lower(name));
create trigger pl_types_set_updated_at before update on public.pl_types
  for each row execute function app_private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Ocorrências (cada plantão no calendário). Valor, horários e observação são COPIADOS do tipo.
-- ---------------------------------------------------------------------------
create table public.pl_shifts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  type_id uuid not null,
  -- Dia em que o plantão COMEÇA (atravessar a meia-noite não duplica a ocorrência).
  shift_date date not null,
  start_time time,
  end_time time,
  end_next_day boolean,
  amount_cents bigint not null,
  notes text,
  status text not null default 'agendado',
  canceled_at timestamptz,
  request_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pl_shifts_date_check check (shift_date between date '2000-01-01' and date '2100-12-31'),
  constraint pl_shifts_amount_check check (amount_cents between 1 and 9999999999),
  constraint pl_shifts_hours_check check (
    (start_time is null and end_time is null and end_next_day is null)
    or (start_time is not null and end_time is not null and end_next_day is not null
        and (end_next_day or end_time > start_time) and (not end_next_day or end_time <= start_time))
  ),
  constraint pl_shifts_notes_check check (
    notes is null or (char_length(notes) between 1 and 1000 and notes = btrim(notes) and notes !~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]')
  ),
  constraint pl_shifts_status_check check (status in ('agendado', 'cancelado')),
  constraint pl_shifts_cancel_check check ((status = 'cancelado') = (canceled_at is not null)),
  constraint pl_shifts_id_user_key unique (id, user_id),
  constraint pl_shifts_type_fkey foreign key (type_id, user_id) references public.pl_types (id, user_id) on delete restrict
);
create unique index pl_shifts_request_key on public.pl_shifts (user_id, request_id) where request_id is not null;
create index pl_shifts_user_date_idx on public.pl_shifts (user_id, shift_date, id);
create index pl_shifts_user_type_idx on public.pl_shifts (user_id, type_id);
create trigger pl_shifts_set_updated_at before update on public.pl_shifts
  for each row execute function app_private.set_updated_at();

-- Tipo arquivado não recebe plantão novo; o instante do cancelamento vem do servidor.
create or replace function app_private.pl_shifts_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  archived timestamptz;
begin
  if tg_op = 'INSERT' then
    select t.archived_at into archived from public.pl_types t where t.id = new.type_id and t.user_id = new.user_id for share;
    if found and archived is not null then
      raise exception 'pl_type_archived' using errcode = 'P0001';
    end if;
  end if;
  if new.status = 'cancelado' and (tg_op = 'INSERT' or old.status <> 'cancelado') then
    new.canceled_at := now();
  elsif new.status <> 'cancelado' then
    new.canceled_at := null;
  end if;
  return new;
end;
$$;
revoke all on function app_private.pl_shifts_guard() from public;
create trigger pl_shifts_guard before insert or update on public.pl_shifts
  for each row execute function app_private.pl_shifts_guard();

-- ---------------------------------------------------------------------------
-- Histórico (somente inclusão). Sobrevive à exclusão da ocorrência (shift_id vira nulo).
-- ---------------------------------------------------------------------------
create table public.pl_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  shift_id uuid,
  type_id uuid,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint pl_events_action_check check (action ~ '^[a-z_]{3,40}$'),
  constraint pl_events_shift_fkey foreign key (shift_id, user_id) references public.pl_shifts (id, user_id) on delete set null (shift_id),
  constraint pl_events_type_fkey foreign key (type_id, user_id) references public.pl_types (id, user_id) on delete cascade
);
create index pl_events_shift_idx on public.pl_events (user_id, shift_id, created_at);

-- ---------------------------------------------------------------------------
-- RLS e permissões
-- ---------------------------------------------------------------------------
alter table public.pl_types enable row level security;
alter table public.pl_types force row level security;
alter table public.pl_shifts enable row level security;
alter table public.pl_shifts force row level security;
alter table public.pl_events enable row level security;
alter table public.pl_events force row level security;

revoke all on table public.pl_types, public.pl_shifts, public.pl_events from public;

grant select, delete on table public.pl_types to app_runtime;
grant insert (user_id, name, location, default_amount_cents, color, default_start, default_end, default_end_next_day, default_notes) on table public.pl_types to app_runtime;
grant update (name, location, default_amount_cents, color, default_start, default_end, default_end_next_day, default_notes, archived_at) on table public.pl_types to app_runtime;

-- Tipo da ocorrência é fixo (sem UPDATE em type_id); instante de cancelamento é do gatilho.
grant select, delete on table public.pl_shifts to app_runtime;
grant insert (user_id, type_id, shift_date, start_time, end_time, end_next_day, amount_cents, notes, request_id) on table public.pl_shifts to app_runtime;
grant update (shift_date, start_time, end_time, end_next_day, amount_cents, notes, status) on table public.pl_shifts to app_runtime;

grant select on table public.pl_events to app_runtime;
grant insert (user_id, shift_id, type_id, action, details) on table public.pl_events to app_runtime;

do $$
declare
  t text;
begin
  foreach t in array array['pl_types', 'pl_shifts', 'pl_events'] loop
    execute format('create policy %1$s_select_own on public.%1$s for select to app_runtime using (user_id = app_private.current_user_id())', t);
    execute format('create policy %1$s_insert_own on public.%1$s for insert to app_runtime with check (user_id = app_private.current_user_id())', t);
  end loop;
  foreach t in array array['pl_types', 'pl_shifts'] loop
    execute format('create policy %1$s_update_own on public.%1$s for update to app_runtime using (user_id = app_private.current_user_id()) with check (user_id = app_private.current_user_id())', t);
    execute format('create policy %1$s_delete_own on public.%1$s for delete to app_runtime using (user_id = app_private.current_user_id())', t);
  end loop;
end
$$;
