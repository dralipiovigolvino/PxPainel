import type { CivilDate } from "@/lib/dates";

/**
 * Contrato entre os módulos e o dashboard.
 * Cada módulo aplica as PRÓPRIAS regras (o que está pendente, atrasado, a confirmar…) e entrega
 * itens prontos; o dashboard só agrega, ordena, conta e exibe. Nenhum registro é copiado para
 * outra tabela: os itens são lidos das tabelas de origem a cada requisição.
 */

export type DashboardSource = "financas" | "followup" | "plantoes" | "pericias";

/** Tipo do registro na origem (com a fonte, forma a identidade estável do item). */
export type DashboardRecordType = "conta" | "fatura" | "etapa" | "plantao" | "pericia" | "prazo" | "agendamento";

/** Seção em que o item aparece. */
export type DashboardSection = "hoje" | "atrasados" | "proximos" | "a_confirmar" | "prazos";

/**
 * Situação de exibição:
 * - pendências (contas, faturas, follow-ups) podem ficar "atrasado";
 * - compromissos (plantões e perícias) nunca "atrasam": passado e ainda agendado vira "a_confirmar";
 * - avisos de acompanhamento: perto de encerrar, termina hoje, prazo encerrado e atendimento a confirmar.
 */
export type DashboardStatus = "hoje" | "atrasado" | "proximo" | "em_andamento" | "a_confirmar" | "perto_de_encerrar" | "termina_hoje" | "encerrado" | "confirmar_atendimento";

/** Valor: inexistente (não se aplica), desconhecido (a informar) ou conhecido (centavos). Nunca NULL → 0. */
export type DashboardAmount = { kind: "none" } | { kind: "unknown" } | { kind: "known"; cents: number };

/**
 * Ações rápidas permitidas. Só entram quando a ação reaproveita o diálogo/validações da origem;
 * caso contrário o item oferece apenas o link para o registro.
 */
export type DashboardAction =
  | { kind: "pagar_conta"; entryId: string; description: string; amountCents: number; dueDate: CivilDate }
  /** Fatura do cartão: o diálogo de Finanças confirma o total (o informado ou a soma das compras) e a data. */
  | { kind: "pagar_fatura"; invoiceId: string; cardName: string; dueDate: CivilDate; statedCents: number | null; detailedCents: number }
  | { kind: "abrir_mensagem"; href: string }
  | { kind: "marcar_realizada"; href: string };

export type DashboardItem = {
  /** Identidade estável, sem colisão entre módulos: `${source}:${type}:${id}`. */
  key: string;
  source: DashboardSource;
  type: DashboardRecordType;
  /** Identificador do registro na origem. */
  id: string;
  /** Pendência (pode atrasar), compromisso (plantão, perícia) ou aviso (prazo de acompanhamento). */
  kind: "pendencia" | "compromisso" | "aviso";
  /** Aviso que pede ação: acompanhamento perto do fim/encerrado sem próxima consulta, ou atendimento a confirmar. */
  attention?: boolean;
  section: DashboardSection;
  status: DashboardStatus;
  title: string;
  /** Linha curta complementar (ex.: "D7", "19:00 → 07:00"). Sem dados clínicos. */
  detail: string | null;
  /** Data relevante: vencimento, data prevista ou início do plantão. */
  date: CivilDate;
  amount: DashboardAmount;
  /** Rota interna que abre o registro correto (inclusive de outro mês). Sem dados pessoais. */
  href: string;
  actions: DashboardAction[];
};

/** Cobertura dos dados do módulo (recorrências geradas até onde é necessário). */
export type DashboardCoverage = {
  /** Geração pendente até esta data (o navegador pede a geração autenticada); null = em dia. */
  generationTarget: CivilDate | null;
  /** Aviso de incompletude (ex.: limite de geração), ou null. */
  note: string | null;
};

export type DashboardModuleData = {
  source: DashboardSource;
  items: DashboardItem[];
  coverage: DashboardCoverage;
};

/** Recebimentos PREVISTOS de plantões em uma data (formatado). Não são recebimentos. */
export type ForecastSummaryRow = { date: CivilDate; overdue: boolean; count: number; total: string };

/** Resumo de plantões do mês (valores formatados pelo módulo; indicadores não somáveis). */
export type ShiftMonthSummary = {
  monthLabel: string;
  programado: string;
  realizado: string;
  recebidoDoMes: string;
  aReceber: string;
  recebidoNoMes: string;
  count: number;
  /** Previsões vencidas sem recebimento (todas) e as próximas datas previstas. */
  forecast: { overdue: ForecastSummaryRow[]; next: ForecastSummaryRow[]; withoutForecast: number };
};

/** Resumo de perícias do mês (formatado). O imposto é a estimativa das perícias recebidas por CNPJ. */
export type ExamMonthSummary = {
  monthLabel: string;
  agendadas: { count: number; gross: string; tax: string; net: string };
  realizadas: { count: number; gross: string; tax: string; net: string };
  /** Há imposto estimado no mês (alguma perícia por CNPJ). */
  hasTax: boolean;
  canceledCount: number;
};

/** Resultado de um módulo para o dashboard: dados ou falha isolada (o resto continua). */
export type DashboardModuleResult = { ok: true; data: DashboardModuleData } | { ok: false; source: DashboardSource };
