-- 0001: preferências mínimas do usuário (Etapa 2), com RLS por contexto de transação.
-- Executar com o papel DONO do banco (npm run db:migrate), somente na branch de desenvolvimento
-- até a publicação.

-- Papel de EXECUÇÃO do app: sem login até o provisionamento (npm run db:provision-runtime),
-- sem superusuário, sem BYPASSRLS, sem criar bancos/papéis.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_runtime') then
    create role app_runtime nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls noreplication;
  end if;
end
$$;
-- Se o papel já existia, aborta caso tenha privilégios elevados (o dono do banco no Neon
-- não é superusuário e não pode alterar esses atributos por ALTER ROLE).
do $$
begin
  if exists (
    select 1 from pg_roles
    where rolname = 'app_runtime'
      and (rolsuper or rolbypassrls or rolcreaterole or rolcreatedb or rolreplication or rolinherit)
  ) then
    raise exception 'app_runtime existe com privilégios elevados; revise o papel manualmente';
  end if;
end
$$;

-- Funções auxiliares ficam fora do schema public.
create schema if not exists app_private;
revoke all on schema app_private from public;
grant usage on schema app_private to app_runtime;

-- Identidade da transação atual, definida pelo servidor a partir da sessão validada:
--   select set_config('app.user_id', '<uuid>', true)   -- true = local à transação
-- Sem contexto, retorna NULL e nenhuma política libera linhas.
create or replace function app_private.current_user_id()
returns uuid
language sql
stable
set search_path = ''
as $$
  select nullif(current_setting('app.user_id', true), '')::uuid
$$;
revoke all on function app_private.current_user_id() from public;
grant execute on function app_private.current_user_id() to app_runtime;

create or replace function app_private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function app_private.set_updated_at() from public;

create table public.user_preferences (
  -- Id do usuário no Neon Auth (neon_auth."user".id, uuid). Sem chave estrangeira para o
  -- schema gerenciado pelo provedor; a propriedade é garantida pelo RLS abaixo.
  user_id uuid primary key,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- NULL = sem nome. Texto gravado: aparado, sem caracteres de controle, 1 a 60 caracteres.
  constraint user_preferences_display_name_check check (
    display_name is null
    or (
      char_length(display_name) between 1 and 60
      and display_name = btrim(display_name)
      and display_name !~ '[[:cntrl:]]'
    )
  )
);

comment on table public.user_preferences is 'Preferências do usuário autenticado (uma linha por usuário).';

create trigger user_preferences_set_updated_at
  before update on public.user_preferences
  for each row execute function app_private.set_updated_at();

alter table public.user_preferences enable row level security;
alter table public.user_preferences force row level security;

-- Permissões mínimas do papel de execução.
revoke all on table public.user_preferences from public;
grant usage on schema public to app_runtime;
grant select on table public.user_preferences to app_runtime;
grant insert (user_id, display_name) on table public.user_preferences to app_runtime;
-- Só o nome pode ser alterado: user_id não pode ser trocado (sem transferir o registro).
grant update (display_name) on table public.user_preferences to app_runtime;
-- Sem DELETE.

create policy user_preferences_select_own on public.user_preferences
  for select to app_runtime
  using (user_id = app_private.current_user_id());

create policy user_preferences_insert_own on public.user_preferences
  for insert to app_runtime
  with check (user_id = app_private.current_user_id());

create policy user_preferences_update_own on public.user_preferences
  for update to app_runtime
  using (user_id = app_private.current_user_id())
  with check (user_id = app_private.current_user_id());
