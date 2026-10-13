import { describe, expect, it } from "vitest";
import { matchesFilters, shiftTotals } from "./totals";

describe("totais de plantões — cenário de referência", () => {
  // A realizado R$ 1.000 recebido no mês seguinte; B realizado R$ 800 a receber; C agendado R$ 500; D cancelado R$ 700.
  const shifts = [
    { status: "realizado" as const, amountCents: 100000, receivedOn: "2026-09-05" },
    { status: "realizado" as const, amountCents: 80000, receivedOn: null },
    { status: "agendado" as const, amountCents: 50000, receivedOn: null },
    { status: "cancelado" as const, amountCents: 70000, receivedOn: null },
  ];
  it("valores esperados (calculados à mão)", () => {
    expect(shiftTotals(shifts)).toMatchObject({
      programado: 230000n,
      realizado: 180000n,
      recebidoDoMes: 100000n,
      aReceber: 130000n,
      realizadosAReceber: 80000n,
      agendadosAReceber: 50000n,
      count: 3,
      canceledCount: 1,
    });
  });
  it("Programado = Recebido dos plantões do mês + A receber; A receber = realizados + agendados a receber", () => {
    const t = shiftTotals(shifts);
    expect(t.programado).toBe(t.recebidoDoMes + t.aReceber);
    expect(t.aReceber).toBe(t.realizadosAReceber + t.agendadosAReceber);
  });
  it("recebimento antecipado de agendado conta como recebido, não como realizado", () => {
    const t = shiftTotals([{ status: "agendado", amountCents: 50000, receivedOn: "2026-08-01" }]);
    expect(t).toMatchObject({ programado: 50000n, realizado: 0n, recebidoDoMes: 50000n, aReceber: 0n });
  });
});

describe("filtros", () => {
  const today = "2026-10-02";
  const s = (status: "agendado" | "realizado" | "cancelado", date: string, receivedOn: string | null = null) => ({ typeId: "t1", status, date, receivedOn });
  const f = { typeId: null, situation: "todos" as const, payment: "todos" as const };
  it("situação, a confirmar, pagamento e tipo", () => {
    expect(matchesFilters(s("agendado", "2026-10-01"), { ...f, situation: "a-confirmar" }, today)).toBe(true);
    expect(matchesFilters(s("agendado", "2026-10-02"), { ...f, situation: "a-confirmar" }, today)).toBe(false);
    expect(matchesFilters(s("realizado", "2026-09-01", "2026-09-10"), { ...f, payment: "recebido" }, today)).toBe(true);
    expect(matchesFilters(s("cancelado", "2026-09-01"), { ...f, payment: "a-receber" }, today)).toBe(false);
    expect(matchesFilters(s("agendado", "2026-09-01"), { ...f, typeId: "t2" }, today)).toBe(false);
  });
});
