import { formatCivilDate, type CivilDate } from "@/lib/dates";

/**
 * Mensagens dos acompanhamentos: texto simples com variáveis entre chaves.
 * Nada é interpretado como HTML ou código; a interface exibe como texto (quebras preservadas).
 */

export const MESSAGE_MAX = 2000;

export const VARIABLES = [
  { key: "nome", label: "{nome}", help: "nome completo do paciente" },
  { key: "data_consulta", label: "{data_consulta}", help: "data da consulta (DD/MM/AAAA)" },
  { key: "dia_followup", label: "{dia_followup}", help: "etapa, como D0, D1, D7" },
] as const;

const KNOWN = new Set<string>(VARIABLES.map((v) => v.key));
const TOKEN = /\{([^{}\n]*)\}/g;

/** Variáveis entre chaves que não existem (ex.: "{medico}"), sem repetição, na ordem em que aparecem. */
export function unknownVariables(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(TOKEN)) {
    const name = match[1];
    if (!KNOWN.has(name) && !found.includes(`{${name}}`)) found.push(`{${name}}`);
  }
  return found;
}

/** Rótulo da etapa: "D0", "D7"… (sempre o intervalo original, mesmo se remarcada). */
export const stepLabel = (dayOffset: number) => `D${dayOffset}`;

export type MessageContext = { patientName: string; consultDate: CivilDate; dayOffset: number };

/** Substitui só as variáveis conhecidas; texto restante fica como está (validado antes de salvar). */
export function renderMessage(text: string, ctx: MessageContext): string {
  const values: Record<string, string> = {
    nome: ctx.patientName,
    data_consulta: formatCivilDate(ctx.consultDate),
    dia_followup: stepLabel(ctx.dayOffset),
  };
  return text.replace(TOKEN, (whole, name: string) => (name in values ? values[name] : whole));
}

/** Normaliza o texto vindo do formulário: quebras \r\n → \n, apara as pontas. */
export function normalizeMessage(text: string): string {
  return text.replace(/\r\n?/g, "\n").trim();
}

const MESSAGE_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

/** Erro de validação de uma mensagem, ou null. Mesmas regras do banco + variáveis. */
export function messageError(text: string): string | null {
  if (text.length === 0) return "Escreva a mensagem.";
  if ([...text].length > MESSAGE_MAX) return `Use no máximo ${MESSAGE_MAX} caracteres.`;
  if (MESSAGE_CONTROL.test(text)) return "A mensagem contém caracteres inválidos.";
  const unknown = unknownVariables(text);
  if (unknown.length > 0) {
    return `Variável desconhecida: ${unknown.join(", ")}. Use ${VARIABLES.map((v) => v.label).join(", ")}.`;
  }
  return null;
}
