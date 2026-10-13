-- 0018: Finanças — total da fatura informado pelo usuário e pagamento do cartão por esse total.
-- O usuário não lança todas as compras do cartão (só as parceladas): o total que veio na fatura é
-- informado por ele e vale no lugar da soma das compras cadastradas, que passam a ser só o detalhe.
-- Nada é convertido: as faturas existentes ficam sem total informado (NULL) e continuam valendo pela soma.

alter table public.fin_invoices add column stated_total_cents bigint;
alter table public.fin_invoices
  add constraint fin_invoices_stated_total_check check (stated_total_cents is null or stated_total_cents between 1 and 9999999999);
-- Fatura paga com total informado: o valor pago é o informado.
alter table public.fin_invoices
  add constraint fin_invoices_paid_stated_check check (status <> 'pago' or stated_total_cents is null or stated_total_cents = paid_total_cents);

-- O total informado é escrito pelo app; o total pago continua definido só pelo gatilho.
grant insert (stated_total_cents), update (stated_total_cents) on table public.fin_invoices to app_runtime;

-- Pagamento: vale o total informado; sem ele, a soma das compras cadastradas (como antes).
-- Fatura sem total informado e sem compras não pode ser paga. Fatura paga não muda de datas nem de
-- total informado (é preciso reabrir). Reabrir limpa o pagamento e mantém o total informado.
create or replace function app_private.fin_invoices_payment_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  total bigint;
begin
  if old.status = 'pago' and new.status = 'pago'
     and (new.closing_date is distinct from old.closing_date
          or new.due_date is distinct from old.due_date
          or new.stated_total_cents is distinct from old.stated_total_cents) then
    raise exception 'fin_invoice_paid' using errcode = 'P0001';
  end if;
  if new.status = 'pago' and old.status = 'pendente' then
    total := new.stated_total_cents;
    if total is null then
      select coalesce(sum(c.amount_cents), 0) into total from public.fin_card_charges c where c.invoice_id = new.id;
    end if;
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

-- Cobranças em fatura paga: continuam bloqueadas quando o valor pago veio da soma das compras (mexer
-- nelas mudaria o que foi pago). Com total informado, as compras são só o detalhe e podem ser lançadas
-- ou excluídas depois: o valor pago não muda. FOR SHARE serializa com o pagamento.
create or replace function app_private.fin_charges_invoice_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  locked boolean;
begin
  if tg_op in ('INSERT', 'UPDATE') then
    select (i.status = 'pago' and i.stated_total_cents is null) into locked from public.fin_invoices i where i.id = new.invoice_id for share;
    if locked then
      raise exception 'fin_invoice_paid' using errcode = 'P0001';
    end if;
  end if;
  if tg_op in ('UPDATE', 'DELETE') then
    select (i.status = 'pago' and i.stated_total_cents is null) into locked from public.fin_invoices i where i.id = old.invoice_id for share;
    if locked then
      raise exception 'fin_invoice_paid' using errcode = 'P0001';
    end if;
  end if;
  return coalesce(new, old);
end;
$$;
revoke all on function app_private.fin_charges_invoice_guard() from public;
