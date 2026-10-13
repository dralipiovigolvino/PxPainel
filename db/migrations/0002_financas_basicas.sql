-- 0002: Finanças básicas (Etapa 3) — áreas e lançamentos simples (despesas únicas).
-- Mesmo modelo de segurança da 0001: RLS forçada por app_private.current_user_id(),
-- grants mínimos por coluna para app_runtime, user_id imutável.

-- ---------------------------------------------------------------------------
-- Áreas financeiras
-- ---------------------------------------------------------------------------
create table public.fin_areas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  name text not null,
  -- Cor em hexadecimal minúsculo (#rrggbb); nada de CSS arbitrário.
  color text not null,
  -- NULL = ativa; preenchida = arquivada.
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint fin_areas_name_check check (
    char_length(name) between 1 and 60
    and name = btrim(name)
    and name !~ '[[:cntrl:]]'
  ),
  constraint fin_areas_color_check check (color ~ '^#[0-9a-f]{6}$'),
  -- Alvo da chave estrangeira composta dos lançamentos.
  constraint fin_areas_id_user_key unique (id, user_id)
);

-- Nome único por usuário, sem diferenciar maiúsculas (espaços nas pontas já são proibidos).
create unique index fin_areas_user_name_key on public.fin_areas (user_id, lower(name));

create trigger fin_areas_set_updated_at
  before update on public.fin_areas
  for each row execute function app_private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Lançamentos (contas únicas)
-- ---------------------------------------------------------------------------
create table public.fin_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  area_id uuid not null,
  description text not null,
  -- Centavos inteiros: de R$ 0,01 a R$ 99.999.999,99 (mesmo limite do app).
  amount_cents bigint not null,
  -- Datas civis (sem horário).
  due_date date not null,
  category text,
  notes text,
  status text not null default 'pendente',
  paid_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint fin_entries_description_check check (
    char_length(description) between 1 and 120
    and description = btrim(description)
    and description !~ '[[:cntrl:]]'
  ),
  constraint fin_entries_amount_check check (amount_cents between 1 and 9999999999),
  constraint fin_entries_due_date_check check (due_date between date '2000-01-01' and date '2100-12-31'),
  constraint fin_entries_category_check check (
    category is null
    or (char_length(category) between 1 and 40 and category = btrim(category) and category !~ '[[:cntrl:]]')
  ),
  -- Observação: permite quebra de linha e tabulação, nenhum outro caractere de controle.
  constraint fin_entries_notes_check check (
    notes is null
    or (char_length(notes) between 1 and 1000 and notes = btrim(notes) and notes !~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]')
  ),
  constraint fin_entries_status_check check (status in ('pendente', 'pago')),
  -- Pendente nunca tem data de pagamento; pago sempre tem.
  constraint fin_entries_payment_check check (
    (status = 'pendente' and paid_on is null)
    or (status = 'pago' and paid_on is not null)
  ),
  constraint fin_entries_paid_on_check check (paid_on is null or paid_on between date '2000-01-01' and date '2100-12-31'),
  -- A área precisa ser do MESMO usuário. RESTRICT: excluir uma área com lançamentos falha
  -- (inclusive sob concorrência), e nunca apaga contas em cascata.
  constraint fin_entries_area_fkey foreign key (area_id, user_id)
    references public.fin_areas (id, user_id) on delete restrict
);

-- Consulta principal: por usuário e mês de vencimento (+ área), ordenada por vencimento.
create index fin_entries_user_due_idx on public.fin_entries (user_id, due_date, id);
create index fin_entries_user_area_due_idx on public.fin_entries (user_id, area_id, due_date);

create trigger fin_entries_set_updated_at
  before update on public.fin_entries
  for each row execute function app_private.set_updated_at();

-- Área arquivada não recebe lançamentos novos nem lançamentos movidos de outra área.
-- Manter um lançamento na área em que já está (mesmo arquivada) é permitido.
-- FOR SHARE trava a linha da área: arquivar em paralelo espera esta transação terminar.
create or replace function app_private.fin_entries_check_area_active()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  area_archived timestamptz;
begin
  if tg_op = 'UPDATE' and new.area_id = old.area_id then
    return new;
  end if;
  select a.archived_at into area_archived
    from public.fin_areas a
    where a.id = new.area_id and a.user_id = new.user_id
    for share;
  if found and area_archived is not null then
    raise exception 'fin_area_archived' using errcode = 'P0001', hint = 'A área está arquivada.';
  end if;
  -- Área inexistente/de outro usuário: a chave estrangeira composta recusa.
  return new;
end;
$$;
revoke all on function app_private.fin_entries_check_area_active() from public;

create trigger fin_entries_check_area_active
  before insert or update of area_id on public.fin_entries
  for each row execute function app_private.fin_entries_check_area_active();

-- ---------------------------------------------------------------------------
-- RLS e permissões mínimas
-- ---------------------------------------------------------------------------
alter table public.fin_areas enable row level security;
alter table public.fin_areas force row level security;
alter table public.fin_entries enable row level security;
alter table public.fin_entries force row level security;

revoke all on table public.fin_areas from public;
revoke all on table public.fin_entries from public;

grant select, delete on table public.fin_areas to app_runtime;
grant insert (user_id, name, color) on table public.fin_areas to app_runtime;
grant update (name, color, archived_at) on table public.fin_areas to app_runtime;

grant select, delete on table public.fin_entries to app_runtime;
grant insert (user_id, area_id, description, amount_cents, due_date, category, notes, status, paid_on)
  on table public.fin_entries to app_runtime;
-- Sem UPDATE de user_id: a propriedade nunca muda.
grant update (area_id, description, amount_cents, due_date, category, notes, status, paid_on)
  on table public.fin_entries to app_runtime;

create policy fin_areas_select_own on public.fin_areas
  for select to app_runtime using (user_id = app_private.current_user_id());
create policy fin_areas_insert_own on public.fin_areas
  for insert to app_runtime with check (user_id = app_private.current_user_id());
create policy fin_areas_update_own on public.fin_areas
  for update to app_runtime
  using (user_id = app_private.current_user_id())
  with check (user_id = app_private.current_user_id());
create policy fin_areas_delete_own on public.fin_areas
  for delete to app_runtime using (user_id = app_private.current_user_id());

create policy fin_entries_select_own on public.fin_entries
  for select to app_runtime using (user_id = app_private.current_user_id());
create policy fin_entries_insert_own on public.fin_entries
  for insert to app_runtime with check (user_id = app_private.current_user_id());
create policy fin_entries_update_own on public.fin_entries
  for update to app_runtime
  using (user_id = app_private.current_user_id())
  with check (user_id = app_private.current_user_id());
create policy fin_entries_delete_own on public.fin_entries
  for delete to app_runtime using (user_id = app_private.current_user_id());
