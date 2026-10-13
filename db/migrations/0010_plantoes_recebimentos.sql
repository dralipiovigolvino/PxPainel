-- 0010: Plantões — realização e recebimento (Etapa 12).
-- Situação do plantão (agendado/realizado/cancelado) e situação financeira (a receber/recebido)
-- são independentes: recebimento antecipado não marca realização.

alter table public.pl_shifts drop constraint pl_shifts_status_check;
alter table public.pl_shifts add constraint pl_shifts_status_check check (status in ('agendado', 'realizado', 'cancelado'));

alter table public.pl_shifts add column done_at timestamptz;
alter table public.pl_shifts add column received_on date;
alter table public.pl_shifts add column received_cents bigint;

alter table public.pl_shifts add constraint pl_shifts_done_check check ((status = 'realizado') = (done_at is not null));
alter table public.pl_shifts add constraint pl_shifts_receipt_check check (
  (received_on is null and received_cents is null)
  or (received_on is not null and received_cents = amount_cents and received_on >= date '2000-01-01')
);
-- Cancelado não pode ficar recebido: o recebimento precisa ser resolvido antes.
alter table public.pl_shifts add constraint pl_shifts_canceled_receipt_check check (not (status = 'cancelado' and received_on is not null));
create index pl_shifts_user_received_idx on public.pl_shifts (user_id, received_on) where received_on is not null;

-- Regras de transição (para o papel do app):
--  - recebido: valor não muda e não cancela (desfazer o recebimento antes);
--  - recebimento: data até hoje (São Paulo); valor recebido = valor da ocorrência (definido aqui);
--  - realizado → cancelado não é direto (desfazer a realização antes: ação explícita);
--  - instante da realização vem do servidor.
create or replace function app_private.pl_shifts_receipt_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.received_on is not null and new.received_on is not null then
    if new.amount_cents is distinct from old.amount_cents or new.status = 'cancelado' then
      raise exception 'pl_shift_received' using errcode = 'P0001';
    end if;
    if new.received_on is distinct from old.received_on then
      raise exception 'pl_shift_received' using errcode = 'P0001';
    end if;
  end if;
  if new.received_on is not null and old.received_on is null then
    if new.received_on > (now() at time zone 'America/Sao_Paulo')::date then
      raise exception 'pl_receipt_future' using errcode = 'P0001';
    end if;
    if new.status = 'cancelado' then
      raise exception 'pl_shift_locked' using errcode = 'P0001';
    end if;
    new.received_cents := new.amount_cents;
  elsif new.received_on is null then
    new.received_cents := null;
  end if;
  if old.status = 'realizado' and new.status = 'cancelado' then
    raise exception 'pl_shift_locked' using errcode = 'P0001';
  end if;
  if new.status = 'realizado' and old.status <> 'realizado' then
    new.done_at := now();
  elsif new.status <> 'realizado' then
    new.done_at := null;
  end if;
  return new;
end;
$$;
revoke all on function app_private.pl_shifts_receipt_guard() from public;
create trigger pl_shifts_receipt_guard before update on public.pl_shifts
  for each row execute function app_private.pl_shifts_receipt_guard();

-- Realizados e recebidos não são apagados pelo app (cancelamento e correções explícitas).
create or replace function app_private.pl_shifts_delete_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user = 'app_runtime' and (old.status = 'realizado' or old.received_on is not null) then
    raise exception 'pl_shift_locked' using errcode = 'P0001';
  end if;
  return old;
end;
$$;
revoke all on function app_private.pl_shifts_delete_guard() from public;
create trigger pl_shifts_delete_guard before delete on public.pl_shifts
  for each row execute function app_private.pl_shifts_delete_guard();

-- O app grava só a data do recebimento; valor recebido e instante da realização vêm dos gatilhos.
grant update (received_on) on table public.pl_shifts to app_runtime;
