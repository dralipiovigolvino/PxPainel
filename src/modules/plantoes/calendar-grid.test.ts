import { describe, expect, it } from "vitest";
import { addMonths } from "@/lib/dates";
import { buildMonthGrid } from "./calendar-grid";

const datesOf = (week: ReturnType<typeof buildMonthGrid>[number]) =>
  week.map((cell) => cell?.date ?? null);

describe("buildMonthGrid", () => {
  it("monta fevereiro bissexto de 2024 começando na quinta-feira", () => {
    const weeks = buildMonthGrid({ year: 2024, month: 2 });

    expect(weeks).toHaveLength(5);
    expect(datesOf(weeks[0])).toEqual([
      null,
      null,
      null,
      null,
      "2024-02-01",
      "2024-02-02",
      "2024-02-03",
    ]);
    expect(datesOf(weeks[4])).toEqual([
      "2024-02-25",
      "2024-02-26",
      "2024-02-27",
      "2024-02-28",
      "2024-02-29",
      null,
      null,
    ]);
  });

  it("não inclui 29 de fevereiro em ano não bissexto", () => {
    const days = buildMonthGrid({ year: 2026, month: 2 }).flat().filter(Boolean);

    expect(days).toHaveLength(28);
    expect(days.at(-1)?.date).toBe("2026-02-28");
  });

  it("mantém sempre 7 dias por semana, domingo na primeira coluna", () => {
    for (let month = 1; month <= 12; month++) {
      const weeks = buildMonthGrid({ year: 2026, month });
      for (const week of weeks) expect(week).toHaveLength(7);
    }
    // 1º de março de 2026 é um domingo.
    expect(buildMonthGrid({ year: 2026, month: 3 })[0][0]?.date).toBe("2026-03-01");
  });

  it("atravessa a virada de ano nas duas direções", () => {
    const january = addMonths({ year: 2025, month: 12 }, 1);
    expect(january).toEqual({ year: 2026, month: 1 });
    expect(addMonths(january, -1)).toEqual({ year: 2025, month: 12 });

    // 31/12/2025 é quarta-feira; 01/01/2026 é quinta-feira.
    const december = buildMonthGrid({ year: 2025, month: 12 });
    expect(datesOf(december.at(-1)!)).toEqual([
      "2025-12-28",
      "2025-12-29",
      "2025-12-30",
      "2025-12-31",
      null,
      null,
      null,
    ]);
    expect(buildMonthGrid(january)[0][4]?.date).toBe("2026-01-01");
  });
});
