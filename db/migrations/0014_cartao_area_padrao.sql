-- 0014: Cartões — área financeira padrão das compras.
-- Escolhida pelo usuário no cartão e sugerida em cada compra (que continua podendo usar outra área).
-- Cartões existentes ficam sem padrão: a compra pede a área explicitamente, nunca escolhe a primeira.

alter table public.fin_cards add column default_area_id uuid;
alter table public.fin_cards add constraint fin_cards_default_area_fkey
  foreign key (default_area_id, user_id) references public.fin_areas (id, user_id) on delete set null (default_area_id);

grant insert (default_area_id) on table public.fin_cards to app_runtime;
grant update (default_area_id) on table public.fin_cards to app_runtime;
