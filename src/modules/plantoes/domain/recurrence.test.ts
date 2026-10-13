import { describe, expect, it } from "vitest";
import { describeRule, maskOf, occurrencesBetween, shiftWeekdays, sundayOf, weekdayOf, weekdaysOf } from "./recurrence";

describe("recorrência semanal de plantões", () => {
  it("dia da semana e domingo da semana", () => {
    expect(weekdayOf("2026-10-01")).toBe(4); // quinta
    expect(weekdayOf("2026-10-04")).toBe(0); // domingo
    expect(sundayOf("2026-10-03")).toBe("2026-09-27");
    expect(weekdaysOf(maskOf([4, 1]))).toEqual([1, 4]);
  });

  it("toda quinta, atravessando fim de mês e virada de ano", () => {
    const rule = { startDate: "2026-12-03", intervalWeeks: 1, weekdays: [4], endDate: null };
    expect(occurrencesBetween(rule, "2026-12-20", "2027-01-15")).toEqual(["2026-12-24", "2026-12-31", "2027-01-07", "2027-01-14"]);
  });

  it("semanas alternadas com âncora estável (independe da janela consultada)", () => {
    const rule = { startDate: "2026-10-01", intervalWeeks: 2, weekdays: [4], endDate: null };
    const all = occurrencesBetween(rule, "2026-10-01", "2026-12-31");
    expect(all.slice(0, 4)).toEqual(["2026-10-01", "2026-10-15", "2026-10-29", "2026-11-12"]);
    // Consultar só novembro (ou começando numa semana "fora" do ciclo) dá as mesmas datas.
    expect(occurrencesBetween(rule, "2026-11-01", "2026-11-30")).toEqual(["2026-11-12", "2026-11-26"]);
    expect(occurrencesBetween(rule, "2026-10-08", "2026-10-31")).toEqual(["2026-10-15", "2026-10-29"]);
    expect(new Set([...all, ...occurrencesBetween(rule, "2026-11-01", "2026-12-31")]).size).toBe(all.length);
  });

  it("vários dias, início no meio da semana, data final e fevereiro bissexto", () => {
    const rule = { startDate: "2028-02-23", intervalWeeks: 1, weekdays: [2, 4], endDate: "2028-03-07" }; // ter e qui
    expect(occurrencesBetween(rule, "2028-02-01", "2028-03-31")).toEqual(["2028-02-24", "2028-02-29", "2028-03-02", "2028-03-07"]);
    expect(occurrencesBetween({ ...rule, startDate: "2028-03-08" }, "2028-03-01", "2028-03-31")).toEqual([]);
  });

  it("a cada 3 semanas a partir de um sábado", () => {
    expect(occurrencesBetween({ startDate: "2026-10-03", intervalWeeks: 3, weekdays: [6], endDate: null }, "2026-10-01", "2026-11-30")).toEqual(["2026-10-03", "2026-10-24", "2026-11-14"]);
  });

  it("descrição e deslocamento de dias", () => {
    expect(describeRule({ startDate: "2026-10-01", intervalWeeks: 1, weekdays: [4], endDate: null })).toBe("Toda quinta, desde 01/10/2026");
    expect(describeRule({ startDate: "2026-10-01", intervalWeeks: 2, weekdays: [1, 3, 5], endDate: "2026-12-31" })).toBe("A cada 2 semanas: segunda, quarta e sexta, desde 01/10/2026 até 31/12/2026");
    expect(describeRule({ startDate: "2026-10-03", intervalWeeks: 1, weekdays: [6], endDate: null })).toBe("Todo sábado, desde 03/10/2026");
    expect(describeRule({ startDate: "2026-10-03", intervalWeeks: 1, weekdays: [1, 4], endDate: null })).toBe("Toda semana: segunda e quinta, desde 03/10/2026");
    expect(shiftWeekdays([4], 1)).toEqual([5]);
    expect(shiftWeekdays([6], 2)).toEqual([1]);
    expect(shiftWeekdays([0], -1)).toEqual([6]);
  });
});
