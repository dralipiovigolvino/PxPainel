-- 0013: Plantões — valor bruto/líquido, alíquota estimada por registro e previsão de pagamento.
--
-- Classificação do valor: 'bruto' (com alíquota de imposto estimado gravada), 'liquido' (sem novo
-- desconto) ou NULL (registro anterior a esta migração: NÃO definido; nada é presumido).
-- Previsão de pagamento: regra do tipo "dia N do mês seguinte ao do INÍCIO do plantão", copiada para
-- a ocorrência (pay_day). A data prevista é mantida pelo banco enquanto não for ajustada manualmente.
-- A previsão nunca marca recebimento (received_on continua independente).

-- ---------------------------------------------------------------------------
-- Tipos: padrão de classificação e regra de pagamento
-- ---------------------------------------------------------------------------
alter table public.pl_types add column default_amount_kind text;
alter table public.pl_types add column pay_day smallint;
alter table public.pl_types add constraint pl_types_amount_kind_check check (default_amount_kind is null or default_amount_kind in ('bruto', 'liquido'));
alter table public.pl_types add constraint pl_types_pay_day_check check (pay_day is null or pay_day between 1 and 31);
grant insert (default_amount_kind, pay_day) on table public.pl_types to app_runtime;
grant update (default_amount_kind, pay_day) on table public.pl_types to app_runtime;

-- ---------------------------------------------------------------------------
-- Séries: cópia da classificação, da alíquota e da regra (as ocorrências geradas herdam)
-- ---------------------------------------------------------------------------
alter table public.pl_series add column amount_kind text;
alter table public.pl_series add column tax_rate_bp integer;
alter table public.pl_series add column pay_day smallint;
alter table public.pl_series add constraint pl_series_amount_kind_check check (amount_kind is null or amount_kind in ('bruto', 'liquido'));
alter table public.pl_series add constraint pl_series_tax_rate_check check (
  (tax_rate_bp is null or tax_rate_bp between 0 and 10000) and ((tax_rate_bp is null) = (amount_kind is distinct from 'bruto'))
);
alter table public.pl_series add constraint pl_series_pay_day_check check (pay_day is null or pay_day between 1 and 31);
grant insert (amount_kind, tax_rate_bp, pay_day) on table public.pl_series to app_runtime;
-- Atualizações explícitas (com prévia): alíquota dos futuros e regra de pagamento.
grant update (tax_rate_bp, pay_day) on table public.pl_series to app_runtime;

-- ---------------------------------------------------------------------------
-- Ocorrências
-- ---------------------------------------------------------------------------
alter table public.pl_shifts add column amount_kind text;
alter table public.pl_shifts add column tax_rate_bp integer;
alter table public.pl_shifts add column pay_day smallint;
alter table public.pl_shifts add column expected_pay_date date;
alter table public.pl_shifts add column expected_pay_manual boolean not null default false;
alter table public.pl_shifts add constraint pl_shifts_amount_kind_check check (amount_kind is null or amount_kind in ('bruto', 'liquido'));
alter table public.pl_shifts add constraint pl_shifts_tax_rate_check check (
  (tax_rate_bp is null or tax_rate_bp between 0 and 10000) and ((tax_rate_bp is null) = (amount_kind is distinct from 'bruto'))
);
alter table public.pl_shifts add constraint pl_shifts_pay_day_check check (pay_day is null or pay_day between 1 and 31);
alter table public.pl_shifts add constraint pl_shifts_expected_pay_check check (
  (not expected_pay_manual or expected_pay_date is not null)
  and (expected_pay_date is null or expected_pay_date between date '2000-01-01' and date '2101-12-31')
);
create index pl_shifts_user_expected_idx on public.pl_shifts (user_id, expected_pay_date) where expected_pay_date is not null and received_on is null;

-- Dia N do mês SEGUINTE ao da data; se o dia não existe nesse mês, o último dia dele.
create or replace function app_private.pl_expected_pay(d date, pay_day integer)
returns date
language sql
immutable
set search_path = ''
as $$
  select (date_trunc('month', d) + interval '1 month')::date
         + (least(pay_day, extract(day from (date_trunc('month', d) + interval '2 months' - interval '1 day'))::integer) - 1)
$$;
revoke all on function app_private.pl_expected_pay(date, integer) from public;
-- Chamada pelo gatilho abaixo, que roda com o papel de quem grava.
grant execute on function app_private.pl_expected_pay(date, integer) to app_runtime;

-- Mantém a previsão automática (inclusive ao mover o plantão ou trocar a regra da ocorrência);
-- previsão ajustada manualmente é preservada. Com recebimento registrado, classificação e alíquota
-- não mudam (desfazer o recebimento antes), como já acontece com o valor.
create or replace function app_private.pl_shifts_pay_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.received_on is not null and new.received_on is not null
     and (new.amount_kind is distinct from old.amount_kind or new.tax_rate_bp is distinct from old.tax_rate_bp) then
    raise exception 'pl_shift_received' using errcode = 'P0001';
  end if;
  if not new.expected_pay_manual then
    new.expected_pay_date := case when new.pay_day is null then null else app_private.pl_expected_pay(new.shift_date, new.pay_day) end;
  end if;
  return new;
end;
$$;
revoke all on function app_private.pl_shifts_pay_guard() from public;
create trigger pl_shifts_pay_guard before insert or update on public.pl_shifts
  for each row execute function app_private.pl_shifts_pay_guard();

grant insert (amount_kind, tax_rate_bp, pay_day, expected_pay_date, expected_pay_manual) on table public.pl_shifts to app_runtime;
grant update (amount_kind, tax_rate_bp, pay_day, expected_pay_date, expected_pay_manual) on table public.pl_shifts to app_runtime;
