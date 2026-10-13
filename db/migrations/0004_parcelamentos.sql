-- 0004: Parcelamentos fora do cartão (Etapa 5) + registro de eventos financeiros.

-- ---------------------------------------------------------------------------
-- Planos de parcelamento
-- ---------------------------------------------------------------------------
create table public.fin_installment_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  area_id uuid not null,
  description text not null,
  category text,
  notes text,
  -- Total e quantidade são fixos após a criação (sem grant de UPDATE).
  total_cents bigint not null,
  installments_count smallint not null,
  first_due_date date not null,
  -- Chave de idempotência do formulário: reenviar não cria outro plano.
  request_id uuid not null,
  canceled_at timestamptz,
  canceled_count integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint fin_plans_description_check check (
    char_length(description) between 1 and 120 and description = btrim(description) and description !~ '[[:cntrl:]]'
  ),
  constraint fin_plans_category_check check (
    category is null or (char_length(category) between 1 and 40 and category = btrim(category) and category !~ '[[:cntrl:]]')
  ),
  constraint fin_plans_notes_check check (
    notes is null or (char_length(notes) between 1 and 1000 and notes = btrim(notes) and notes !~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]')
  ),
  constraint fin_plans_count_check check (installments_count between 2 and 120),
  -- Nenhuma parcela pode ser zero: total >= quantidade (em centavos).
  constraint fin_plans_total_check check (total_cents between installments_count and 9999999999),
  constraint fin_plans_first_due_check check (first_due_date between date '2000-01-01' and date '2100-12-31'),
  constraint fin_plans_cancel_check check ((canceled_at is null) = (canceled_count is null)),
  constraint fin_plans_id_user_key unique (id, user_id),
  constraint fin_plans_request_key unique (user_id, request_id),
  constraint fin_plans_area_fkey foreign key (area_id, user_id) references public.fin_areas (id, user_id) on delete restrict
);

create trigger fin_plans_set_updated_at before update on public.fin_installment_plans
  for each row execute function app_private.set_updated_at();
create trigger fin_plans_check_area_active before insert on public.fin_installment_plans
  for each row execute function app_private.fin_entries_check_area_active();

-- ---------------------------------------------------------------------------
-- Parcelas em fin_entries + status "cancelado"
-- ---------------------------------------------------------------------------
alter table public.fin_entries
  add column installment_plan_id uuid,
  add column installment_number smallint;

alter table public.fin_entries
  add constraint fin_entries_plan_fkey foreign key (installment_plan_id, user_id)
    references public.fin_installment_plans (id, user_id) on delete restrict,
  add constraint fin_entries_installment_check check (
    (installment_plan_id is null) = (installment_number is null)
    and (installment_number is null or installment_number between 1 and 120)
    and not (installment_plan_id is not null and series_id is not null)
  ),
  add constraint fin_entries_plan_number_key unique (installment_plan_id, installment_number);

alter table public.fin_entries drop constraint fin_entries_status_check;
alter table public.fin_entries drop constraint fin_entries_payment_check;
alter table public.fin_entries
  add constraint fin_entries_status_check check (status in ('pendente', 'pago', 'cancelado')),
  add constraint fin_entries_payment_check check (
    (status in ('pendente', 'cancelado') and paid_on is null)
    or (status = 'pago' and paid_on is not null)
  ),
  -- Só parcelas podem ser canceladas (cancelamento de plano).
  add constraint fin_entries_cancel_check check (status <> 'cancelado' or installment_plan_id is not null);

create index fin_entries_user_plan_idx on public.fin_entries (user_id, installment_plan_id, installment_number);

-- Guardas das parcelas, aplicadas ao papel do app (a manutenção pelo dono do banco não passa por elas):
-- valor, área e posição fixos; vencimento só muda se pendente; cancelada é final; sem exclusão.
create or replace function app_private.fin_entries_installment_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user <> 'app_runtime' then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' then
    if old.installment_plan_id is not null then
      raise exception 'fin_installment_locked' using errcode = 'P0001', hint = 'Parcelas não são excluídas: cancele as pendentes do plano.';
    end if;
    return old;
  end if;
  if old.installment_plan_id is not null then
    if new.amount_cents is distinct from old.amount_cents
       or new.area_id is distinct from old.area_id
       or new.installment_plan_id is distinct from old.installment_plan_id
       or new.installment_number is distinct from old.installment_number then
      raise exception 'fin_installment_locked' using errcode = 'P0001', hint = 'Valor, área e número da parcela são fixos.';
    end if;
    if new.due_date is distinct from old.due_date and old.status <> 'pendente' then
      raise exception 'fin_installment_locked' using errcode = 'P0001', hint = 'Só parcela pendente pode mudar de vencimento.';
    end if;
    if old.status = 'cancelado' and new.status <> 'cancelado' then
      raise exception 'fin_installment_locked' using errcode = 'P0001', hint = 'Parcela cancelada não volta a valer.';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function app_private.fin_entries_installment_guard() from public;

create trigger fin_entries_installment_guard
  before update or delete on public.fin_entries
  for each row execute function app_private.fin_entries_installment_guard();

-- Consistência do plano ao fim da transação de criação: exatamente N parcelas somando o total.
create or replace function app_private.fin_plan_check_consistency()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  n integer;
  s bigint;
begin
  select count(*), coalesce(sum(e.amount_cents), 0) into n, s
    from public.fin_entries e where e.installment_plan_id = new.id;
  if n <> new.installments_count or s <> new.total_cents then
    raise exception 'fin_plan_inconsistent' using errcode = 'P0001', hint = 'A soma das parcelas difere do total do plano.';
  end if;
  return null;
end;
$$;
revoke all on function app_private.fin_plan_check_consistency() from public;

create constraint trigger fin_plans_consistency
  after insert on public.fin_installment_plans
  deferrable initially deferred
  for each row execute function app_private.fin_plan_check_consistency();

-- ---------------------------------------------------------------------------
-- Registro de eventos financeiros (auditoria; somente inserção)
-- ---------------------------------------------------------------------------
create table public.fin_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  entity_type text not null,
  entity_id uuid not null,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint fin_events_type_check check (entity_type in ('plano', 'fatura', 'compra', 'cartao')),
  constraint fin_events_action_check check (char_length(action) between 1 and 40)
);
create index fin_events_user_entity_idx on public.fin_events (user_id, entity_type, entity_id, created_at);

-- ---------------------------------------------------------------------------
-- RLS e permissões
-- ---------------------------------------------------------------------------
alter table public.fin_installment_plans enable row level security;
alter table public.fin_installment_plans force row level security;
alter table public.fin_events enable row level security;
alter table public.fin_events force row level security;

revoke all on table public.fin_installment_plans from public;
revoke all on table public.fin_events from public;

grant select on table public.fin_installment_plans to app_runtime;
grant insert (user_id, area_id, description, category, notes, total_cents, installments_count, first_due_date, request_id)
  on table public.fin_installment_plans to app_runtime;
-- Total, quantidade e datas fixos; só textos e o registro de cancelamento mudam.
grant update (description, category, notes, canceled_at, canceled_count) on table public.fin_installment_plans to app_runtime;

grant insert (installment_plan_id, installment_number) on table public.fin_entries to app_runtime;

grant select, insert (user_id, entity_type, entity_id, action, details) on table public.fin_events to app_runtime;

create policy fin_plans_select_own on public.fin_installment_plans
  for select to app_runtime using (user_id = app_private.current_user_id());
create policy fin_plans_insert_own on public.fin_installment_plans
  for insert to app_runtime with check (user_id = app_private.current_user_id());
create policy fin_plans_update_own on public.fin_installment_plans
  for update to app_runtime
  using (user_id = app_private.current_user_id())
  with check (user_id = app_private.current_user_id());

create policy fin_events_select_own on public.fin_events
  for select to app_runtime using (user_id = app_private.current_user_id());
create policy fin_events_insert_own on public.fin_events
  for insert to app_runtime with check (user_id = app_private.current_user_id());
