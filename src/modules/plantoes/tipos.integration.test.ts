import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { asUser, cleanupPlantoes, TAG, testUsers } from "../../../test/integration-helpers";
import { createShift, createType, deleteShift, deleteType, getShiftEvents, listShifts, listTypes, setShiftCanceled, updateShift, updateType } from "./data";
import { setTypeArchivedWithSeries } from "./series-data";

const setTypeArchived = (user: typeof A, id: string, archived: boolean) => setTypeArchivedWithSeries(user, id, archived, true);
import { shiftSchema, typeSchema } from "./domain/schemas";

/** Etapa 10 no Neon real (código do servidor + papel do app). Dados fictícios. */
const { A, B } = testUsers();
const types: string[] = [];

afterAll(() => cleanupPlantoes(types));

async function newType(name: string, extra: Partial<Record<string, string>> = {}, user = A) {
  const r = await createType(user, typeSchema.parse({ name: `${TAG} ${name}`, location: "Hospital Fictício", amount: "1.000,00", color: "#2563eb", notes: "", start: "", end: "", nextDay: "false", cnpjId: "", payDay: "", ...extra }));
  expect(r.ok).toBe(true);
  const id = (r as { id: string }).id;
  types.push(id);
  return id;
}
const shiftInput = (date: string, extra: Partial<Record<string, string>> = {}) =>
  shiftSchema.parse({ date, amount: "1.000,00", notes: "", start: "", end: "", nextDay: "false", cnpjId: "", payMode: "auto", payDate: "", ...extra });
const add = (typeId: string, date: string, extra: Partial<Record<string, string>> = {}, opts: { requestId?: string; confirmOverlap?: boolean } = {}, user = A) =>
  createShift(user, typeId, { ...shiftInput(date, extra), requestId: opts.requestId ?? randomUUID(), confirmOverlap: opts.confirmOverlap ?? false });

describe("Etapa 10 — tipos e ocorrências (Neon real)", () => {
  it("tipos: nome único, horários noturno e 24 h, arquivar impede inclusão, excluir só sem vínculos", async () => {
    const night = await newType("Noturno", { start: "19:00", end: "07:00", nextDay: "true" });
    const day24 = await newType("24 horas", { start: "07:00", end: "07:00", nextDay: "true", amount: "2.000,00" });
    const list = await listTypes(A);
    expect(list.find((t) => t.id === night)?.hours).toEqual({ start: "19:00", end: "07:00", nextDay: true });
    expect(list.find((t) => t.id === day24)).toMatchObject({ hours: { start: "07:00", end: "07:00", nextDay: true }, amountCents: 200000 });
    expect(await createType(A, typeSchema.parse({ name: `${TAG} noturno`, location: "", amount: "1", color: "#2563eb", notes: "", start: "", end: "", nextDay: "false", cnpjId: "", payDay: "" }))).toEqual({
      ok: false,
      reason: "duplicate_name",
    });
    expect(await setTypeArchived(A, day24, true)).toMatchObject({ ok: true });
    expect(await add(day24, "2026-10-10")).toEqual({ ok: false, reason: "type_archived" });
    expect(await setTypeArchived(A, day24, false)).toMatchObject({ ok: true });
    const empty = await newType("Sem vínculos");
    expect(await deleteType(A, empty)).toEqual({ ok: true });
    expect(await add(night, "2026-10-10", { start: "19:00", end: "07:00", nextDay: "true" })).toMatchObject({ ok: true });
    expect(await deleteType(A, night)).toEqual({ ok: false, reason: "has_links" });
  });

  it("duplo envio e concorrência com o mesmo formulário criam um único plantão", async () => {
    const t = await newType("Duplo envio");
    const requestId = randomUUID();
    const [r1, r2] = await Promise.all([add(t, "2026-10-11", {}, { requestId }), add(t, "2026-10-11", {}, { requestId })]);
    expect(r1.ok && r2.ok).toBe(true);
    expect(await add(t, "2026-10-11", {}, { requestId })).toMatchObject({ ok: true });
    expect((await listShifts(A, "2026-10-11", "2026-10-11")).filter((s) => s.typeId === t).length).toBe(1);
  });

  it("vários no mesmo dia; sobreposição pede confirmação (inclui o noturno da véspera) e não bloqueia", async () => {
    const t = await newType("Sobreposição");
    expect(await add(t, "2026-10-12", { start: "19:00", end: "07:00", nextDay: "true" })).toMatchObject({ ok: true });
    expect(await add(t, "2026-10-13", { start: "13:00", end: "19:00" })).toMatchObject({ ok: true });
    const clash = await add(t, "2026-10-13", { start: "06:00", end: "14:00" });
    expect(clash).toMatchObject({ ok: false, reason: "needs_confirmation", count: 2 });
    expect(await add(t, "2026-10-13", { start: "06:00", end: "14:00" }, { confirmOverlap: true })).toMatchObject({ ok: true });
    expect(await add(t, "2026-10-13")).toMatchObject({ ok: true }); // sem horário: sem aviso
    expect((await listShifts(A, "2026-10-13", "2026-10-13")).filter((s) => s.typeId === t).length).toBe(3);
  });

  it("mudar o padrão do tipo não altera plantões existentes; edição individual vai para o histórico", async () => {
    const t = await newType("Padrão", { amount: "900,00", start: "07:00", end: "19:00" });
    const r = await add(t, "2026-10-14", { amount: "900,00", start: "07:00", end: "19:00" });
    const id = (r as { id: string }).id;
    await updateType(A, t, typeSchema.parse({ name: `${TAG} Padrão`, location: "", amount: "1.500,00", color: "#16a34a", notes: "Novo padrão", start: "19:00", end: "07:00", nextDay: "true", cnpjId: "", payDay: "" }));
    const [s] = (await listShifts(A, "2026-10-14", "2026-10-14")).filter((x) => x.id === id);
    expect(s).toMatchObject({ amountCents: 90000, hours: { start: "07:00", end: "19:00", nextDay: false }, notes: null });
    const { date: _d, ...rest } = shiftInput("2026-10-14", { amount: "950,00", start: "07:00", end: "19:00", notes: "Troca de horário" });
    void _d;
    expect(await updateShift(A, id, { ...rest, confirmOverlap: true })).toMatchObject({ ok: true });
    const ev = await getShiftEvents(A, id);
    expect(ev.map((e) => e.action)).toEqual(["criado", "editado"]);
    expect(ev[1].details).toMatchObject({ valor: { de: 90000, para: 95000 }, observacao_alterada: true });
  });

  it("cancelar e restaurar mantêm a ocorrência; excluir só agendado; histórico sobrevive à exclusão", async () => {
    const t = await newType("Cancelamento");
    const id = ((await add(t, "2026-10-15")) as { id: string }).id;
    expect(await setShiftCanceled(A, id, true)).toMatchObject({ ok: true });
    expect((await listShifts(A, "2026-10-15", "2026-10-15")).find((s) => s.id === id)).toMatchObject({ status: "cancelado" });
    expect(await deleteShift(A, id)).toEqual({ ok: false, reason: "locked" });
    expect(await setShiftCanceled(A, id, false)).toMatchObject({ ok: true });
    expect(await deleteShift(A, id)).toEqual({ ok: true });
    const kept = await asUser<{ action: string }>(A.id, "select action from public.pl_events where type_id = $1 order by created_at", [t]);
    expect(kept.map((e) => e.action)).toEqual(["criado", "cancelado", "restaurado", "excluido"]);
  });

  it("isolamento: B não lê, não altera e não usa o tipo de A", async () => {
    const t = await newType("Isolado");
    const id = ((await add(t, "2026-10-16")) as { id: string }).id;
    expect((await listTypes(B)).some((x) => x.id === t)).toBe(false);
    expect((await listShifts(B, "2026-10-16", "2026-10-16")).some((s) => s.id === id)).toBe(false);
    expect(await add(t, "2026-10-16", {}, {}, B)).toEqual({ ok: false, reason: "not_found" });
    expect(await setShiftCanceled(B, id, true)).toEqual({ ok: false, reason: "not_found" });
    expect(await deleteShift(B, id)).toEqual({ ok: false, reason: "not_found" });
    expect(await getShiftEvents(B, id)).toEqual([]);
  });
});
