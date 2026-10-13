import { describe, expect, it } from "vitest";
import { formatCents } from "@/lib/money";
import { buildSections, describeSummary, nextDaysRange } from "./aggregate";
import type { DashboardItem } from "./contract";

const item = (p: Partial<DashboardItem> & Pick<DashboardItem, "id" | "source" | "type" | "section" | "date">): DashboardItem => ({
  key: `${p.source}:${p.type}:${p.id}`,
  kind: p.source === "plantoes" ? "compromisso" : "pendencia",
  status: "hoje",
  title: p.id,
  detail: null,
  amount: { kind: "none" },
  href: "/",
  actions: [],
  ...p,
});

describe("dashboard — agregação", () => {
  const today = "2026-10-31";
  const results = [
    {
      ok: true as const,
      data: {
        source: "financas" as const,
        coverage: { generationTarget: null, note: null },
        items: [
          item({ id: "conta100", source: "financas", type: "conta", section: "hoje", date: today, amount: { kind: "known", cents: 10000 } }),
          item({ id: "fatura300", source: "financas", type: "fatura", section: "hoje", date: today, amount: { kind: "known", cents: 30000 } }),
          item({ id: "variavel", source: "financas", type: "conta", section: "hoje", date: today, amount: { kind: "unknown" } }),
          item({ id: "antiga", source: "financas", type: "conta", section: "atrasados", date: "2026-09-10", amount: { kind: "known", cents: 5000 } }),
        ],
      },
    },
    { ok: false as const, source: "followup" as const },
    {
      ok: true as const,
      data: {
        source: "plantoes" as const,
        coverage: { generationTarget: "2027-10-31", note: null },
        items: [item({ id: "p1", source: "plantoes", type: "plantao", section: "hoje", date: today })],
      },
    },
  ];
  it("hoje: 3 pagamentos, R$ 400 conhecidos + 1 a informar (sem somar cobranças de novo) e 1 plantão", () => {
    const { sections } = buildSections(results);
    const hoje = sections.find((s) => s.section === "hoje")!;
    expect(hoje.summary).toMatchObject({ total: 4, payments: { count: 3, knownCents: 40000n, unknownCount: 1 }, shifts: 1 });
    expect(describeSummary(hoje.summary, formatCents)?.replace(/ /g, " ")).toBe("R$ 400,00 a pagar + 1 sem valor");
  });
  it("falha de um módulo é sinalizada (não vira 'nenhuma pendência'); geração pendente é informada", () => {
    const r = buildSections(results);
    expect(r.failed).toEqual(["followup"]);
    expect(r.pendingGeneration).toBe(true);
  });
  it("ordem estável: data, módulo, tipo, título, id", () => {
    const { sections } = buildSections(results);
    expect(sections.find((s) => s.section === "hoje")!.items.map((i) => i.id)).toEqual(["conta100", "variavel", "fatura300", "p1"]);
  });
  it("só valores a informar e sem valores desconhecidos", () => {
    expect(describeSummary({ total: 1, payments: { count: 1, knownCents: 0n, unknownCount: 1 }, followups: 0, shifts: 0, exams: 0, notices: 0, attention: 0 }, formatCents)).toBe("1 sem valor");
    expect(describeSummary({ total: 2, payments: { count: 2, knownCents: 15000n, unknownCount: 0 }, followups: 2, shifts: 0, exams: 0, notices: 0, attention: 0 }, formatCents)?.replace(/ /g, " ")).toBe("R$ 150,00 a pagar");
    expect(describeSummary({ total: 2, payments: { count: 0, knownCents: 0n, unknownCount: 0 }, followups: 2, shifts: 0, exams: 0, notices: 0, attention: 0 }, formatCents)).toBeNull();
  });
  it("próximos 7 dias: de amanhã até hoje + 7 (virada de mês)", () => {
    expect(nextDaysRange("2026-10-31")).toEqual({ from: "2026-11-01", to: "2026-11-07" });
  });
});
