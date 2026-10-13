-- 0009: Plantões — recorrências (séries), exceções, movimentações (Etapa 11).
--
-- Regra semanal: dias da semana (máscara de bits, domingo = 1) a cada N semanas, contadas a partir da
-- semana (domingo) da data inicial — âncora estável, independente do mês exibido.
-- Ocorrência gerada: identidade (series_id, original_date), única e imutável; a data atual (shift_date)
-- pode ser movida sem que a original reapareça. Exclusão de ocorrência gera exceção persistente.

create table public.pl_series (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  type_id uuid not null,
  weekday_mask smallint not null,
  interval_weeks smallint not null,
  start_date date not null,
  end_date date,
  -- Valores copiados do tipo na criação (editáveis na série; ocorrências recebem cópia).
  amount_cents bigint not null,
  start_time time,
  end_time time,
  end_next_day boolean,
  notes text,
  generated_until date,
  suspended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pl_series_mask_check check (weekday_mask between 1 and 127),
  constraint pl_series_interval_check check (interval_weeks between 1 and 12),
  constraint pl_series_dates_check check (
    start_date between date '2000-01-01' and date '2100-12-31' and (end_date is null or (end_date >= start_date - 1 and end_date <= date '2100-12-31'))
  ),
  constraint pl_series_amount_check check (amount_cents between 1 and 9999999999),
  constraint pl_series_hours_check check (
    (start_time is null and end_time is null and end_next_day is null)
    or (start_time is not null and end_time is not null and end_next_day is not null
        and (end_next_day or end_time > start_time) and (not end_next_day or end_time <= start_time))
  ),
  constraint pl_series_notes_check check (
    notes is null or (char_length(notes) between 1 and 1000 and notes = btrim(notes) and notes !~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]')
  ),
  constraint pl_series_id_user_key unique (id, user_id),
  constraint pl_series_type_fkey foreign key (type_id, user_id) references public.pl_types (id, user_id) on delete restrict
);
create index pl_series_user_type_idx on public.pl_series (user_id, type_id);
create trigger pl_series_set_updated_at before update on public.pl_series
  for each row execute function app_private.set_updated_at();

-- Tipo arquivado não recebe série nova.
create or replace function app_private.pl_series_check_type_active()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  archived timestamptz;
begin
  select t.archived_at into archived from public.pl_types t where t.id = new.type_id and t.user_id = new.user_id for share;
  if found and archived is not null then
    raise exception 'pl_type_archived' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function app_private.pl_series_check_type_active() from public;
create trigger pl_series_check_type_active before insert on public.pl_series
  for each row execute function app_private.pl_series_check_type_active();

create table public.pl_series_exceptions (
  series_id uuid not null,
  user_id uuid not null,
  original_date date not null,
  created_at timestamptz not null default now(),
  primary key (series_id, original_date),
  constraint pl_series_exceptions_series_fkey foreign key (series_id, user_id) references public.pl_series (id, user_id) on delete cascade
);

-- Ocorrências ganham a identidade da série e a marcação de movida/alterada.
alter table public.pl_shifts add column series_id uuid;
alter table public.pl_shifts add column original_date date;
alter table public.pl_shifts add column is_override boolean not null default false;
alter table public.pl_shifts add column moved_at timestamptz;
alter table public.pl_shifts add constraint pl_shifts_series_fkey foreign key (series_id, user_id) references public.pl_series (id, user_id) on delete restrict;
alter table public.pl_shifts add constraint pl_shifts_series_occurrence_key unique (series_id, original_date);
alter table public.pl_shifts add constraint pl_shifts_series_check check ((series_id is null) = (original_date is null));
create index pl_shifts_series_idx on public.pl_shifts (series_id, original_date);

-- O instante da movimentação vem do servidor (quando a data muda). A data original é imutável.
create or replace function app_private.pl_shifts_move_stamp()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.shift_date is distinct from old.shift_date then
    new.moved_at := now();
  end if;
  if new.original_date is distinct from old.original_date then
    raise exception 'pl_shift_locked' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function app_private.pl_shifts_move_stamp() from public;
create trigger pl_shifts_move_stamp before update on public.pl_shifts
  for each row execute function app_private.pl_shifts_move_stamp();

-- ---------------------------------------------------------------------------
-- RLS e permissões
-- ---------------------------------------------------------------------------
alter table public.pl_series enable row level security;
alter table public.pl_series force row level security;
alter table public.pl_series_exceptions enable row level security;
alter table public.pl_series_exceptions force row level security;

revoke all on table public.pl_series, public.pl_series_exceptions from public;

-- Séries não são excluídas pelo app (encerrar/suspender); regra e início fixos (editar = dividir).
grant select on table public.pl_series to app_runtime;
grant insert (user_id, type_id, weekday_mask, interval_weeks, start_date, end_date, amount_cents, start_time, end_time, end_next_day, notes) on table public.pl_series to app_runtime;
grant update (end_date, generated_until, suspended_at) on table public.pl_series to app_runtime;

grant select, insert on table public.pl_series_exceptions to app_runtime;

-- Novas colunas das ocorrências: identidade só na inclusão; série pode ser reatribuída na divisão.
grant insert (series_id, original_date) on table public.pl_shifts to app_runtime;
grant update (series_id, is_override) on table public.pl_shifts to app_runtime;

do $$
declare
  t text;
begin
  foreach t in array array['pl_series', 'pl_series_exceptions'] loop
    execute format('create policy %1$s_select_own on public.%1$s for select to app_runtime using (user_id = app_private.current_user_id())', t);
    execute format('create policy %1$s_insert_own on public.%1$s for insert to app_runtime with check (user_id = app_private.current_user_id())', t);
  end loop;
  execute 'create policy pl_series_update_own on public.pl_series for update to app_runtime using (user_id = app_private.current_user_id()) with check (user_id = app_private.current_user_id())';
end
$$;
