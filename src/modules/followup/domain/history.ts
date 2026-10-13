import { formatCivilDate } from "@/lib/dates";
import { stepLabel } from "./messages";

/** Texto do histórico para o usuário (a partir de dados estruturados; sem interpretar HTML). */
export type HistoryLine = { text: string; quote?: string };

const labels = (value: unknown) => (Array.isArray(value) && value.length ? value.map((n) => stepLabel(Number(n))).join(", ") : "nenhuma");
const date = (value: unknown) => (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value) ? formatCivilDate(value.slice(0, 10)) : "?");
const instant = (value: unknown) => (typeof value === "string" && value.length >= 16 ? `${date(value)} às ${value.slice(11, 16)}` : "?");
const tpl = (v: unknown) => {
  const t = (v ?? {}) as { modelo?: string; versao?: number };
  return `"${t.modelo ?? "?"}" (versão ${t.versao ?? "?"})`;
};

const when = (v: unknown) => {
  const w = (v ?? {}) as { data?: unknown; horario?: unknown };
  return `${date(w.data)}${typeof w.horario === "string" ? ` às ${w.horario}` : ""}`;
};

export function describeEvent(action: string, details: Record<string, unknown>): HistoryLine {
  const step = typeof details.etapa === "number" ? stepLabel(details.etapa) : "Etapa";
  switch (action) {
    case "plano_criado":
      return { text: `Acompanhamento gerado com o modelo ${tpl(details)}: ${labels(details.etapas)}.` };
    case "plano_substituido":
      return {
        text: `Pendentes substituídas: modelo ${tpl(details.de)} → ${tpl(details.para)}. Substituídas: ${labels(details.removidas)}; mantidas: ${labels(details.preservadas)}; incluídas: ${labels(details.incluidas)}.`,
      };
    case "plano_cancelado":
      return { text: `Acompanhamento cancelado (${Number(details.pendentes_canceladas ?? 0)} pendente(s) cancelada(s)).` };
    case "consulta_data_corrigida":
      return {
        text: `Data da consulta corrigida de ${date(details.de)} para ${date(details.para)}. Recalculadas: ${labels(details.recalculadas)}; remarcadas mantidas: ${labels(details.remarcadas_preservadas)}; realizadas preservadas: ${labels(details.realizadas_preservadas)}.`,
      };
    case "etapa_realizada":
      return { text: `${step} marcada como realizada${details.com_observacao ? " (com observação)" : ""}.` };
    case "etapa_desfeita":
      return {
        text: `Realização de ${step} desfeita (tinha sido registrada em ${instant(details.realizada_em)}). Texto registrado na ocasião:`,
        quote: typeof details.texto_registrado === "string" ? details.texto_registrado : undefined,
      };
    case "etapa_remarcada":
      return { text: `${step} remarcada de ${date(details.de)} para ${date(details.para)} (data original ${date(details.data_original)}).` };
    case "etapa_cancelada":
      return { text: `${step} cancelada${details.motivo_informado ? " (com motivo)" : ""}.` };
    case "mensagem_ajustada":
      return { text: details.restaurada ? `Texto de ${step} voltou ao do modelo.` : `Texto de ${step} ajustado só nesta etapa.` };
    case "mensagem_copiada":
      return { text: `Mensagem de ${step} copiada (não indica envio).` };
    case "observacao_registrada":
      return { text: details.removida ? `Observação de ${step} removida.` : `Observação de ${step} registrada.` };
    case "prazo_definido": {
      const to = (details.para ?? {}) as { duracao_dias?: number; aviso_dias?: number };
      const from = (details.de ?? {}) as { duracao_dias?: number | null };
      return { text: `Prazo do acompanhamento ${from.duracao_dias == null ? "definido" : "alterado"}: ${to.duracao_dias ?? "?"} dias a partir da consulta, aviso ${to.aviso_dias ?? "?"} dia(s) antes do término.` };
    }
    case "proxima_consulta_agendada":
      return { text: `Próxima consulta agendada para ${when(details)}.` };
    case "proxima_consulta_reagendada":
      return { text: `Próxima consulta reagendada de ${when(details.de)} para ${when(details.para)}.` };
    case "proxima_consulta_cancelada":
      return { text: `Agendamento da próxima consulta (${when(details)}) cancelado.` };
    case "proxima_consulta_confirmada":
      return { text: `Atendimento agendado para ${when(details)} confirmado: consulta registrada, sem acompanhamento automático.` };
    default:
      return { text: "Ação registrada." };
  }
}
