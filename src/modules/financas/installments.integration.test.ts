import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { asUser, cleanupAreas, TAG, testUsers } from "../../../test/integration-helpers";
import { todayInSaoPaulo } from "@/lib/dates";
import { createArea, deleteEntry, listAreas, listMonthEntries, markEntryPaid, setAreaArchived, updateEntry } from "./data";
import { cancelPendingInstallments, createInstallmentPlan, listPlans, previewCancelPlan, updateInstallmentEntry, type PlanInput } from "./installments-data";

const { A, B } = testUsers();
const createdAreas: string[] = [];
const today = todayInSaoPaulo();

async function newArea(user = A, name = "Área"): Promise<string> {
  const full = `${TAG} ${name}`;
  expect(await createArea(user, { name: full, color: "#2563eb" })).toEqual({ ok: true });
  const id = (await listAreas(user)).find((a) => a.name === full)!.id;
  createdAreas.push(id);
  return id;
}

const parcels = (planId: string, user = A) =>
  asUser<{ id: string; n: number; amount: string; due: string; status: string }>(
    user.id,
    `select id, installment_number as n, amount_cents::text as amount, to_char(due_date, 'YYYY-MM-DD') as due, status
       from public.fin_entries where installment_plan_id = $1 order by installment_number`,
    [planId],
  );

async function createPlan(input: Omit<PlanInput, "description" | "category" | "notes" | "requestId"> & { description: string; requestId?: string }) {
  const description = `${TAG} ${input.description}`;
  const res = await createInstallmentPlan(A, { ...input, description, category: null, notes: null, requestId: input.requestId ?? randomUUID() });
  const plan = (await listPlans(A)).find((p) => p.description === description);
  return { res, plan };
}

afterAll(async () => {
  await cleanupAreas(createdAreas);
});

describe("Etapa 5 — parcelamentos no Neon real", () => {
  it("R$ 100,00 em 3: 33,34 + 33,33 + 33,33, datas mensais com fim de mês, 'Parcela n de N'", async () => {
    const areaId = await newArea(A, "Parcelas");
    const { res, plan } = await createPlan({ description: "Geladeira", areaId, totalCents: 10000, count: 3, firstDueDate: "2026-01-31" });
    expect(res).toEqual({ ok: true, count: 3 });
    const rows = await parcels(plan!.id);
    expect(rows.map((r) => [r.n, r.amount, r.due])).toEqual([
      [1, "3334", "2026-01-31"],
      [2, "3333", "2026-02-28"],
      [3, "3333", "2026-03-31"],
    ]);
    const month = (await listMonthEntries(A, { month: { year: 2026, month: 2 } })).filter((e) => e.areaId === areaId);
    expect(month[0]).toMatchObject({ installmentNumber: 2, installmentCount: 3, amountCents: 3333 });
  });

  it("soma sempre exata e sem parcela zero (vários totais)", async () => {
    const areaId = await newArea(A, "Somas");
    for (const [total, count] of [[9999999999, 7], [100001, 120], [5, 5]] as const) {
      const { res, plan } = await createPlan({ description: `Soma ${total}/${count}`, areaId, totalCents: total, count, firstDueDate: "2026-10-10" });
      expect(res.ok).toBe(true);
      const rows = await parcels(plan!.id);
      expect(rows).toHaveLength(count);
      expect(rows.reduce((acc, r) => acc + BigInt(r.amount), 0n)).toBe(BigInt(total));
      expect(rows.every((r) => BigInt(r.amount) > 0n)).toBe(true);
    }
  });

  it("reenvio do mesmo formulário (requestId) não duplica, inclusive em paralelo", async () => {
    const areaId = await newArea(A, "Reenvio");
    const requestId = randomUUID();
    const input = { description: `${TAG} Sofá`, areaId, category: null, notes: null, totalCents: 250000, count: 10, firstDueDate: "2026-11-05", requestId };
    const results = await Promise.all(Array.from({ length: 5 }, () => createInstallmentPlan(A, input)));
    expect(results.every((r) => r.ok)).toBe(true);
    const plans = (await listPlans(A)).filter((p) => p.description === `${TAG} Sofá`);
    expect(plans).toHaveLength(1);
    expect(await parcels(plans[0].id)).toHaveLength(10);
  });

  it("pagamento individual, saldo restante e cancelamento preservando pagas (com registro)", async () => {
    const areaId = await newArea(A, "Cancelar");
    const { plan } = await createPlan({ description: "Curso", areaId, totalCents: 120000, count: 6, firstDueDate: "2026-09-10" });
    const rows = await parcels(plan!.id);
    expect(await markEntryPaid(A, rows[0].id, today)).toEqual({ ok: true });
    expect(await markEntryPaid(A, rows[1].id, today)).toEqual({ ok: true });
    let p = (await listPlans(A)).find((x) => x.id === plan!.id)!;
    expect(p).toMatchObject({ paidCount: 2, paidCents: "40000", pendingCount: 4, pendingCents: "80000", canceledCount: 0 });
    expect(await previewCancelPlan(A, plan!.id)).toEqual({ count: 4, cents: "80000" });
    expect(await cancelPendingInstallments(A, plan!.id)).toEqual({ ok: true, count: 4 });
    p = (await listPlans(A)).find((x) => x.id === plan!.id)!;
    expect(p).toMatchObject({ paidCount: 2, paidCents: "40000", pendingCount: 0, pendingCents: "0", canceledCount: 4, canceledCents: "80000", canceled: true });
    const after = await parcels(plan!.id);
    expect(after.map((r) => r.status)).toEqual(["pago", "pago", "cancelado", "cancelado", "cancelado", "cancelado"]);
    const events = await asUser<{ action: string; details: { total_cents: string; parcelas: number[] } }>(
      A.id,
      "select action, details from public.fin_events where entity_type = 'plano' and entity_id = $1",
      [plan!.id],
    );
    expect(events).toEqual([{ action: "cancelamento", details: { total_cents: "80000", parcelas: [3, 4, 5, 6] } }]);
    // Canceladas não aparecem no mês nem entram em totais.
    const month = (await listMonthEntries(A, { month: { year: 2026, month: 12 } })).filter((e) => e.areaId === areaId);
    expect(month).toEqual([]);
    expect(await cancelPendingInstallments(A, plan!.id)).toEqual({ ok: false, reason: "nothing_to_cancel" });
    expect(await markEntryPaid(A, after[3].id, today)).toEqual({ ok: false, reason: "installment_locked" }); // cancelada é final
  });

  it("restrições: valor e área fixos; vencimento só se pendente; parcela não é excluída", async () => {
    const areaId = await newArea(A, "Restrições");
    const other = await newArea(A, "Outra");
    const { plan } = await createPlan({ description: "TV", areaId, totalCents: 300000, count: 3, firstDueDate: "2026-10-15" });
    const [p1, p2] = await parcels(plan!.id);
    expect(await updateEntry(A, p1.id, { description: `${TAG} TV`, amountCents: 1, dueDate: p1.due, areaId, category: null, notes: null, paymentMethod: null })).toEqual({
      ok: false,
      reason: "installment_locked",
    });
    expect(await updateEntry(A, p1.id, { description: `${TAG} TV`, amountCents: 100000, dueDate: p1.due, areaId: other, category: null, notes: null, paymentMethod: null })).toEqual({
      ok: false,
      reason: "installment_locked",
    });
    expect(await updateInstallmentEntry(A, p1.id, { description: `${TAG} TV sala`, category: "Casa", notes: "nota", dueDate: "2026-10-20", paymentMethod: null })).toEqual({ ok: true });
    expect(await markEntryPaid(A, p2.id, today)).toEqual({ ok: true });
    expect(await updateInstallmentEntry(A, p2.id, { description: `${TAG} TV`, category: null, notes: null, dueDate: "2026-12-01", paymentMethod: null })).toEqual({
      ok: false,
      reason: "installment_locked",
    });
    expect(await deleteEntry(A, p1.id)).toEqual({ ok: false, reason: "installment_locked" });
    const rows = await parcels(plan!.id);
    expect(rows.reduce((acc, r) => acc + BigInt(r.amount), 0n)).toBe(300000n);
    expect(rows[0]).toMatchObject({ due: "2026-10-20", amount: "100000" });
  });

  it("área arquivada: não cria plano novo, mas permite pagar parcelas existentes", async () => {
    const areaId = await newArea(A, "Arquivada");
    const { plan } = await createPlan({ description: "Notebook", areaId, totalCents: 600000, count: 2, firstDueDate: "2026-10-01" });
    expect(await setAreaArchived(A, areaId, true)).toEqual({ ok: true });
    const [p1] = await parcels(plan!.id);
    expect(await markEntryPaid(A, p1.id, today)).toEqual({ ok: true });
    const { res } = await createPlan({ description: "Novo", areaId, totalCents: 1000, count: 2, firstDueDate: "2026-10-01" });
    expect(res).toEqual({ ok: false, reason: "area_archived" });
  });

  it("isolamento: B não vê, cancela nem edita planos e parcelas de A", async () => {
    const areaId = await newArea(A, "Isolamento");
    const { plan } = await createPlan({ description: "Moto", areaId, totalCents: 900000, count: 3, firstDueDate: "2026-10-01" });
    expect((await listPlans(B)).some((p) => p.id === plan!.id)).toBe(false);
    expect(await previewCancelPlan(B, plan!.id)).toBeNull();
    expect(await cancelPendingInstallments(B, plan!.id)).toEqual({ ok: false, reason: "not_found" });
    const [p1] = await parcels(plan!.id);
    expect(await updateInstallmentEntry(B, p1.id, { description: "x", category: null, notes: null, dueDate: "2026-10-02", paymentMethod: null })).toEqual({ ok: false, reason: "not_found" });
    expect(await markEntryPaid(B, p1.id, today)).toEqual({ ok: false, reason: "not_found" });
    expect(await parcels(plan!.id, B)).toEqual([]);
    const bArea = await newArea(B, "B");
    const stolen = await createInstallmentPlan(B, {
      description: "x",
      areaId,
      category: null,
      notes: null,
      totalCents: 100,
      count: 2,
      firstDueDate: "2026-10-01",
      requestId: randomUUID(),
    });
    expect(stolen).toEqual({ ok: false, reason: "invalid_area" }); // área de A: FK composta recusa
    expect(bArea).toBeTruthy();
  });
});
