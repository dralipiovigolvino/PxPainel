export type Cnpj = {
  id: string;
  name: string;
  /** Nome curto obrigatório usado nos seletores de PF/CNPJ. */
  abbreviation: string;
  /** 14 caracteres, sem pontuação; null = não informado. */
  number: string | null;
  /** Estimativa de imposto em pontos-base (900 = 9%). */
  taxRateBp: number;
  /** Dia do pagamento do imposto, no mês seguinte ao do trabalho. */
  taxDueDay: number;
  /** Tipos de plantão, recorrências, plantões, empresas e perícias marcados com este CNPJ (impedem a exclusão). */
  links: number;
};

/** O que as outras telas precisam do CNPJ: a marcação "recebo por CNPJ" e o imposto estimado em Finanças. */
export type CnpjOption = { id: string; name: string; abbreviation: string; taxRateBp: number; taxDueDay: number };
