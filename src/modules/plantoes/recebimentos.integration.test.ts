import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { asUser, cleanupPlantoes, TAG, testUsers } from "../../../test/integration-helpers";
import { addDays, addMonths, formatYearMonth, todayInSaoPaulo, yearMonthOf } from "@/lib/dates";
import { monthRange } from "@/modules/financas/domain/filters";
import { createShift, createType, deleteShift, getShiftEvents, listShifts, receivedInPeriod, receiveShift, setShiftCanceled, setShiftDone, undoReceipt, updateShift } from "./data";
import { shiftSchema, typeSchema } from "./domain/schemas";
import { shiftTotals } from "./domain/totals";
import { createSeries, splitSeries } from "./series-data";

/** Etapa 12 no Neon real. Cenário de referência com meses PASSADOS (recebimento nunca no futuro). */
const { A, B } = testUsers();
const types: string[] = [];
const today = todayInSaoPaulo();
const M = addMonths(yearMonthOf(today), -2); // mês selecionado
const M1 = addMonths(M, 1); // mês do recebimento de A
const day = (ym: typeof M, d: number) => `${formatYearMonth(ym)}-${String(d).padStart(2, "0")}`;

afterAll(() => cleanupPlantoes(types));

async function newType(name: string, user = A) {
  const r = await createType(user, typeSchema.parse({ name: `${TAG} ${name}`, location: "", amount: "1.000,00", color: "#2563eb", notes: "", start: "", end: "", nextDay: "false", cnpjId: "", payDay: "" }));
  const id = (r as { id: string }).id;
  types.push(id);
  return id;
}
async function add(typeId: string, date: string, amount: string, user = A) {
  const r = await createShift(user, typeId, { ...shiftSchema.parse({ date, amount, notes: "", start: "", end: "", nextDay: "false", cnpjId: "", payMode: "auto", payDate: "" }), requestId: randomUUID(), confirmOverlap: true });
  return (r as { id: string }).id;
}

describe("Etapa 12 — valores e recebimentos (Neon real)", () => {
  it("cenário de referência: totais calculados à mão", async () => {
    const t = await newType("Referência");
    const a = await add(t, day(M, 5), "1.000,00");
    const b = await add(t, day(M, 12), "800,00");
    await add(t, day(M, 19), "500,00"); // C agendado
    const d = await add(t, day(M, 26), "700,00");
    expect(await setShiftDone(A, a, true)).toMatchObject({ ok: true });
    expect(await setShiftDone(A, b, true)).toMatchObject({ ok: true });
    expect(await receiveShift(A, a, day(M1, 10))).toMatchObject({ ok: true });
    expect(await setShiftCanceled(A, d, true)).toMatchObject({ ok: true });
    const { from, to } = monthRange(M);
    const month = (await listShifts(A, from, to)).filter((s) => s.typeId === t);
    const totals = shiftTotals(month);
    expect({
      programado: totals.programado,
      realizado: totals.realizado,
      recebidoDoMes: totals.recebidoDoMes,
      aReceber: totals.aReceber,
      realizadosAReceber: totals.realizadosAReceber,
    }).toEqual({ programado: 230000n, realizado: 180000n, recebidoDoMes: 100000n, aReceber: 130000n, realizadosAReceber: 80000n });
    expect(totals.programado).toBe(totals.recebidoDoMes + totals.aReceber);
    expect((await receivedInPeriod(A, from, to, t)).cents).toBe(0n);
    const next = monthRange(M1);
    expect(await receivedInPeriod(A, next.from, next.to, t)).toEqual({ cents: 100000n, count: 1 });
    expect(month.find((s) => s.id === a)).toMatchObject({ receivedOn: day(M1, 10), receivedCents: 100000, status: "realizado" });
  });

  it("realização é manual: data passada continua agendada até marcar; desfazer preserva o registro", async () => {
    const t = await newType("Realização");
    const id = await add(t, addDays(today, -3), "900,00");
    const [s] = (await listShifts(A, addDays(today, -3), addDays(today, -3))).filter((x) => x.id === id);
    expect(s.status).toBe("agendado");
    await setShiftDone(A, id, true);
    await setShiftDone(A, id, false);
    const ev = await getShiftEvents(A, id);
    expect(ev.map((e) => e.action)).toEqual(["criado", "realizado", "realizacao_desfeita"]);
    expect(ev[2].details.realizado_em).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });

  it("recebimento antecipado não marca realização; data futura recusada (app e banco)", async () => {
    const t = await newType("Antecipado");
    const id = await add(t, addDays(today, 10), "600,00");
    expect(await receiveShift(A, id, addDays(today, 1))).toEqual({ ok: false, reason: "receipt_future" });
    expect(await receiveShift(A, id, today)).toMatchObject({ ok: true });
    const [s] = (await listShifts(A, addDays(today, 10), addDays(today, 10))).filter((x) => x.id === id);
    expect(s).toMatchObject({ status: "agendado", receivedOn: today, receivedCents: 60000 });
    const forged = await asUser(A.id, "update public.pl_shifts set received_on = null, received_cents = 1 where id = $1", [id]).catch((e) => e.code);
    expect(forged).toBe("42501");
  });

  it("valor recebido protegido; cancelar recebido ou realizado exige desfazer antes; não exclui", async () => {
    const t = await newType("Proteções");
    const id = await add(t, addDays(today, -1), "1.200,00");
    await receiveShift(A, id, today);
    expect(await updateShift(A, id, { amount: 130000, hours: null, notes: null, cnpjId: null, expectedPayDate: null, confirmOverlap: true })).toEqual({ ok: false, reason: "received" });
    expect(await setShiftCanceled(A, id, true)).toEqual({ ok: false, reason: "received" });
    expect(await deleteShift(A, id)).toEqual({ ok: false, reason: "locked" });
    // Banco também recusa (mesmo sem a checagem do app).
    expect(await asUser(A.id, "update public.pl_shifts set amount_cents = 1 where id = $1", [id]).catch((e) => e.code)).toBe("P0001");
    expect(await asUser(A.id, "update public.pl_shifts set status = 'cancelado' where id = $1", [id]).catch((e) => e.code)).toBe("P0001");
    expect(await asUser(A.id, "delete from public.pl_shifts where id = $1", [id]).catch((e) => e.code)).toBe("P0001");
    expect(await undoReceipt(A, id)).toMatchObject({ ok: true });
    expect(await updateShift(A, id, { amount: 130000, hours: null, notes: null, cnpjId: null, expectedPayDate: null, confirmOverlap: true })).toMatchObject({ ok: true });
    const ev = await getShiftEvents(A, id);
    expect(ev.find((e) => e.action === "recebimento_desfeito")?.details).toMatchObject({ recebido_em: today, valor: 120000 });
    // Realizado: cancelar exige desfazer a realização.
    await setShiftDone(A, id, true);
    expect(await setShiftCanceled(A, id, true)).toEqual({ ok: false, reason: "locked", detail: "realizado" });
    expect(await asUser(A.id, "update public.pl_shifts set status = 'cancelado' where id = $1", [id]).catch((e) => e.code)).toBe("P0001");
    await setShiftDone(A, id, false);
    expect(await setShiftCanceled(A, id, true)).toMatchObject({ ok: true });
  });

  it("dividir a série preserva o plantão recebido", async () => {
    const t = await newType("Série recebida");
    const s = (await createSeries(A, { typeId: t, weekdays: [4], intervalWeeks: 1, startDate: "2026-10-01", endDate: null, amount: 100000, cnpjId: null, hours: null, notes: null })) as { id: string };
    const future = (await listShifts(A, "2026-11-01", "2026-11-30")).filter((x) => x.typeId === t)[0];
    await receiveShift(A, future.id, today);
    await splitSeries(A, s.id, "2026-10-15", { typeId: t, weekdays: [4], intervalWeeks: 1, startDate: "2026-10-15", endDate: null, amount: 150000, cnpjId: null, hours: null, notes: null });
    const after = (await listShifts(A, "2026-11-01", "2026-11-30")).filter((x) => x.typeId === t);
    expect(after.find((x) => x.id === future.id)).toMatchObject({ amountCents: 100000, receivedOn: today });
    expect(after.filter((x) => x.date === future.date).length).toBe(1);
    expect(after.filter((x) => x.id !== future.id).every((x) => x.amountCents === 150000)).toBe(true);
  });

  it("isolamento: B não marca, não recebe e não desfaz nada de A", async () => {
    const t = await newType("Isolado");
    const id = await add(t, addDays(today, -1), "500,00");
    expect(await setShiftDone(B, id, true)).toEqual({ ok: false, reason: "not_found" });
    expect(await receiveShift(B, id, today)).toEqual({ ok: false, reason: "not_found" });
    expect(await undoReceipt(B, id)).toEqual({ ok: false, reason: "not_found" });
    const { from, to } = monthRange(yearMonthOf(today));
    expect((await receivedInPeriod(B, from, to, t)).count).toBe(0);
  });
});
