-- 0020: CNPJ — cadastro, percentual estimado de imposto e a marcação "recebo por CNPJ".
--
-- O percentual estimado de imposto deixa de ser uma preferência do usuário (0011) e passa a ser do
-- CNPJ cadastrado. Plantão ou perícia recebidos por CNPJ guardam o CNPJ e a alíquota aplicada (cópia),
-- como antes guardavam a alíquota do usuário. Regra do app (não do banco): o imposto estimado do
-- trabalho de um mês é pago no mês seguinte.
--
-- Plantões: "por CNPJ" é o antigo valor bruto (cnpj_id preenchido <=> amount_kind = 'bruto').
-- Perícias: deixam de ser sempre com imposto; sem CNPJ a alíquota gravada é 0.
-- Registros existentes: quem já tem plantões em valor bruto, perícias ou empresas ganha um CNPJ
-- "Meu CNPJ" com o percentual das preferências, e esses registros são ligados a ele. Nenhum valor,
-- alíquota ou data muda.

-- ---------------------------------------------------------------------------
-- CNPJs
-- ---------------------------------------------------------------------------
create table public.cnpjs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  name text not null,
  -- Opcional. Só os 14 caracteres, sem pontuação: 12 letras maiúsculas ou dígitos + 2 dígitos verificadores.
  cnpj_number text,
  -- Estimativa de imposto em pontos-base (900 = 9,00%) e dia do pagamento, no mês seguinte ao do trabalho.
  tax_rate_bp integer not null,
  tax_due_day smallint not null default 20,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cnpjs_name_check check (char_length(name) between 1 and 80 and name = btrim(name) and name !~ '[[:cntrl:]]'),
  constraint cnpjs_number_check check (cnpj_number is null or cnpj_number ~ '^[0-9A-Z]{12}[0-9]{2}$'),
  constraint cnpjs_tax_rate_check check (tax_rate_bp between 0 and 10000),
  constraint cnpjs_tax_due_day_check check (tax_due_day between 1 and 31),
  constraint cnpjs_id_user_key unique (id, user_id)
);
create unique index cnpjs_user_name_key on public.cnpjs (user_id, lower(name));
create trigger cnpjs_set_updated_at before update on public.cnpjs
  for each row execute function app_private.set_updated_at();

alter table public.cnpjs enable row level security;
alter table public.cnpjs force row level security;
revoke all on table public.cnpjs from public;

grant select, delete on table public.cnpjs to app_runtime;
grant insert (user_id, name, cnpj_number, tax_rate_bp, tax_due_day) on table public.cnpjs to app_runtime;
-- user_id nunca muda (o cadastro não é transferido).
grant update (name, cnpj_number, tax_rate_bp, tax_due_day) on table public.cnpjs to app_runtime;

create policy cnpjs_select_own on public.cnpjs for select to app_runtime using (user_id = app_private.current_user_id());
create policy cnpjs_insert_own on public.cnpjs for insert to app_runtime with check (user_id = app_private.current_user_id());
create policy cnpjs_update_own on public.cnpjs for update to app_runtime
  using (user_id = app_private.current_user_id()) with check (user_id = app_private.current_user_id());
create policy cnpjs_delete_own on public.cnpjs for delete to app_runtime using (user_id = app_private.current_user_id());

-- ---------------------------------------------------------------------------
-- Marcação "recebo por CNPJ": padrão do tipo de plantão e da empresa (copiado para os novos) e
-- valor de cada recorrência, plantão e perícia.
-- ---------------------------------------------------------------------------
alter table public.pl_types add column cnpj_id uuid;
alter table public.pl_series add column cnpj_id uuid;
alter table public.pl_shifts add column cnpj_id uuid;
alter table public.per_companies add column cnpj_id uuid;
alter table public.per_exams add column cnpj_id uuid;

-- Registros existentes com imposto estimado: um CNPJ por usuário, com o percentual que ele já usava.
insert into public.cnpjs (user_id, name, tax_rate_bp)
select u.user_id, 'Meu CNPJ', coalesce(p.tax_rate_bp, 900)
  from (
    select user_id from public.pl_types where default_amount_kind = 'bruto'
    union
    select user_id from public.pl_series where amount_kind = 'bruto'
    union
    select user_id from public.pl_shifts where amount_kind = 'bruto'
    union
    select user_id from public.per_companies
    union
    select user_id from public.per_exams
  ) u
  left join public.user_preferences p on p.user_id = u.user_id;

-- Só a ligação com o CNPJ é gravada: gatilhos do app desligados para não tocar em updated_at nem
-- reavaliar regras de edição (as chaves estrangeiras e as restrições continuam valendo).
alter table public.pl_types disable trigger user;
alter table public.pl_series disable trigger user;
alter table public.pl_shifts disable trigger user;
alter table public.per_companies disable trigger user;
alter table public.per_exams disable trigger user;

update public.pl_types t set cnpj_id = c.id from public.cnpjs c where c.user_id = t.user_id and t.default_amount_kind = 'bruto';
update public.pl_series s set cnpj_id = c.id from public.cnpjs c where c.user_id = s.user_id and s.amount_kind = 'bruto';
update public.pl_shifts s set cnpj_id = c.id from public.cnpjs c where c.user_id = s.user_id and s.amount_kind = 'bruto';
update public.per_companies k set cnpj_id = c.id from public.cnpjs c where c.user_id = k.user_id;
update public.per_exams e set cnpj_id = c.id from public.cnpjs c where c.user_id = e.user_id;

alter table public.pl_types enable trigger user;
alter table public.pl_series enable trigger user;
alter table public.pl_shifts enable trigger user;
alter table public.per_companies enable trigger user;
alter table public.per_exams enable trigger user;

-- O CNPJ é sempre do mesmo usuário do registro; CNPJ em uso não é apagado.
alter table public.pl_types add constraint pl_types_cnpj_fkey foreign key (cnpj_id, user_id) references public.cnpjs (id, user_id) on delete restrict;
alter table public.pl_series add constraint pl_series_cnpj_fkey foreign key (cnpj_id, user_id) references public.cnpjs (id, user_id) on delete restrict;
alter table public.pl_shifts add constraint pl_shifts_cnpj_fkey foreign key (cnpj_id, user_id) references public.cnpjs (id, user_id) on delete restrict;
alter table public.per_companies add constraint per_companies_cnpj_fkey foreign key (cnpj_id, user_id) references public.cnpjs (id, user_id) on delete restrict;
alter table public.per_exams add constraint per_exams_cnpj_fkey foreign key (cnpj_id, user_id) references public.cnpjs (id, user_id) on delete restrict;

-- Plantões: por CNPJ <=> valor bruto (com alíquota gravada, pela restrição de 0013). Sem CNPJ: líquido
-- ou, em registros antigos, sem classificação.
alter table public.pl_types add constraint pl_types_cnpj_kind_check check ((cnpj_id is not null) = (default_amount_kind is not distinct from 'bruto'));
alter table public.pl_series add constraint pl_series_cnpj_kind_check check ((cnpj_id is not null) = (amount_kind is not distinct from 'bruto'));
alter table public.pl_shifts add constraint pl_shifts_cnpj_kind_check check ((cnpj_id is not null) = (amount_kind is not distinct from 'bruto'));
-- Perícias: sem CNPJ não há imposto estimado.
alter table public.per_exams add constraint per_exams_cnpj_rate_check check (cnpj_id is not null or tax_rate_bp = 0);

create index pl_shifts_user_cnpj_idx on public.pl_shifts (user_id, cnpj_id) where cnpj_id is not null;
create index per_exams_user_cnpj_idx on public.per_exams (user_id, cnpj_id) where cnpj_id is not null;

grant insert (cnpj_id), update (cnpj_id) on table public.pl_types to app_runtime;
-- Recorrência: o CNPJ muda como as demais regras (nova série a partir de uma data), nunca por UPDATE.
grant insert (cnpj_id) on table public.pl_series to app_runtime;
grant insert (cnpj_id), update (cnpj_id) on table public.pl_shifts to app_runtime;
grant insert (cnpj_id), update (cnpj_id) on table public.per_companies to app_runtime;
grant insert (cnpj_id), update (cnpj_id) on table public.per_exams to app_runtime;

-- ---------------------------------------------------------------------------
-- Recebimento registrado não trava mais a marcação de CNPJ nem a alíquota: o imposto é uma estimativa
-- à parte, paga no mês seguinte, e não muda o valor recebido. Valor, cancelamento e data do
-- recebimento continuam travados (gatilhos de 0010 e abaixo).
-- ---------------------------------------------------------------------------
-- Plantões: o gatilho passa a cuidar só da data prevista de pagamento (regra de 0013 inalterada).
create or replace function app_private.pl_shifts_pay_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not new.expected_pay_manual then
    new.expected_pay_date := case when new.pay_day is null then null else app_private.pl_expected_pay(new.shift_date, new.pay_day) end;
  end if;
  return new;
end;
$$;
revoke all on function app_private.pl_shifts_pay_guard() from public;

-- Perícias: mesma função de 0012, sem a alíquota na trava de "recebida".
create or replace function app_private.per_exams_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  archived timestamptz;
begin
  if tg_op = 'INSERT' or new.company_id is distinct from old.company_id then
    select c.archived_at into archived from public.per_companies c where c.id = new.company_id and c.user_id = new.user_id for share;
    if found and archived is not null then
      raise exception 'per_company_archived' using errcode = 'P0001';
    end if;
  end if;
  if tg_op = 'UPDATE' then
    if old.received_on is not null and new.received_on is not null then
      if new.amount_cents is distinct from old.amount_cents
         or new.status = 'cancelada' or new.received_on is distinct from old.received_on then
        raise exception 'per_exam_received' using errcode = 'P0001';
      end if;
    end if;
    if old.status = 'realizada' and new.status = 'cancelada' then
      raise exception 'per_exam_locked' using errcode = 'P0001';
    end if;
  end if;
  if new.received_on is not null and (tg_op = 'INSERT' or old.received_on is null) then
    if new.received_on > (now() at time zone 'America/Sao_Paulo')::date then
      raise exception 'per_receipt_future' using errcode = 'P0001';
    end if;
    if new.status = 'cancelada' then
      raise exception 'per_exam_locked' using errcode = 'P0001';
    end if;
  end if;
  if new.status = 'realizada' and (tg_op = 'INSERT' or old.status <> 'realizada') then
    new.done_at := now();
  elsif new.status <> 'realizada' then
    new.done_at := null;
  end if;
  if new.status = 'cancelada' and (tg_op = 'INSERT' or old.status <> 'cancelada') then
    new.canceled_at := now();
  elsif new.status <> 'cancelada' then
    new.canceled_at := null;
  end if;
  return new;
end;
$$;
revoke all on function app_private.per_exams_guard() from public;

-- ---------------------------------------------------------------------------
-- Menu do usuário (0019): o módulo CNPJ entra na lista de módulos que podem ser ordenados e ocultados.
-- ---------------------------------------------------------------------------
alter table public.user_preferences drop constraint user_preferences_menu_order_check;
alter table public.user_preferences drop constraint user_preferences_menu_hidden_check;
alter table public.user_preferences
  add constraint user_preferences_menu_order_check check (
    menu_order <@ array['financas', 'followup', 'plantoes', 'pericias', 'cnpj']::text[] and cardinality(menu_order) <= 5
  );
alter table public.user_preferences
  add constraint user_preferences_menu_hidden_check check (
    menu_hidden <@ array['financas', 'followup', 'plantoes', 'pericias', 'cnpj']::text[] and cardinality(menu_hidden) <= 5
  );
