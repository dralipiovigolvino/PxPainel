-- 0003: Recorrências e contas variáveis (Etapa 4).
-- A regra fica em fin_series; as ocorrências concretas são linhas de fin_entries.

-- ---------------------------------------------------------------------------
-- Séries (regras de recorrência)
-- ---------------------------------------------------------------------------
create table public.fin_series (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  area_id uuid not null,
  description text not null,
  category text,
  notes text,
  amount_kind text not null,
  -- Fixo: valor obrigatório. Variável: sempre NULL (cada ocorrência recebe o seu valor).
  amount_cents bigint,
  frequency text not null,
  interval_months smallint not null default 1,
  -- Primeira data de vencimento: âncora do dia do mês / dia da semana.
  start_date date not null,
  -- Última data em que pode haver ocorrência (inclusive). NULL = sem fim.
  end_date date,
  -- Até que data (inclusive) as ocorrências já foram materializadas.
  generated_until date,
  -- Suspensa (ex.: área arquivada). Suspensas não geram ocorrências.
  suspended_at timestamptz,
  -- Quando o usuário encerrou a série explicitamente (registro histórico).
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint fin_series_description_check check (
    char_length(description) between 1 and 120 and description = btrim(description) and description !~ '[[:cntrl:]]'
  ),
  constraint fin_series_category_check check (
    category is null or (char_length(category) between 1 and 40 and category = btrim(category) and category !~ '[[:cntrl:]]')
  ),
  constraint fin_series_notes_check check (
    notes is null or (char_length(notes) between 1 and 1000 and notes = btrim(notes) and notes !~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]')
  ),
  constraint fin_series_amount_check check (
    (amount_kind = 'fixo' and amount_cents between 1 and 9999999999)
    or (amount_kind = 'variavel' and amount_cents is null)
  ),
  constraint fin_series_frequency_check check (frequency in ('semanal', 'quinzenal', 'mensal')),
  constraint fin_series_interval_check check (
    interval_months between 1 and 24 and (frequency = 'mensal' or interval_months = 1)
  ),
  constraint fin_series_dates_check check (
    start_date between date '2000-01-01' and date '2100-12-31'
    and (end_date is null or end_date between date '1999-12-31' and date '2100-12-31')
    and (generated_until is null or generated_until between date '1999-12-31' and date '2110-12-31')
  ),
  constraint fin_series_id_user_key unique (id, user_id),
  constraint fin_series_area_fkey foreign key (area_id, user_id)
    references public.fin_areas (id, user_id) on delete restrict
);

create index fin_series_user_idx on public.fin_series (user_id, area_id);

create trigger fin_series_set_updated_at
  before update on public.fin_series
  for each row execute function app_private.set_updated_at();

-- A mesma regra das contas: série nova (ou movida) não pode ir para área arquivada.
create trigger fin_series_check_area_active
  before insert or update of area_id on public.fin_series
  for each row execute function app_private.fin_entries_check_area_active();

-- ---------------------------------------------------------------------------
-- Exceções: ocorrências excluídas que não devem reaparecer
-- ---------------------------------------------------------------------------
create table public.fin_series_exceptions (
  series_id uuid not null,
  user_id uuid not null,
  occurrence_date date not null,
  created_at timestamptz not null default now(),
  primary key (series_id, occurrence_date),
  constraint fin_series_exceptions_series_fkey foreign key (series_id, user_id)
    references public.fin_series (id, user_id) on delete cascade
);

-- ---------------------------------------------------------------------------
-- Ocorrências em fin_entries
-- ---------------------------------------------------------------------------
alter table public.fin_entries
  add column series_id uuid,
  add column occurrence_date date,
  add column is_override boolean not null default false,
  add column is_variable boolean not null default false;

alter table public.fin_entries
  add constraint fin_entries_series_fkey foreign key (series_id, user_id)
    references public.fin_series (id, user_id) on delete restrict,
  -- Ocorrência = série + data original; conta única não tem nenhuma das duas.
  add constraint fin_entries_occurrence_check check ((series_id is null) = (occurrence_date is null)),
  add constraint fin_entries_variable_check check (not is_variable or series_id is not null),
  -- Identidade estável: uma ocorrência por série e data original (evita duplicação, inclusive concorrente).
  add constraint fin_entries_series_occurrence_key unique (series_id, occurrence_date);

-- Valor: NULL só para ocorrência variável pendente. Pago sempre exige valor válido.
alter table public.fin_entries drop constraint fin_entries_amount_check;
alter table public.fin_entries alter column amount_cents drop not null;
alter table public.fin_entries
  add constraint fin_entries_amount_check check (amount_cents is null or amount_cents between 1 and 9999999999),
  add constraint fin_entries_amount_required_check check (
    amount_cents is not null or (is_variable and status = 'pendente')
  );

create index fin_entries_user_series_idx on public.fin_entries (user_id, series_id, occurrence_date);

-- ---------------------------------------------------------------------------
-- RLS e permissões
-- ---------------------------------------------------------------------------
alter table public.fin_series enable row level security;
alter table public.fin_series force row level security;
alter table public.fin_series_exceptions enable row level security;
alter table public.fin_series_exceptions force row level security;

revoke all on table public.fin_series from public;
revoke all on table public.fin_series_exceptions from public;

grant select on table public.fin_series to app_runtime;
grant insert (user_id, area_id, description, category, notes, amount_kind, amount_cents, frequency, interval_months, start_date, end_date, generated_until)
  on table public.fin_series to app_runtime;
-- Regra (frequência, início, tipo de valor) NÃO muda: alterações futuras criam nova série.
grant update (description, category, notes, area_id, end_date, generated_until, suspended_at, ended_at)
  on table public.fin_series to app_runtime;

grant select, insert (series_id, user_id, occurrence_date) on table public.fin_series_exceptions to app_runtime;

-- Novas colunas de fin_entries. occurrence_date e is_variable são fixas após a criação.
grant insert (series_id, occurrence_date, is_override, is_variable) on table public.fin_entries to app_runtime;
grant update (series_id, is_override) on table public.fin_entries to app_runtime;

create policy fin_series_select_own on public.fin_series
  for select to app_runtime using (user_id = app_private.current_user_id());
create policy fin_series_insert_own on public.fin_series
  for insert to app_runtime with check (user_id = app_private.current_user_id());
create policy fin_series_update_own on public.fin_series
  for update to app_runtime
  using (user_id = app_private.current_user_id())
  with check (user_id = app_private.current_user_id());

create policy fin_series_exceptions_select_own on public.fin_series_exceptions
  for select to app_runtime using (user_id = app_private.current_user_id());
create policy fin_series_exceptions_insert_own on public.fin_series_exceptions
  for insert to app_runtime with check (user_id = app_private.current_user_id());
