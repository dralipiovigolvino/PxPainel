import { afterAll, describe, expect, it } from "vitest";
import { asUser, cleanupAreas, TAG, testUsers } from "../../../test/integration-helpers";
import { addMonths, clampedDate, daysInMonth, todayInSaoPaulo, yearMonthOf } from "@/lib/dates";
import { createArea, listAreas } from "./data";
import { generationWindow } from "./domain/recurrence";
import { createSeries, ensureGeneratedThrough, needsGeneration } from "./series-data";

/**
 * Conferência pontual: mês futuro + 12 meses de projeção é gerado por completo; pedidos além do
 * limite de segurança são limitados e sinalizados (sem gerar além nem repetir a geração a cada visita).
 */
const { A } = testUsers();
const createdAreas: string[] = [];
const today = todayInSaoPaulo();
const endOf = (months: number) => {
  const ym = addMonths(yearMonthOf(today), months);
  return clampedDate(ym, daysInMonth(ym.year, ym.month));
};

afterAll(() => cleanupAreas(createdAreas));

describe("Finanças — cobertura da geração para meses distantes (Neon real)", () => {
  it("mês selecionado +24 com projeção de 12 meses: todas as ocorrências mensais existem", async () => {
    const name = `${TAG} Cobertura`;
    expect(await createArea(A, { name, color: "#2563eb" })).toEqual({ ok: true });
    const areaId = (await listAreas(A)).find((a) => a.name === name)!.id;
    createdAreas.push(areaId);
    const start = `${today.slice(0, 7)}-01`;
    expect(
      await createSeries(A, {
        areaId,
        description: `${TAG} Mensal`,
        category: null,
        notes: null,
        amountKind: "fixo",
        amountCents: 1000,
        frequency: "mensal",
        intervalMonths: 1,
        startDate: start,
        endDate: null,
      }),
    ).toEqual({ ok: true });
    const count = async () =>
      (await asUser<{ n: number; last: string }>(A.id, "select count(*)::int n, to_char(max(due_date), 'YYYY-MM-DD') as last from public.fin_entries where area_id = $1", [areaId]))[0];

    // Tela: mês de hoje +24, projeção até +36.
    const near = generationWindow(endOf(36), today);
    expect(near.truncated).toBe(false);
    expect(await needsGeneration(A, near.target)).toBe(true);
    await ensureGeneratedThrough(A, near.target);
    expect(await needsGeneration(A, near.target)).toBe(false);
    expect(await count()).toEqual({ n: 37, last: `${near.target.slice(0, 7)}-01` });

    // Além do limite (10 anos): gera até o limite, sinaliza e não fica pedindo geração de novo.
    const far = generationWindow(endOf(140), today);
    expect(far).toMatchObject({ truncated: true, target: endOf(120) });
    await ensureGeneratedThrough(A, far.target);
    expect(await needsGeneration(A, far.target)).toBe(false);
    expect(await count()).toEqual({ n: 121, last: `${endOf(120).slice(0, 7)}-01` });
    expect(await ensureGeneratedThrough(A, endOf(140))).toBe(0);
  }, 120_000);
});
