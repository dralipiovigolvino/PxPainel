import { formatCivilDate } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { formatRate } from "@/lib/tax";

/** Texto do histórico (a partir de dados estruturados). */
const date = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? formatCivilDate(v.slice(0, 10)) : "?");
const money = (v: unknown) => (typeof v === "number" ? formatCents(v) : "?");
const hours = (v: unknown) => (typeof v === "string" ? v.replace("+1", " (dia seguinte)").replace("-", " → ") : "sem horário");
const pair = (v: unknown, f: (x: unknown) => string) => {
  const p = (v ?? {}) as { de?: unknown; para?: unknown };
  return `${f(p.de)} → ${f(p.para)}`;
};

// Registros anteriores ao CNPJ guardavam a classificação do valor (bruto/líquido).
const kind = (v: unknown) => (v === "bruto" ? "bruto" : v === "liquido" ? "líquido" : "não definido");
const yesNo = (v: unknown) => (v === true ? "sim" : "não");
const forecast = (v: unknown) => (typeof v === "string" ? date(v) : "regra do tipo");
const rate = (v: unknown) => (typeof v === "number" ? formatRate(v) : "?");

export function describePlEvent(action: string, d: Record<string, unknown>): string {
  switch (action) {
    case "criado":
      return `Plantão criado para ${date(d.data)} (${money(d.valor)}).`;
    case "gerado":
      return `Gerado pela recorrência para ${date(d.data)}.`;
    case "editado": {
      const parts = [
        d.valor && `valor ${pair(d.valor, money)}`,
        d.horario && `horário ${pair(d.horario, hours)}`,
        d.cnpj && `recebimento por CNPJ ${pair(d.cnpj, yesNo)}`,
        d.classificacao && `classificação ${pair(d.classificacao, kind)}`,
        d.previsao && `previsão de pagamento ${pair(d.previsao, forecast)}`,
        d.observacao_alterada && "observação alterada",
      ].filter(Boolean);
      return `Alterado individualmente: ${parts.join("; ")}.`;
    }
    case "movido":
      return `Movido de ${date(d.de)} para ${date(d.para)}${d.observacao ? ` — ${String(d.observacao)}` : ""}.`;
    case "cancelado":
      return "Plantão cancelado.";
    case "restaurado":
      return "Plantão restaurado (voltou a agendado).";
    case "excluido":
      return `Plantão de ${date(d.data)} excluído.`;
    case "realizado":
      return "Marcado como realizado.";
    case "realizacao_desfeita":
      return `Realização desfeita (estava marcada em ${typeof d.realizado_em === "string" ? `${date(d.realizado_em)} às ${d.realizado_em.slice(11, 16)}` : "?"}).`;
    case "recebido":
      return `Recebido em ${date(d.recebido_em)} (${money(d.valor)}).`;
    case "recebimento_desfeito":
      return `Recebimento desfeito (estava registrado em ${date(d.recebido_em)}, ${money(d.valor)}).`;
    case "aliquota_atualizada":
      return `Alíquota de imposto estimado atualizada: ${pair(d.aliquota_bp, rate)}.`;
    default:
      return "Ação registrada.";
  }
}
