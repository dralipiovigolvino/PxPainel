-- 0017: Finanças — forma de pagamento das contas fora do cartão (Pix ou boleto).
-- Compras no cartão já trazem o cartão. Registros existentes ficam sem forma informada (NULL):
-- nada é presumido nem convertido. Recorrências e parcelamentos passam a forma às contas que geram.

alter table public.fin_entries add column payment_method text;
alter table public.fin_entries
  add constraint fin_entries_payment_method_check check (payment_method is null or payment_method in ('pix', 'boleto'));

alter table public.fin_series add column payment_method text;
alter table public.fin_series
  add constraint fin_series_payment_method_check check (payment_method is null or payment_method in ('pix', 'boleto'));

alter table public.fin_installment_plans add column payment_method text;
alter table public.fin_installment_plans
  add constraint fin_plans_payment_method_check check (payment_method is null or payment_method in ('pix', 'boleto'));

grant insert (payment_method), update (payment_method) on table public.fin_entries to app_runtime;
-- Série: a forma muda como as demais regras (nova série a partir de uma data), nunca por UPDATE.
grant insert (payment_method) on table public.fin_series to app_runtime;
-- Parcelamento: a forma do plano pode mudar (vale para as parcelas pendentes).
grant insert (payment_method), update (payment_method) on table public.fin_installment_plans to app_runtime;

-- Compra no cartão: a área pode ser corrigida (o gatilho de área ativa já cobre UPDATE de area_id).
grant update (area_id) on table public.fin_card_purchases to app_runtime;
