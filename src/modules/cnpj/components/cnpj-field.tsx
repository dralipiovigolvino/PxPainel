"use client";

import Link from "next/link";
import { formatMonthLabel, parseCivilDate } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { estimateTax, formatRate } from "@/lib/tax";
import { cn } from "@/lib/utils";
import { taxPayMonth } from "../domain/tax";
import type { CnpjOption } from "../types";

type Props = {
  idPrefix: string;
  options: CnpjOption[];
  /** Id do CNPJ marcado; "" = não é recebido por CNPJ. */
  value: string;
  onChange: (cnpjId: string) => void;
  label?: string;
  error?: string;
};

/**
 * Marcação "Recebo por CNPJ" dos formulários de plantão e de perícia (campo `cnpjId`).
 * Com um CNPJ cadastrado, é só marcar; com mais de um, aparece a escolha de qual; sem nenhum, a
 * marcação fica desligada e aponta para o cadastro.
 */
export function CnpjField({ idPrefix, options, value, onChange, label = "Recebo por CNPJ", error }: Props) {
  return (
    <div className="flex flex-col gap-1.5" data-cnpj-field="">
      <input type="hidden" name="cnpjId" value={value} />
      <span className="text-sm font-medium">{label}</span>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={label}>
        <button type="button" role="radio" aria-checked={value === ""} onClick={() => onChange("")} className={cn("h-10 rounded-lg border px-3 text-sm", value === "" && "border-primary bg-primary text-primary-foreground")} data-cnpj-pf="">PF</button>
        {options.map((o) => (
          <button key={o.id} type="button" role="radio" aria-checked={value === o.id} onClick={() => onChange(o.id)} className={cn("h-10 rounded-lg border px-3 text-sm", value === o.id && "border-primary bg-primary text-primary-foreground")} data-cnpj-option={o.id}>
            {options.length === 1 ? "CNPJ" : o.abbreviation}
          </button>
        ))}
      </div>
      {options.length === 0 && (
        <p id={`${idPrefix}-cnpj-ajuda`} className="text-xs text-muted-foreground">
          Para marcar, cadastre o seu CNPJ em{" "}
          <Link href="/cnpj" className="underline">
            CNPJ
          </Link>
          .
        </p>
      )}
      {value && <p className="text-xs text-muted-foreground">{options.find((o) => o.id === value)?.name} · {formatRate(options.find((o) => o.id === value)?.taxRateBp ?? 0)}</p>}
      {error && (
        <p id={`${idPrefix}-cnpj-erro`} className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

/** Imposto estimado de um valor recebido por CNPJ e o mês em que é pago (o seguinte ao do trabalho). */
export function CnpjTaxNote({ amountCents, rateBp, workDate, each }: { amountCents: number; rateBp: number; workDate?: string; each?: boolean }) {
  const { taxCents } = estimateTax(amountCents, rateBp);
  const month = workDate && parseCivilDate(workDate) ? formatMonthLabel(taxPayMonth(workDate)).split(" de ")[0].toLowerCase() : null;
  return (
    <p className="rounded-lg bg-muted/60 px-3 py-2 text-sm" data-cnpj-tax="">
      Imposto estimado{each ? " por plantão" : ""}:{" "}
      <span className="font-semibold tabular-nums" data-tax="tax">
        {formatCents(taxCents)}
      </span>{" "}
      <span className="text-muted-foreground">
        ({formatRate(rateBp)}), pago {month ? `em ${month}` : "no mês seguinte"}.
      </span>
    </p>
  );
}
