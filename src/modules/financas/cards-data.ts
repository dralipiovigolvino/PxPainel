import "server-only";

import type { PoolClient } from "@neondatabase/serverless";
import type { AuthUser } from "@/lib/auth/session-user";
import { addMonths, formatCivilDate, parseYearMonth, type CivilDate, type YearMonth } from "@/lib/dates";
import { withUserContext } from "@/lib/db/user-context";
import { centsFromDb } from "@/lib/money";
import { toFailure, type MutationResult } from "./data";
import { chargeReferences, cycleDates, cycleDueIn, cycleForPurchase, invoiceTotal, referenceToDate } from "./domain/cards";
import { splitCents } from "./domain/installments";
import type { CardCharge, FinCard, FinInvoice } from "./types";

export type { CardCharge, FinCard, FinInvoice } from "./types";

async function logEvent(db: PoolClient, userId: string, type: "fatura" | "compra" | "cartao", id: string, action: string, details: object) {
  await db.query(
    "insert into public.fin_events (user_id, entity_type, entity_id, action, details) values ($1, $2, $3, $4, $5::jsonb)",
    [userId, type, id, action, JSON.stringify(details)],
  );
}

async function run(operation: string, user: AuthUser, sql: string, params: unknown[]): Promise<MutationResult> {
  try {
    const count = await withUserContext(user, async (db) => (await db.query(sql, params)).rowCount ?? 0);
    return count > 0 ? { ok: true } : { ok: false, reason: "not_found" };
  } catch (error) {
    return cardFailure(operation, error);
  }
}

function cardFailure(operation: string, error: unknown): MutationResult {
  const e = error as { code?: string; message?: string; constraint?: string };
  if (e?.code === "23505" && e.constraint === "fin_cards_user_name_key") return { ok: false, reason: "duplicate_name" };
  if (e?.code === "P0001" && e.message === "fin_invoice_empty") return { ok: false, reason: "invoice_empty" };
  if (e?.code === "23503" && e.constraint === "fin_cards_default_area_fkey") return { ok: false, reason: "invalid_area" };
  if ((e?.code === "23001" || e?.code === "23503") && e.constraint?.includes("card_fkey")) {
    return { ok: false, reason: operation === "card.delete" ? "has_entries" : "invalid_card" };
  }
  return toFailure(operation, error);
}

// ---------------------------------------------------------------------------
// Cartões
// ---------------------------------------------------------------------------

export async function listCards(user: AuthUser): Promise<FinCard[]> {
  return withUserContext(user, async (db) => {
    const { rows } = await db.query<{
      id: string;
      name: string;
      closing_day: number;
      due_day: number;
      default_area_id: string | null;
      notes: string | null;
      archived: boolean;
      links: number;
    }>(
      `select c.id, c.name, c.closing_day, c.due_day, c.default_area_id, c.notes, c.archived_at is not null as archived,
              (select count(*)::int from public.fin_card_purchases p where p.card_id = c.id)
                + (select count(*)::int from public.fin_invoices i where i.card_id = c.id) as links
         from public.fin_cards c
        order by (c.archived_at is not null), lower(c.name), c.id`,
    );
    return rows.map((r) => ({ id: r.id, name: r.name, closingDay: r.closing_day, dueDay: r.due_day, defaultAreaId: r.default_area_id, notes: r.notes, archived: r.archived, links: r.links }));
  });
}

export type CardInput = { name: string; closingDay: number; dueDay: number; notes: string | null; defaultAreaId: string | null };

export function createCard(user: AuthUser, input: CardInput) {
  return run("card.create", user, "insert into public.fin_cards (user_id, name, closing_day, due_day, notes, default_area_id) values ($1, $2, $3, $4, $5, $6)", [
    user.id,
    input.name,
    input.closingDay,
    input.dueDay,
    input.notes,
    input.defaultAreaId,
  ]);
}

/** Mudar os dias padrão NÃO altera faturas existentes: só novos ciclos usam os novos dias. */
export function updateCard(user: AuthUser, id: string, input: CardInput) {
  return run("card.update", user, "update public.fin_cards set name = $2, closing_day = $3, due_day = $4, notes = $5, default_area_id = $6 where id = $1", [
    id,
    input.name,
    input.closingDay,
    input.dueDay,
    input.notes,
    input.defaultAreaId,
  ]);
}

export function setCardArchived(user: AuthUser, id: string, archived: boolean) {
  return run(
    archived ? "card.archive" : "card.restore",
    user,
    archived
      ? "update public.fin_cards set archived_at = now() where id = $1 and archived_at is null"
      : "update public.fin_cards set archived_at = null where id = $1 and archived_at is not null",
    [id],
  );
}

/** Só sem compras nem faturas (FKs com RESTRICT). */
export function deleteCard(user: AuthUser, id: string) {
  return run("card.delete", user, "delete from public.fin_cards where id = $1", [id]);
}

// ---------------------------------------------------------------------------
// Parcelas no mês
// ---------------------------------------------------------------------------

/** Parcelas de compras no cartão cuja fatura vence no intervalo. */
export async function queryCardCharges(db: PoolClient, from: CivilDate, to: CivilDate): Promise<CardCharge[]> {
  const { rows } = await db.query<{
    id: string;
    purchase_id: string;
    invoice_id: string;
    card_id: string;
    card_name: string;
    area_id: string;
    description: string;
    category: string | null;
    notes: string | null;
    purchase_date: string;
    due_date: string;
    number: number;
    count: number;
    amount: string;
    total: string;
  }>(
    `select ch.id, p.id as purchase_id, i.id as invoice_id, c.id as card_id, c.name as card_name, p.area_id, p.description, p.category, p.notes,
            to_char(p.purchase_date, 'YYYY-MM-DD') as purchase_date, to_char(i.due_date, 'YYYY-MM-DD') as due_date,
            ch.installment_number as number, p.installments_count as count, ch.amount_cents::text as amount, p.total_cents::text as total
       from public.fin_card_charges ch
       join public.fin_invoices i on i.id = ch.invoice_id
       join public.fin_card_purchases p on p.id = ch.purchase_id
       join public.fin_cards c on c.id = ch.card_id
      where i.due_date between $1::date and $2::date
      order by i.due_date, p.purchase_date, p.created_at, ch.installment_number`,
    [from, to],
  );
  return rows.map((r) => ({
    id: r.id,
    purchaseId: r.purchase_id,
    invoiceId: r.invoice_id,
    cardId: r.card_id,
    cardName: r.card_name,
    areaId: r.area_id,
    description: r.description,
    category: r.category,
    notes: r.notes,
    purchaseDate: r.purchase_date,
    dueDate: r.due_date,
    number: r.number,
    count: r.count,
    amountCents: centsFromDb(r.amount),
    purchaseTotalCents: centsFromDb(r.total),
  }));
}

export async function listCardCharges(user: AuthUser, from: CivilDate, to: CivilDate): Promise<CardCharge[]> {
  return withUserContext(user, (db) => queryCardCharges(db, from, to));
}

/**
 * Faturas com vencimento no intervalo que têm o que mostrar: compras cadastradas, total informado ou
 * pagamento. Ciclo vazio (sem nada disso) não é listado.
 */
export async function queryInvoices(db: PoolClient, from: CivilDate, to: CivilDate): Promise<FinInvoice[]> {
  const { rows } = await db.query<{
    id: string;
    card_id: string;
    card_name: string;
    due_date: string;
    status: "pendente" | "pago";
    paid_on: string | null;
    stated: string | null;
    paid_total: string | null;
    detailed: string;
  }>(
    `select i.id, i.card_id, c.name as card_name, to_char(i.due_date, 'YYYY-MM-DD') as due_date, i.status,
            to_char(i.paid_on, 'YYYY-MM-DD') as paid_on, i.stated_total_cents::text as stated, i.paid_total_cents::text as paid_total,
            coalesce((select sum(ch.amount_cents) from public.fin_card_charges ch where ch.invoice_id = i.id), 0)::text as detailed
       from public.fin_invoices i
       join public.fin_cards c on c.id = i.card_id
      where i.due_date between $1::date and $2::date
      order by i.due_date, lower(c.name), i.id`,
    [from, to],
  );
  return rows
    .map((r) => {
      const statedCents = r.stated === null ? null : centsFromDb(r.stated);
      const detailedCents = centsFromDb(r.detailed);
      const paidTotalCents = r.paid_total === null ? null : centsFromDb(r.paid_total);
      return {
        id: r.id,
        cardId: r.card_id,
        cardName: r.card_name,
        dueDate: r.due_date,
        status: r.status,
        paidOn: r.paid_on,
        statedCents,
        detailedCents,
        totalCents: invoiceTotal({ status: r.status, paidTotalCents, statedCents, detailedCents }),
      };
    })
    .filter((i) => i.status === "pago" || i.statedCents !== null || i.detailedCents > 0);
}

export async function listInvoices(user: AuthUser, from: CivilDate, to: CivilDate): Promise<FinInvoice[]> {
  return withUserContext(user, (db) => queryInvoices(db, from, to));
}

// ---------------------------------------------------------------------------
// Fatura: total informado e pagamento
// ---------------------------------------------------------------------------

/** Fatura existente ou, quando o cartão ainda não tem nada naquele vencimento, o cartão e o mês do vencimento. */
export type InvoiceTarget = { invoiceId: string } | { cardId: string; dueMonth: YearMonth };

/**
 * Informa o total da fatura (o que veio no banco), ou limpa com null: aí volta a valer a soma das compras.
 * Sem fatura naquele vencimento, cria o ciclo do cartão para guardar o total. Limpar o total de uma
 * fatura sem compras remove a fatura (não sobra o que mostrar). Fatura paga não muda de total: o gatilho
 * recusa (é preciso voltar para a pagar antes). As compras cadastradas não são alteradas.
 */
export async function setInvoiceTotal(user: AuthUser, target: InvoiceTarget, totalCents: number | null): Promise<MutationResult> {
  try {
    return await withUserContext(user, async (db): Promise<MutationResult> => {
      let invoiceId: string;
      if ("invoiceId" in target) invoiceId = target.invoiceId;
      else {
        if (totalCents === null) return { ok: false, reason: "not_found" };
        const card = await db.query<{ closing_day: number; due_day: number; archived: boolean }>(
          "select closing_day, due_day, archived_at is not null as archived from public.fin_cards where id = $1 for share",
          [target.cardId],
        );
        if (!card.rows[0]) return { ok: false, reason: "invalid_card" };
        if (card.rows[0].archived) return { ok: false, reason: "card_archived" };
        const cycle = cycleDueIn(target.dueMonth, card.rows[0].closing_day, card.rows[0].due_day);
        await db.query(
          `insert into public.fin_invoices (user_id, card_id, reference_month, closing_date, due_date)
           values ($1, $2, $3::date, $4::date, $5::date) on conflict (card_id, reference_month) do nothing`,
          [user.id, target.cardId, referenceToDate(cycle.reference), cycle.closingDate, cycle.dueDate],
        );
        const found = await db.query<{ id: string }>("select id from public.fin_invoices where card_id = $1 and reference_month = $2::date", [target.cardId, referenceToDate(cycle.reference)]);
        if (!found.rows[0]) return { ok: false, reason: "not_found" };
        invoiceId = found.rows[0].id;
      }
      const updated = await db.query<{ empty: boolean; due: string }>(
        `update public.fin_invoices i set stated_total_cents = $2::bigint where i.id = $1
         returning not exists (select 1 from public.fin_card_charges c where c.invoice_id = i.id) as empty, to_char(i.due_date, 'YYYY-MM-DD') as due`,
        [invoiceId, totalCents],
      );
      if (!updated.rows[0]) return { ok: false, reason: "not_found" };
      const removed = totalCents === null && updated.rows[0].empty;
      if (removed) {
        await db.query("delete from public.fin_invoices where id = $1 and status = 'pendente'", [invoiceId]);
      } else {
        await logEvent(db, user.id, "fatura", invoiceId, "total", { total_cents: totalCents === null ? null : String(totalCents) });
      }
      // count 0 = a fatura deixou de existir (sem total e sem compras).
      return { ok: true, firstDue: updated.rows[0].due, count: removed ? 0 : 1 };
    });
  } catch (error) {
    return cardFailure("invoice.total", error);
  }
}

/**
 * Marca a fatura como paga, num pagamento só. `totalCents` é o total da fatura confirmado no pagamento
 * (o formulário o envia sempre, já preenchido com o total informado antes); null = sem total informado.
 * O valor pago é calculado no banco: esse total ou, sem ele, a soma das compras cadastradas.
 * Repetir o envio de uma fatura já paga não registra um segundo pagamento.
 */
export async function payInvoice(user: AuthUser, invoiceId: string, paidOn: CivilDate, totalCents: number | null): Promise<MutationResult> {
  try {
    return await withUserContext(user, async (db): Promise<MutationResult> => {
      const { rows } = await db.query<{ total: string }>(
        `update public.fin_invoices set status = 'pago', paid_on = $2::date, stated_total_cents = $3::bigint
          where id = $1 and status = 'pendente' returning paid_total_cents::text as total`,
        [invoiceId, paidOn, totalCents],
      );
      if (!rows[0]) {
        const existing = await db.query("select 1 from public.fin_invoices where id = $1 and status = 'pago'", [invoiceId]);
        return existing.rowCount ? { ok: true } : { ok: false, reason: "not_found" };
      }
      await logEvent(db, user.id, "fatura", invoiceId, "pagamento", { paid_on: paidOn, total_cents: rows[0].total });
      return { ok: true };
    });
  } catch (error) {
    return cardFailure("invoice.pay", error);
  }
}

/** Volta a fatura para a pagar. O pagamento desfeito (data e valor) fica no histórico; o total informado continua. */
export async function unpayInvoice(user: AuthUser, invoiceId: string): Promise<MutationResult> {
  try {
    return await withUserContext(user, async (db): Promise<MutationResult> => {
      const before = await db.query<{ status: string; paid_on: string | null; total: string | null }>(
        "select status, to_char(paid_on, 'YYYY-MM-DD') as paid_on, paid_total_cents::text as total from public.fin_invoices where id = $1 for update",
        [invoiceId],
      );
      if (!before.rows[0]) return { ok: false, reason: "not_found" };
      if (before.rows[0].status !== "pago") return { ok: true };
      await db.query("update public.fin_invoices set status = 'pendente', paid_on = null where id = $1", [invoiceId]);
      await logEvent(db, user.id, "fatura", invoiceId, "reabertura", { paid_on: before.rows[0].paid_on, total_cents: before.rows[0].total });
      return { ok: true };
    });
  } catch (error) {
    return cardFailure("invoice.unpay", error);
  }
}

// ---------------------------------------------------------------------------
// Compras
// ---------------------------------------------------------------------------

export type PurchasePreview = {
  /** `locked`: mês já pago sem total informado — não recebe compra (mudaria o valor pago). */
  cycles: Array<{ reference: string; closingDate: CivilDate; dueDate: CivilDate; existing: boolean; locked: boolean; amountCents: number }>;
  defaultReference: string;
};

/**
 * Prévia (somente leitura): em quais faturas a compra cairia, com as datas REAIS das faturas
 * que já existem (podem ter sido ajustadas) ou as calculadas pelos dias atuais do cartão.
 */
export async function previewPurchase(
  user: AuthUser,
  input: { cardId: string; purchaseDate: CivilDate; totalCents: number; count: number; firstReference: string | null },
): Promise<PurchasePreview | null> {
  return withUserContext(user, async (db) => {
    const card = await db.query<{ closing_day: number; due_day: number }>("select closing_day, due_day from public.fin_cards where id = $1", [input.cardId]);
    if (!card.rows[0]) return null;
    const { closing_day, due_day } = card.rows[0];
    const computed = cycleForPurchase(input.purchaseDate, closing_day, due_day).reference;
    const refs = chargeReferences(input.firstReference ?? computed, input.count);
    const existing = await db.query<{ reference: string; closing: string; due: string; locked: boolean }>(
      `select to_char(reference_month, 'YYYY-MM') as reference, to_char(closing_date, 'YYYY-MM-DD') as closing,
              to_char(due_date, 'YYYY-MM-DD') as due, (status = 'pago' and stated_total_cents is null) as locked
         from public.fin_invoices where card_id = $1 and reference_month = any($2::date[])`,
      [input.cardId, refs.map(referenceToDate)],
    );
    const byRef = new Map(existing.rows.map((r) => [r.reference, r]));
    const parts = splitCents(input.totalCents, input.count);
    return {
      defaultReference: computed,
      cycles: refs.map((reference, i) => {
        const found = byRef.get(reference);
        const dates = cycleDates(parseYearMonth(reference)!, closing_day, due_day);
        return {
          reference,
          closingDate: found?.closing ?? dates.closingDate,
          dueDate: found?.due ?? dates.dueDate,
          existing: Boolean(found),
          locked: found?.locked ?? false,
          amountCents: parts[i],
        };
      }),
    };
  });
}

export type PurchaseInput = {
  cardId: string;
  areaId: string;
  /** Vazia = identificação automática ("Compra de DD/MM/AAAA"). */
  description: string;
  /** Gravar a área desta compra como padrão do cartão (pedido explícito do formulário). */
  setDefaultArea?: boolean;
  category: string | null;
  notes: string | null;
  purchaseDate: CivilDate;
  totalCents: number;
  count: number;
  /** Primeira fatura escolhida explicitamente (AAAA-MM) ou null = regra padrão. */
  firstReference: string | null;
  requestId: string;
};

/** Primeira fatura explícita só pode ficar perto da data da compra (mês anterior até 3 meses depois). */
export function isReasonableFirstReference(purchaseDate: CivilDate, reference: string): boolean {
  const ref = parseYearMonth(reference);
  const [y, m] = purchaseDate.split("-").map(Number);
  if (!ref) return false;
  const min = addMonths({ year: y, month: m }, -1);
  const max = addMonths({ year: y, month: m }, 3);
  const key = (v: { year: number; month: number }) => v.year * 12 + v.month;
  return key(ref) >= key(min) && key(ref) <= key(max);
}

/**
 * Cria a compra, garante as faturas dos ciclos (com as datas do cartão naquele momento) e as
 * cobranças, numa transação. Mês já pago sem total informado é recusado (o gatilho recusa também sob
 * corrida); com total informado a compra entra só como detalhe, sem mudar o valor pago.
 * Idempotente por requestId. NÃO cria fin_entries.
 */
export async function createPurchase(user: AuthUser, input: PurchaseInput): Promise<MutationResult> {
  try {
    return await withUserContext(user, async (db): Promise<MutationResult> => {
      const card = await db.query<{ closing_day: number; due_day: number; archived: boolean }>(
        "select closing_day, due_day, archived_at is not null as archived from public.fin_cards where id = $1 for share",
        [input.cardId],
      );
      if (!card.rows[0]) return { ok: false, reason: "invalid_card" };
      if (card.rows[0].archived) return { ok: false, reason: "card_archived" };
      const { closing_day, due_day } = card.rows[0];
      const first = input.firstReference ?? cycleForPurchase(input.purchaseDate, closing_day, due_day).reference;
      const refs = chargeReferences(first, input.count);

      for (const reference of refs) {
        const dates = cycleDates(parseYearMonth(reference)!, closing_day, due_day);
        await db.query(
          `insert into public.fin_invoices (user_id, card_id, reference_month, closing_date, due_date)
           values ($1, $2, $3::date, $4::date, $5::date) on conflict (card_id, reference_month) do nothing`,
          [user.id, input.cardId, referenceToDate(reference), dates.closingDate, dates.dueDate],
        );
      }
      const invoices = await db.query<{ id: string; reference: string; locked: boolean }>(
        "select id, to_char(reference_month, 'YYYY-MM') as reference, (status = 'pago' and stated_total_cents is null) as locked from public.fin_invoices where card_id = $1 and reference_month = any($2::date[])",
        [input.cardId, refs.map(referenceToDate)],
      );
      const byRef = new Map(invoices.rows.map((r) => [r.reference, r]));
      if (refs.some((r) => byRef.get(r)?.locked)) return { ok: false, reason: "invoice_paid" };

      const purchase = await db.query<{ id: string }>(
        `insert into public.fin_card_purchases
           (user_id, card_id, area_id, description, category, notes, purchase_date, total_cents, installments_count, request_id)
         values ($1, $2, $3, $4, $5, $6, $7::date, $8, $9, $10)
         on conflict (user_id, request_id) do nothing returning id`,
        [user.id, input.cardId, input.areaId, input.description || `Compra de ${formatCivilDate(input.purchaseDate)}`, input.category, input.notes, input.purchaseDate, input.totalCents, input.count, input.requestId],
      );
      if (!purchase.rows[0]) return { ok: true, count: 0 }; // reenvio: já criada
      if (input.setDefaultArea) await db.query("update public.fin_cards set default_area_id = $2 where id = $1", [input.cardId, input.areaId]);
      const parts = splitCents(input.totalCents, input.count);
      await db.query(
        `insert into public.fin_card_charges (user_id, card_id, purchase_id, invoice_id, installment_number, amount_cents)
         select $1, $2, $3, inv, n, a from unnest($4::uuid[], $5::smallint[], $6::bigint[]) as t(inv, n, a)`,
        [user.id, input.cardId, purchase.rows[0].id, refs.map((r) => byRef.get(r)!.id), parts.map((_, i) => i + 1), parts],
      );
      await logEvent(db, user.id, "compra", purchase.rows[0].id, "criacao", {
        total_cents: String(input.totalCents),
        parcelas: input.count,
        primeira_fatura: first,
        escolhida: input.firstReference !== null,
      });
      const due = await db.query<{ due: string }>("select to_char(due_date, 'YYYY-MM-DD') as due from public.fin_invoices where id = $1", [byRef.get(refs[0])!.id]);
      return { ok: true, count: input.count, firstDue: due.rows[0]?.due };
    });
  } catch (error) {
    return cardFailure("purchase.create", error);
  }
}

/** Corrige descrição, área, categoria e observação da compra (valor, parcelas e cartão ficam fixos). */
export function updatePurchase(user: AuthUser, id: string, input: { description: string; areaId: string; category: string | null; notes: string | null }) {
  return run("purchase.update", user, "update public.fin_card_purchases set description = $2, area_id = $3, category = $4, notes = $5 where id = $1", [
    id,
    input.description,
    input.areaId,
    input.category,
    input.notes,
  ]);
}

/** Exclui a compra e todas as suas parcelas. Fatura a pagar que ficar sem compras e sem total informado deixa de existir. */
export async function deletePurchase(user: AuthUser, id: string): Promise<MutationResult> {
  try {
    return await withUserContext(user, async (db): Promise<MutationResult> => {
      const { rows } = await db.query<{ card_id: string; description: string; total: string }>(
        "delete from public.fin_card_purchases where id = $1 returning card_id, description, total_cents::text as total",
        [id],
      );
      if (!rows[0]) return { ok: false, reason: "not_found" };
      await db.query(
        `delete from public.fin_invoices i where i.card_id = $1 and i.status = 'pendente' and i.stated_total_cents is null
           and not exists (select 1 from public.fin_card_charges c where c.invoice_id = i.id)`,
        [rows[0].card_id],
      );
      await logEvent(db, user.id, "compra", id, "exclusao", { total_cents: rows[0].total });
      return { ok: true };
    });
  } catch (error) {
    return cardFailure("purchase.delete", error);
  }
}
