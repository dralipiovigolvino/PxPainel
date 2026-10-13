-- 0005: Cartões, faturas, compras e cobranças (Etapa 6).
-- Compras de cartão NÃO geram fin_entries: a obrigação a pagar é a fatura inteira.

-- ---------------------------------------------------------------------------
-- Cartões
-- ---------------------------------------------------------------------------
create table public.fin_cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  name text not null,
  -- Dias padrão; mudar não altera faturas existentes (cada fatura guarda suas datas).
  closing_day smallint not null,
  due_day smallint not null,
  notes text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fin_cards_name_check check (char_length(name) between 1 and 60 and name = btrim(name) and name !~ '[[:cntrl:]]'),
  constraint fin_cards_days_check check (closing_day between 1 and 31 and due_day between 1 and 31),
  constraint fin_cards_notes_check check (
    notes is null or (char_length(notes) between 1 and 1000 and notes = btrim(notes) and notes !~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]')
  ),
  constraint fin_cards_id_user_key unique (id, user_id)
);
create unique index fin_cards_user_name_key on public.fin_cards (user_id, lower(name));
create trigger fin_cards_set_updated_at before update on public.fin_cards
  for each row execute function app_private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Faturas (uma por cartão e ciclo)
-- ---------------------------------------------------------------------------
create table public.fin_invoices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  card_id uuid not null,
  -- Mês em que a fatura fecha (primeiro dia do mês).
  reference_month date not null,
  closing_date date not null,
  due_date date not null,
  status text not null default 'pendente',
  paid_on date,
  -- Total confirmado no pagamento (calculado pelo banco, sob bloqueio).
  paid_total_cents bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fin_invoices_reference_check check (extract(day from reference_month) = 1),
  constraint fin_invoices_dates_check check (
    closing_date between date '2000-01-01' and date '2100-12-31' and due_date between date '2000-01-01' and date '2101-12-31'
  ),
  constraint fin_invoices_status_check check (status in ('pendente', 'pago')),
  constraint fin_invoices_payment_check check (
    (status = 'pendente' and paid_on is null and paid_total_cents is null)
    or (status = 'pago' and paid_on is not null and paid_total_cents >= 1)
  ),
  constraint fin_invoices_cycle_key unique (card_id, reference_month),
  constraint fin_invoices_id_card_user_key unique (id, card_id, user_id),
  constraint fin_invoices_card_fkey foreign key (card_id, user_id) references public.fin_cards (id, user_id) on delete restrict
);
create index fin_invoices_user_due_idx on public.fin_invoices (user_id, due_date, id);
create trigger fin_invoices_set_updated_at before update on public.fin_invoices
  for each row execute function app_private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Compras e cobranças
-- ---------------------------------------------------------------------------
create table public.fin_card_purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  card_id uuid not null,
  area_id uuid not null,
  description text not null,
  category text,
  notes text,
  purchase_date date not null,
  total_cents bigint not null,
  installments_count smallint not null,
  request_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fin_purchases_description_check check (
    char_length(description) between 1 and 120 and description = btrim(description) and description !~ '[[:cntrl:]]'
  ),
  constraint fin_purchases_category_check check (
    category is null or (char_length(category) between 1 and 40 and category = btrim(category) and category !~ '[[:cntrl:]]')
  ),
  constraint fin_purchases_notes_check check (
    notes is null or (char_length(notes) between 1 and 1000 and notes = btrim(notes) and notes !~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]')
  ),
  constraint fin_purchases_count_check check (installments_count between 1 and 48),
  constraint fin_purchases_total_check check (total_cents between installments_count and 9999999999),
  constraint fin_purchases_date_check check (purchase_date between date '2000-01-01' and date '2100-12-31'),
  constraint fin_purchases_id_card_user_key unique (id, card_id, user_id),
  constraint fin_purchases_request_key unique (user_id, request_id),
  constraint fin_purchases_card_fkey foreign key (card_id, user_id) references public.fin_cards (id, user_id) on delete restrict,
  constraint fin_purchases_area_fkey foreign key (area_id, user_id) references public.fin_areas (id, user_id) on delete restrict
);
create index fin_purchases_user_card_idx on public.fin_card_purchases (user_id, card_id, purchase_date);
create trigger fin_purchases_set_updated_at before update on public.fin_card_purchases
  for each row execute function app_private.set_updated_at();
create trigger fin_purchases_check_area_active before insert or update of area_id on public.fin_card_purchases
  for each row execute function app_private.fin_entries_check_area_active();

create table public.fin_card_charges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  card_id uuid not null,
  purchase_id uuid not null,
  invoice_id uuid not null,
  installment_number smallint not null,
  amount_cents bigint not null,
  created_at timestamptz not null default now(),
  constraint fin_charges_amount_check check (amount_cents between 1 and 9999999999),
  constraint fin_charges_number_check check (installment_number between 1 and 48),
  constraint fin_charges_purchase_number_key unique (purchase_id, installment_number),
  -- Mesmo usuário E mesmo cartão da compra e da fatura (não dá para pôr cobrança em fatura de outro cartão).
  constraint fin_charges_purchase_fkey foreign key (purchase_id, card_id, user_id)
    references public.fin_card_purchases (id, card_id, user_id) on delete cascade,
  constraint fin_charges_invoice_fkey foreign key (invoice_id, card_id, user_id)
    references public.fin_invoices (id, card_id, user_id) on delete restrict
);
create index fin_charges_invoice_idx on public.fin_card_charges (invoice_id);
create index fin_charges_user_idx on public.fin_card_charges (user_id, card_id);

-- ---------------------------------------------------------------------------
-- Regras no banco
-- ---------------------------------------------------------------------------

-- Cartão arquivado não recebe compras novas (FOR SHARE: arquivar em paralelo espera).
create or replace function app_private.fin_purchases_check_card_active()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  archived timestamptz;
begin
  select c.archived_at into archived from public.fin_cards c where c.id = new.card_id and c.user_id = new.user_id for share;
  if found and archived is not null then
    raise exception 'fin_card_archived' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function app_private.fin_purchases_check_card_active() from public;
create trigger fin_purchases_check_card_active before insert on public.fin_card_purchases
  for each row execute function app_private.fin_purchases_check_card_active();

-- Fatura paga não recebe, perde nem troca cobranças. FOR SHARE na fatura serializa com o
-- pagamento (que faz UPDATE na mesma linha): quem chega depois vê o estado confirmado.
create or replace function app_private.fin_charges_invoice_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  st text;
begin
  if tg_op in ('INSERT', 'UPDATE') then
    select i.status into st from public.fin_invoices i where i.id = new.invoice_id for share;
    if st = 'pago' then
      raise exception 'fin_invoice_paid' using errcode = 'P0001';
    end if;
  end if;
  if tg_op in ('UPDATE', 'DELETE') then
    select i.status into st from public.fin_invoices i where i.id = old.invoice_id for share;
    if st = 'pago' then
      raise exception 'fin_invoice_paid' using errcode = 'P0001';
    end if;
  end if;
  return coalesce(new, old);
end;
$$;
revoke all on function app_private.fin_charges_invoice_guard() from public;
create trigger fin_charges_invoice_guard before insert or update or delete on public.fin_card_charges
  for each row execute function app_private.fin_charges_invoice_guard();

-- Pagamento: o total confirmado é calculado aqui (fonte de verdade), sob o bloqueio da linha.
-- Fatura vazia não pode ser paga. Fatura paga não muda de datas. Reabrir limpa o pagamento.
create or replace function app_private.fin_invoices_payment_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  total bigint;
begin
  if old.status = 'pago' and new.status = 'pago'
     and (new.closing_date is distinct from old.closing_date or new.due_date is distinct from old.due_date) then
    raise exception 'fin_invoice_paid' using errcode = 'P0001';
  end if;
  if new.status = 'pago' and old.status = 'pendente' then
    select coalesce(sum(c.amount_cents), 0) into total from public.fin_card_charges c where c.invoice_id = new.id;
    if total = 0 then
      raise exception 'fin_invoice_empty' using errcode = 'P0001';
    end if;
    new.paid_total_cents := total;
  elsif new.status = 'pendente' then
    new.paid_total_cents := null;
    new.paid_on := null;
  end if;
  return new;
end;
$$;
revoke all on function app_private.fin_invoices_payment_guard() from public;
create trigger fin_invoices_payment_guard before update on public.fin_invoices
  for each row execute function app_private.fin_invoices_payment_guard();

-- Eventos também para faturas, compras e cartões (já previstos no check de 0004).

-- ---------------------------------------------------------------------------
-- RLS e permissões
-- ---------------------------------------------------------------------------
alter table public.fin_cards enable row level security;
alter table public.fin_cards force row level security;
alter table public.fin_invoices enable row level security;
alter table public.fin_invoices force row level security;
alter table public.fin_card_purchases enable row level security;
alter table public.fin_card_purchases force row level security;
alter table public.fin_card_charges enable row level security;
alter table public.fin_card_charges force row level security;

revoke all on table public.fin_cards, public.fin_invoices, public.fin_card_purchases, public.fin_card_charges from public;

grant select, delete on table public.fin_cards to app_runtime;
grant insert (user_id, name, closing_day, due_day, notes) on table public.fin_cards to app_runtime;
grant update (name, closing_day, due_day, notes, archived_at) on table public.fin_cards to app_runtime;

grant select, delete on table public.fin_invoices to app_runtime;
grant insert (user_id, card_id, reference_month, closing_date, due_date) on table public.fin_invoices to app_runtime;
-- paid_total_cents é definido pelo gatilho; o app não escreve o total.
grant update (closing_date, due_date, status, paid_on) on table public.fin_invoices to app_runtime;

grant select, delete on table public.fin_card_purchases to app_runtime;
grant insert (user_id, card_id, area_id, description, category, notes, purchase_date, total_cents, installments_count, request_id)
  on table public.fin_card_purchases to app_runtime;
grant update (description, category, notes) on table public.fin_card_purchases to app_runtime;

-- Cobranças: criadas junto com a compra; sem UPDATE (valor, fatura e posição fixos).
grant select, delete on table public.fin_card_charges to app_runtime;
grant insert (user_id, card_id, purchase_id, invoice_id, installment_number, amount_cents) on table public.fin_card_charges to app_runtime;

do $$
declare
  t text;
begin
  foreach t in array array['fin_cards', 'fin_invoices', 'fin_card_purchases', 'fin_card_charges'] loop
    execute format('create policy %1$s_select_own on public.%1$s for select to app_runtime using (user_id = app_private.current_user_id())', t);
    execute format('create policy %1$s_insert_own on public.%1$s for insert to app_runtime with check (user_id = app_private.current_user_id())', t);
    execute format('create policy %1$s_update_own on public.%1$s for update to app_runtime using (user_id = app_private.current_user_id()) with check (user_id = app_private.current_user_id())', t);
    execute format('create policy %1$s_delete_own on public.%1$s for delete to app_runtime using (user_id = app_private.current_user_id())', t);
  end loop;
end
$$;
