-- 0019: preferências do menu — ordem dos módulos e módulos ocultos, por usuário.
-- Listas vazias = menu padrão (todos visíveis, na ordem original). Nada muda para quem não personalizar.
-- Ocultar não apaga nem bloqueia nada: só tira o módulo do menu e do Dashboard.

alter table public.user_preferences add column menu_order text[] not null default '{}';
alter table public.user_preferences add column menu_hidden text[] not null default '{}';

-- Só módulos conhecidos; o app ainda normaliza (sem repetição, módulos novos no fim).
alter table public.user_preferences
  add constraint user_preferences_menu_order_check check (
    menu_order <@ array['financas', 'followup', 'plantoes', 'pericias']::text[] and cardinality(menu_order) <= 4
  );
alter table public.user_preferences
  add constraint user_preferences_menu_hidden_check check (
    menu_hidden <@ array['financas', 'followup', 'plantoes', 'pericias']::text[] and cardinality(menu_hidden) <= 4
  );

grant insert (menu_order, menu_hidden), update (menu_order, menu_hidden) on table public.user_preferences to app_runtime;
