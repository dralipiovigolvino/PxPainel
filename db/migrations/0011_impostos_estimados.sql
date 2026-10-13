-- 0011: Percentual estimado de impostos (configuração por usuário).
-- Em pontos-base (900 = 9,00%). Vale para NOVOS registros de Perícias e de plantões em valor bruto;
-- cada registro guarda a alíquota aplicada, então mudar aqui não altera o que já existe.

alter table public.user_preferences add column tax_rate_bp integer not null default 900;
alter table public.user_preferences add constraint user_preferences_tax_rate_check check (tax_rate_bp between 0 and 10000);

grant insert (tax_rate_bp) on table public.user_preferences to app_runtime;
grant update (tax_rate_bp) on table public.user_preferences to app_runtime;
