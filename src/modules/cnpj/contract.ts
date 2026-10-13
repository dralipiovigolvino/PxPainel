import type { CivilDate } from "@/lib/dates";

/**
 * Contrato entre quem sabe o que foi trabalhado e recebido (Plantões e Perícias) e quem soma:
 * o módulo CNPJ (imposto estimado) e a Visão geral de Finanças (entradas).
 * Cada módulo lê as PRÓPRIAS tabelas e entrega registros prontos; nada é copiado para outra tabela.
 * Cancelados ficam de fora.
 */
export type WorkRecord = {
  source: "plantao" | "pericia";
  /** Identificador do registro na origem. */
  id: string;
  /** Tipo do plantão ou empresa da perícia. */
  label: string;
  /** Dia do trabalho: define o mês do imposto estimado. */
  workDate: CivilDate;
  /** Dia em que o valor entra: o recebimento registrado; sem ele, a data prevista de pagamento; sem ela, o dia do trabalho. */
  cashDate: CivilDate;
  received: boolean;
  /** Valor do registro, como informado. */
  amountCents: number;
  /** CNPJ pelo qual o valor é recebido; null = sem CNPJ, nenhum imposto estimado. */
  cnpjId: string | null;
  /** Alíquota gravada no registro, em pontos-base. Só vale com CNPJ. */
  taxRateBp: number | null;
};
