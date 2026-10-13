import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, cleanupAreas, TAG, testUsers } from "../../../test/integration-helpers";
import { addDays, daysBetween, todayInSaoPaulo } from "@/lib/dates";
import { createArea, deleteEntry, listAreas, markEntryPaid, setAreaArchived, setOccurrenceAmount, updateEntry } from "./data";
import { summarize } from "./domain/analytics";
import { createSeries, endSeries, ensureGeneratedThrough, horizonDate, listSeries, resumeSeries, seriesImpact, splitSeries, type SeriesInput } from "./series-data";

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

const occ = (seriesId: string, user = A) =>
  asUser<{ id: string; occ: string; due: string; amount: string | null; status: string; is_override: boolean; is_variable: boolean }>(
    user.id,
    `select id, to_char(occurrence_date, 'YYYY-MM-DD') as occ, to_char(due_date, 'YYYY-MM-DD') as due, amount_cents::text as amount,
            status, is_override, is_variable
       from public.fin_entries where series_id = $1 order by occurrence_date`,
    [seriesId],
  );

async function createAndGetSeries(input: Omit<SeriesInput, "description" | "category" | "notes"> & { description: string }) {
  const description = `${TAG} ${input.description}`;
  expect(await createSeries(A, { ...input, description, category: null, notes: null })).toEqual({ ok: true });
  const series = (await listSeries(A)).find((s) => s.description === description)!;
  expect(series).toBeTruthy();
  return series;
}

beforeAll(async () => {
  await asUser(A.id, "select 1");
});

// O horizonte acompanha "hoje" (fim do mês atual + 12): as contagens são derivadas dele, não fixadas.
const horizonMonth = () => horizonDate().slice(0, 7);
const monthsInclusive = (from: string, to: string) => {
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  return (ty - fy) * 12 + (tm - fm) + 1;
};

afterAll(async () => {
  await cleanupAreas(createdAreas);
});

describe("Etapa 4 — recorrências no Neon real (código do servidor + app_runtime)", () => {
  let areaId: string;
  beforeAll(async () => {
    areaId = await newArea(A, "Casa");
  });

  it("mensal do dia 31: gera até o horizonte, ajusta fim de mês e volta ao 31", async () => {
    const s = await createAndGetSeries({ description: "Aluguel", areaId, amountKind: "fixo", amountCents: 150000, frequency: "mensal", intervalMonths: 1, startDate: "2026-01-31", endDate: null });
    const rows = await occ(s.id);
    expect(rows.slice(0, 4).map((r) => r.occ)).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
    expect(rows.at(-1)!.occ <= horizonDate()).toBe(true);
    expect(rows.length).toBe(monthsInclusive("2026-01", horizonMonth())); // jan/2026 … mês do horizonte
    expect(rows.every((r) => r.amount === "150000" && !r.is_variable && r.due === r.occ)).toBe(true);
  });

  it("gerar de novo e em paralelo não duplica; ampliar horizonte preenche todos os meses intermediários", async () => {
    const s = await createAndGetSeries({ description: "Condomínio", areaId, amountKind: "fixo", amountCents: 50000, frequency: "mensal", intervalMonths: 1, startDate: "2026-09-10", endDate: null });
    const before = (await occ(s.id)).length;
    expect(await ensureGeneratedThrough(A, horizonDate())).toBe(0);
    await Promise.all(Array.from({ length: 6 }, () => ensureGeneratedThrough(A, "2029-12-31")));
    const rows = await occ(s.id);
    const dates = rows.map((r) => r.occ);
    expect(new Set(dates).size).toBe(dates.length); // sem duplicação, inclusive concorrente
    expect(dates.at(-1)).toBe("2029-12-10");
    expect(dates.length).toBe(40); // set/2026 … dez/2029, sem depender de visitar os meses
    expect(before).toBeLessThan(dates.length);
  });

  it("semanal e a cada 2 semanas (14 dias)", async () => {
    const w = await createAndGetSeries({ description: "Feira", areaId, amountKind: "fixo", amountCents: 8000, frequency: "semanal", intervalMonths: 1, startDate: today, endDate: addDays(today, 27) });
    expect((await occ(w.id)).map((r) => r.occ)).toEqual([today, addDays(today, 7), addDays(today, 14), addDays(today, 21)]);
    const q = await createAndGetSeries({ description: "Diarista", areaId, amountKind: "fixo", amountCents: 20000, frequency: "quinzenal", intervalMonths: 1, startDate: "2026-02-20", endDate: "2026-04-30" });
    const dates = (await occ(q.id)).map((r) => r.occ);
    expect(dates).toEqual(["2026-02-20", "2026-03-06", "2026-03-20", "2026-04-03", "2026-04-17"]);
    for (let i = 1; i < dates.length; i++) expect(daysBetween(dates[i - 1], dates[i])).toBe(14);
  });

  it("mover o vencimento de uma ocorrência não a recria; excluir grava exceção", async () => {
    const s = await createAndGetSeries({ description: "Internet", areaId, amountKind: "fixo", amountCents: 9990, frequency: "mensal", intervalMonths: 1, startDate: "2026-10-05", endDate: null });
    const [first, second] = await occ(s.id);
    expect(
      await updateEntry(A, first.id, { description: `${TAG} Internet`, amountCents: 9990, dueDate: "2026-10-12", areaId, category: null, notes: null, paymentMethod: null }),
    ).toEqual({ ok: true });
    expect(await deleteEntry(A, second.id)).toEqual({ ok: true });
    await ensureGeneratedThrough(A, "2030-06-30");
    const rows = await occ(s.id);
    expect(rows.filter((r) => r.occ === "2026-10-05")).toHaveLength(1);
    expect(rows[0]).toMatchObject({ occ: "2026-10-05", due: "2026-10-12", is_override: true });
    expect(rows.some((r) => r.occ === "2026-11-05")).toBe(false);
    const ex = await asUser(A.id, "select to_char(occurrence_date,'YYYY-MM-DD') d from public.fin_series_exceptions where series_id = $1", [s.id]);
    expect(ex).toEqual([{ d: "2026-11-05" }]);
  });

  it("variável: começa sem valor, não vira zero e não pode ser paga até informar", async () => {
    const s = await createAndGetSeries({ description: "Luz", areaId, amountKind: "variavel", amountCents: null, frequency: "mensal", intervalMonths: 1, startDate: "2026-10-15", endDate: "2027-01-15" });
    const rows = await occ(s.id);
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.amount === null && r.is_variable)).toBe(true);
    const sum = summarize(
      rows.map((r) => ({ source: "conta" as const, id: r.id, description: "Luz", dueDate: r.due, areaId, category: null, cents: r.amount === null ? null : BigInt(r.amount), status: "pendente" as const, paymentMethod: null, cardId: null })),
      today,
    );
    expect(sum).toMatchObject({ total: 0n, unknownCount: 4 });
    expect(await markEntryPaid(A, rows[0].id, today)).toEqual({ ok: false, reason: "amount_unknown" });
    expect(await setOccurrenceAmount(A, rows[0].id, 18765)).toEqual({ ok: true });
    expect(await markEntryPaid(A, rows[0].id, today)).toEqual({ ok: true });
    const after = await occ(s.id);
    expect(after[0]).toMatchObject({ amount: "18765", status: "pago" });
    expect(after[1].amount).toBeNull();
  });

  it("'esta e as próximas': substitui pendentes, preserva pagas, personalizadas e exceções, sem duplicar", async () => {
    const s = await createAndGetSeries({ description: "Escola", areaId, amountKind: "fixo", amountCents: 100000, frequency: "mensal", intervalMonths: 1, startDate: "2026-10-10", endDate: null });
    const rows = await occ(s.id); // out/26 … set/27
    // dez: paga; jan: personalizada (vencimento mudado); fev: excluída (exceção)
    const dez = rows.find((r) => r.occ === "2026-12-10")!;
    const jan = rows.find((r) => r.occ === "2027-01-10")!;
    const fev = rows.find((r) => r.occ === "2027-02-10")!;
    expect(await markEntryPaid(A, dez.id, today)).toEqual({ ok: true });
    expect(await updateEntry(A, jan.id, { description: `${TAG} Escola (jan)`, amountCents: 100000, dueDate: "2027-01-15", areaId, category: null, notes: null, paymentMethod: null })).toEqual({ ok: true });
    expect(await deleteEntry(A, fev.id)).toEqual({ ok: true });

    const impact = await seriesImpact(A, s.id, "2026-11-10");
    // nov/26 … horizonte, menos dez (paga), jan (personalizada) e fev (excluída).
    expect(impact).toEqual({ replaceCount: monthsInclusive("2026-11", horizonMonth()) - 3, replaceFrom: "2026-11-10", replaceTo: `${horizonMonth()}-10`, preservedCount: 2 });

    const res = await splitSeries(A, s.id, "2026-11-10", {
      description: `${TAG} Escola`,
      areaId,
      category: null,
      notes: null,
      amountKind: "fixo",
      amountCents: 120000,
      frequency: "mensal",
      intervalMonths: 1,
      startDate: "2026-11-10",
      endDate: null,
    });
    expect(res).toEqual({ ok: true });

    const all = await asUser<{ occ: string; amount: string; status: string; series_id: string; due: string }>(
      A.id,
      `select to_char(e.occurrence_date,'YYYY-MM-DD') occ, e.amount_cents::text amount, e.status, e.series_id, to_char(e.due_date,'YYYY-MM-DD') due
         from public.fin_entries e join public.fin_series s on s.id = e.series_id
        where s.description = $1 order by e.occurrence_date`,
      [`${TAG} Escola`],
    );
    const dates = all.map((r) => r.occ);
    expect(new Set(dates).size).toBe(dates.length); // nenhuma data duplicada entre série antiga e nova
    expect(all.find((r) => r.occ === "2026-10-10")).toMatchObject({ amount: "100000", series_id: s.id }); // passado intacto
    expect(all.find((r) => r.occ === "2026-12-10")).toMatchObject({ amount: "100000", status: "pago" }); // paga preservada
    expect(all.find((r) => r.occ === "2027-01-10")).toMatchObject({ amount: "100000", due: "2027-01-15" }); // personalizada preservada
    expect(dates).not.toContain("2027-02-10"); // exceção respeitada na nova série
    expect(all.find((r) => r.occ === "2026-11-10")).toMatchObject({ amount: "120000", status: "pendente" });
    expect(all.find((r) => r.occ === "2027-03-10")).toMatchObject({ amount: "120000" });
    const old = (await listSeries(A)).find((x) => x.id === s.id)!;
    expect(old.endDate).toBe("2026-11-09");
  });

  it("encerrar remove pendentes futuras e mantém pagas e anteriores", async () => {
    const s = await createAndGetSeries({ description: "Academia", areaId, amountKind: "fixo", amountCents: 12000, frequency: "mensal", intervalMonths: 1, startDate: "2026-09-01", endDate: null });
    const rows = await occ(s.id);
    const paidFuture = rows.find((r) => r.occ === "2027-03-01")!;
    expect(await markEntryPaid(A, paidFuture.id, today)).toEqual({ ok: true });
    expect(await seriesImpact(A, s.id, "2026-12-01")).toMatchObject({ replaceCount: monthsInclusive("2026-12", horizonMonth()) - 1, preservedCount: 1 });
    expect(await endSeries(A, s.id, "2026-11-30")).toEqual({ ok: true });
    await ensureGeneratedThrough(A, "2029-12-31");
    const after = (await occ(s.id)).map((r) => r.occ);
    expect(after).toEqual(["2026-09-01", "2026-10-01", "2026-11-01", "2027-03-01"]);
  });

  it("arquivar área com séries exige confirmação, suspende e não gera; restaurar não retoma; retomada explícita com data", async () => {
    const area2 = await newArea(A, "Arquivável");
    const s = await createAndGetSeries({ description: "Seguro", areaId: area2, amountKind: "fixo", amountCents: 30000, frequency: "mensal", intervalMonths: 1, startDate: "2026-10-20", endDate: null });
    const before = await occ(s.id);
    expect(await setAreaArchived(A, area2, true)).toEqual({ ok: false, reason: "needs_confirmation", count: 1 });
    expect(await setAreaArchived(A, area2, true, true)).toEqual({ ok: true });
    await ensureGeneratedThrough(A, "2030-12-31");
    expect((await occ(s.id)).length).toBe(before.length); // nada novo em área arquivada; existentes preservadas
    expect(await setAreaArchived(A, area2, false)).toEqual({ ok: true, count: 1 });
    expect((await listSeries(A)).find((x) => x.id === s.id)!.suspended).toBe(true);
    await ensureGeneratedThrough(A, "2030-12-31");
    expect((await occ(s.id)).length).toBe(before.length); // restaurar não reativou
    expect(await resumeSeries(A, s.id, "2029-01-01")).toEqual({ ok: true });
    await ensureGeneratedThrough(A, "2029-06-30");
    const dates = (await occ(s.id)).map((r) => r.occ);
    expect(dates.some((d) => d > horizonDate() && d < "2029-01-01")).toBe(false); // intervalo suspenso não preenchido
    expect(dates.filter((d) => d >= "2029-01-01")).toEqual(["2029-01-20", "2029-02-20", "2029-03-20", "2029-04-20", "2029-05-20", "2029-06-20"]);
  });

  it("isolamento: B não vê nem altera séries e ocorrências de A", async () => {
    const s = (await listSeries(A)).find((x) => x.description === `${TAG} Aluguel`)!;
    expect((await listSeries(B)).some((x) => x.id === s.id)).toBe(false);
    expect(await seriesImpact(B, s.id, today)).toBeNull();
    expect(await endSeries(B, s.id, today)).toEqual({ ok: false, reason: "not_found" });
    const bArea = await newArea(B, "Área B");
    expect(
      await splitSeries(B, s.id, "2026-12-31", {
        description: "x",
        areaId: bArea,
        category: null,
        notes: null,
        amountKind: "fixo",
        amountCents: 1,
        frequency: "mensal",
        intervalMonths: 1,
        startDate: "2026-12-31",
        endDate: null,
      }),
    ).toEqual({ ok: false, reason: "not_found" });
    const rowsBefore = await occ(s.id);
    const [firstA] = rowsBefore;
    expect(await deleteEntry(B, firstA.id)).toEqual({ ok: false, reason: "not_found" });
    expect(await setOccurrenceAmount(B, firstA.id, 1)).toEqual({ ok: false, reason: "not_found" });
    expect(await occ(s.id)).toEqual(rowsBefore);
    expect(await occ(s.id, B)).toEqual([]); // B não enxerga as ocorrências de A
  });
});
