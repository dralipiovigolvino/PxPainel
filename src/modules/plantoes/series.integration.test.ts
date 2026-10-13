import { afterAll, describe, expect, it } from "vitest";
import { asUser, cleanupPlantoes, TAG, testUsers } from "../../../test/integration-helpers";
import { createType, deleteShift, getShiftEvents, listShifts, setShiftCanceled, updateShift } from "./data";
import { weekdayOf } from "./domain/recurrence";
import { typeSchema } from "./domain/schemas";
import {
  createSeries,
  endSeries,
  ensureGeneratedThrough,
  listSeries,
  moveSeriesFrom,
  moveShift,
  plGenerationWindow,
  resumeSeries,
  seriesImpact,
  setTypeArchivedWithSeries,
  splitSeries,
  type SeriesInput,
} from "./series-data";

/** Etapa 11 no Neon real (código do servidor + papel do app). Dados fictícios. */
const { A, B } = testUsers();
const types: string[] = [];

afterAll(() => cleanupPlantoes(types));

async function newType(name: string, user = A) {
  const r = await createType(user, typeSchema.parse({ name: `${TAG} ${name}`, location: "", amount: "1.000,00", color: "#2563eb", notes: "", start: "", end: "", nextDay: "false", cnpjId: "", payDay: "" }));
  const id = (r as { id: string }).id;
  types.push(id);
  return id;
}
const series = (typeId: string, partial: Partial<SeriesInput> & Pick<SeriesInput, "weekdays" | "startDate">): SeriesInput => ({
  typeId,
  intervalWeeks: 1,
  cnpjId: null,
  endDate: null,
  amount: 100000,
  hours: { start: "19:00", end: "07:00", nextDay: true },
  notes: null,
  ...partial,
});
const shiftsOf = async (typeId: string, from = "2026-01-01", to = "2028-12-31") => (await listShifts(A, from, to)).filter((s) => s.typeId === typeId);
const horizon = () => plGenerationWindow("2000-01-01").target;

describe("Etapa 11 — recorrências, exceções e trocas (Neon real)", () => {
  it("toda quinta até o horizonte; virada de ano; geração repetida e concorrente não duplica", async () => {
    const t = await newType("Quintas");
    const r = await createSeries(A, series(t, { weekdays: [4], startDate: "2026-12-03" }));
    expect(r.ok).toBe(true);
    const all = await shiftsOf(t);
    expect(all.every((s) => weekdayOf(s.date) === 4 && s.seriesId && s.originalDate === s.date)).toBe(true);
    expect(all.slice(0, 6).map((s) => s.date)).toEqual(["2026-12-03", "2026-12-10", "2026-12-17", "2026-12-24", "2026-12-31", "2027-01-07"]);
    expect(all.at(-1)!.date <= horizon()).toBe(true);
    const before = all.length;
    const results = await Promise.all([ensureGeneratedThrough(A, horizon()), ensureGeneratedThrough(A, horizon()), ensureGeneratedThrough(A, horizon())]);
    expect(results.reduce((a, b) => a + b, 0)).toBe(0);
    expect((await shiftsOf(t)).length).toBe(before);
    // Ampliar o alvo em paralelo também não duplica.
    const far = "2028-06-30";
    await Promise.all([ensureGeneratedThrough(A, far), ensureGeneratedThrough(A, far)]);
    const dates = (await shiftsOf(t)).map((s) => s.date);
    expect(new Set(dates).size).toBe(dates.length);
    expect(dates.at(-1)).toBe("2028-06-29");
  });

  it("semanas alternadas com âncora estável", async () => {
    const t = await newType("Alternadas");
    await createSeries(A, series(t, { weekdays: [4], intervalWeeks: 2, startDate: "2026-10-01" }));
    const dates = (await shiftsOf(t, "2026-10-01", "2026-12-31")).map((s) => s.date);
    expect(dates).toEqual(["2026-10-01", "2026-10-15", "2026-10-29", "2026-11-12", "2026-11-26", "2026-12-10", "2026-12-24"]);
  });

  it("mover entre meses mantém id e data original; original não reaparece; troca vai para o histórico", async () => {
    const t = await newType("Mover");
    await createSeries(A, series(t, { weekdays: [4], startDate: "2026-10-01" }));
    const target = (await shiftsOf(t)).find((s) => s.date === "2026-10-29")!;
    expect(await moveShift(A, target.id, "2026-11-02", "Troca com colega fictício")).toMatchObject({ ok: true });
    expect(await moveShift(A, target.id, "2026-11-02", null)).toEqual({ ok: false, reason: "nothing_to_do" });
    await ensureGeneratedThrough(A, "2027-12-31");
    const after = await shiftsOf(t);
    const moved = after.find((s) => s.id === target.id)!;
    expect(moved).toMatchObject({ date: "2026-11-02", originalDate: "2026-10-29", moved: true });
    expect(after.some((s) => s.date === "2026-10-29")).toBe(false);
    const ev = await getShiftEvents(A, target.id);
    expect(ev.at(-1)).toMatchObject({ action: "movido", details: { de: "2026-10-29", para: "2026-11-02", observacao: "Troca com colega fictício" } });
  });

  it("excluir cria exceção (não recria); cancelar mantém a linha (não duplica)", async () => {
    const t = await newType("Exceções");
    await createSeries(A, series(t, { weekdays: [1], startDate: "2026-10-05" }));
    const list = await shiftsOf(t);
    const del = list.find((s) => s.date === "2026-10-12")!;
    const can = list.find((s) => s.date === "2026-10-19")!;
    expect(await deleteShift(A, del.id)).toEqual({ ok: true });
    expect(await setShiftCanceled(A, can.id, true)).toMatchObject({ ok: true });
    await ensureGeneratedThrough(A, "2027-12-31");
    const after = await shiftsOf(t);
    expect(after.some((s) => s.date === "2026-10-12")).toBe(false);
    expect(after.filter((s) => s.date === "2026-10-19").map((s) => s.status)).toEqual(["cancelado"]);
    expect((await asUser<{ n: number }>(A.id, "select count(*)::int as n from public.pl_series_exceptions where original_date = '2026-10-12'"))[0].n).toBeGreaterThanOrEqual(1);
  });

  it("'este e os próximos': prévia, preserva movidos e alterados, copia exceções, sem duplicar", async () => {
    const t = await newType("Dividir");
    const created = await createSeries(A, series(t, { weekdays: [3], startDate: "2026-10-07" }));
    const seriesId = (created as { id: string }).id;
    const list = await shiftsOf(t);
    const edited = list.find((s) => s.date === "2026-11-04")!;
    const movedOne = list.find((s) => s.date === "2026-11-11")!;
    const excluded = list.find((s) => s.date === "2026-11-18")!;
    await updateShift(A, edited.id, { amount: 123400, hours: edited.hours, notes: "Valor combinado (fictício)", cnpjId: null, expectedPayDate: null, confirmOverlap: true });
    await moveShift(A, movedOne.id, "2026-11-12", null);
    await deleteShift(A, excluded.id);
    const total = (await shiftsOf(t, "2026-10-21", "2099-12-31")).length;
    const impact = await seriesImpact(A, seriesId, "2026-10-21");
    expect(impact).toMatchObject({ replaceCount: total - 2, replaceFrom: "2026-10-21", preservedCount: 2 });
    const r = await splitSeries(A, seriesId, "2026-10-21", series(t, { weekdays: [3], startDate: "2026-10-21", amount: 150000 }));
    expect(r.ok).toBe(true);
    const after = await shiftsOf(t);
    expect(after.filter((s) => s.date < "2026-10-21").every((s) => s.amountCents === 100000)).toBe(true);
    expect(after.find((s) => s.date === "2026-10-28")?.amountCents).toBe(150000);
    expect(after.find((s) => s.id === edited.id)).toMatchObject({ amountCents: 123400, date: "2026-11-04" });
    expect(after.find((s) => s.id === movedOne.id)).toMatchObject({ date: "2026-11-12", originalDate: "2026-11-11" });
    expect(after.some((s) => s.date === "2026-11-11" || s.date === "2026-11-18")).toBe(false);
    const wednesdays = after.filter((s) => weekdayOf(s.date) === 3).map((s) => s.originalDate);
    expect(new Set(wednesdays).size).toBe(wednesdays.length);
  });

  it("encerrar remove futuras substituíveis e mantém as preservadas", async () => {
    const t = await newType("Encerrar");
    const s = (await createSeries(A, series(t, { weekdays: [5], startDate: "2026-10-02" }))) as { id: string };
    const keep = (await shiftsOf(t)).find((x) => x.date === "2026-12-04")!;
    await updateShift(A, keep.id, { amount: 99900, hours: keep.hours, notes: null, cnpjId: null, expectedPayDate: null, confirmOverlap: true });
    expect(await seriesImpact(A, s.id, "2026-11-30", false)).toMatchObject({ preservedCount: 1 });
    expect(await endSeries(A, s.id, "2026-11-30")).toMatchObject({ ok: true });
    await ensureGeneratedThrough(A, "2027-12-31");
    const dates = (await shiftsOf(t)).map((x) => x.date);
    expect(dates.filter((d) => d > "2026-11-30")).toEqual(["2026-12-04"]);
  });

  it("arquivar tipo com série pede confirmação e suspende; restaurar não retoma; retomada explícita", async () => {
    const t = await newType("Arquivar");
    const s = (await createSeries(A, series(t, { weekdays: [6], startDate: "2026-10-03" }))) as { id: string };
    expect(await setTypeArchivedWithSeries(A, t, true, false)).toEqual({ ok: false, reason: "needs_confirmation", count: 1 });
    expect(await setTypeArchivedWithSeries(A, t, true, true)).toMatchObject({ ok: true, count: 1 });
    const n = (await shiftsOf(t)).length;
    await ensureGeneratedThrough(A, "2028-12-31");
    expect((await shiftsOf(t)).length).toBe(n);
    expect(await setTypeArchivedWithSeries(A, t, false, false)).toMatchObject({ ok: true, count: 1 });
    expect((await listSeries(A)).find((x) => x.id === s.id)?.suspended).toBe(true);
    expect(await resumeSeries(A, s.id, "2028-01-01")).toMatchObject({ ok: true });
    await ensureGeneratedThrough(A, "2028-03-31");
    const dates = (await shiftsOf(t)).map((x) => x.date);
    expect(dates.some((d) => d > horizon() && d < "2028-01-01")).toBe(false);
    expect(dates.filter((d) => d >= "2028-01-01" && d <= "2028-01-31")).toEqual(["2028-01-01", "2028-01-08", "2028-01-15", "2028-01-22", "2028-01-29"]);
  });

  it("mover a série 'este e os próximos' (quinta → sexta) a partir de uma ocorrência", async () => {
    const t = await newType("Mover série");
    await createSeries(A, series(t, { weekdays: [4], startDate: "2026-10-01" }));
    const pivot = (await shiftsOf(t)).find((s) => s.date === "2026-10-15")!;
    expect(await moveSeriesFrom(A, pivot.id, "2026-10-16", "Mudou o dia fixo", "proximas")).toMatchObject({ ok: true });
    const dates = (await shiftsOf(t, "2026-10-01", "2026-11-30")).map((s) => s.date);
    expect(dates).toEqual(["2026-10-01", "2026-10-08", "2026-10-16", "2026-10-23", "2026-10-30", "2026-11-06", "2026-11-13", "2026-11-20", "2026-11-27"]);
  });

  it("isolamento: B não cria série com o tipo de A, não move nem vê plantões de A", async () => {
    const t = await newType("Isolado");
    await createSeries(A, series(t, { weekdays: [2], startDate: "2026-10-06" }));
    const one = (await shiftsOf(t))[0];
    expect(await createSeries(B, series(t, { weekdays: [2], startDate: "2026-10-06" }))).toEqual({ ok: false, reason: "not_found" });
    expect(await moveShift(B, one.id, "2026-10-07", null)).toEqual({ ok: false, reason: "not_found" });
    expect((await listSeries(B)).some((s) => s.typeId === t)).toBe(false);
    expect((await listShifts(B, "2026-10-01", "2026-12-31")).some((s) => s.typeId === t)).toBe(false);
  });
});
