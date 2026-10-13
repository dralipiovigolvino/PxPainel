-- 0021: abreviação obrigatória dos CNPJs e mês da previsão de pagamento dos plantões.
-- Dados existentes preservam a regra anterior: pagamento no mês seguinte (offset 1).

alter table public.cnpjs add column abbreviation text;
update public.cnpjs set abbreviation = left(name, 20);
alter table public.cnpjs alter column abbreviation set not null;
alter table public.cnpjs add constraint cnpjs_abbreviation_check check (
  char_length(abbreviation) between 1 and 20
  and abbreviation = btrim(abbreviation)
  and abbreviation !~ '[[:cntrl:]]'
);
grant insert (abbreviation), update (abbreviation) on table public.cnpjs to app_runtime;

alter table public.pl_types add column pay_month_offset smallint not null default 1;
alter table public.pl_series add column pay_month_offset smallint not null default 1;
alter table public.pl_shifts add column pay_month_offset smallint not null default 1;
alter table public.pl_types add constraint pl_types_pay_month_offset_check check (pay_month_offset in (0, 1));
alter table public.pl_series add constraint pl_series_pay_month_offset_check check (pay_month_offset in (0, 1));
alter table public.pl_shifts add constraint pl_shifts_pay_month_offset_check check (pay_month_offset in (0, 1));

grant insert (pay_month_offset), update (pay_month_offset) on table public.pl_types to app_runtime;
grant insert (pay_month_offset), update (pay_month_offset) on table public.pl_series to app_runtime;
grant insert (pay_month_offset), update (pay_month_offset) on table public.pl_shifts to app_runtime;

create or replace function app_private.pl_expected_pay(d date, pay_day integer, month_offset integer)
returns date
language sql
immutable
set search_path = ''
as $$
  select (date_trunc('month', d) + make_interval(months => month_offset))::date
         + (least(pay_day, extract(day from (date_trunc('month', d) + make_interval(months => month_offset + 1) - interval '1 day'))::integer) - 1)
$$;
revoke all on function app_private.pl_expected_pay(date, integer, integer) from public;
grant execute on function app_private.pl_expected_pay(date, integer, integer) to app_runtime;

create or replace function app_private.pl_shifts_pay_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not new.expected_pay_manual then
    new.expected_pay_date := case when new.pay_day is null then null else app_private.pl_expected_pay(new.shift_date, new.pay_day, new.pay_month_offset) end;
  end if;
  return new;
end;
$$;
revoke all on function app_private.pl_shifts_pay_guard() from public;

