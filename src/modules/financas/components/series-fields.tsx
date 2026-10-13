"use client";

import { useState } from "react";
import { ChoiceChips } from "@/components/choice-chips";
import { Input } from "@/components/ui/input";
import { DESCRIPTION_MAX, MAX_DATE, MIN_DATE } from "../domain/schemas";
import type { FinArea } from "../types";
import { AreaChoice, DetailsFields, Field, PaymentChoice } from "./form-bits";

export const selectClass =
  "h-10 w-full rounded-lg border border-input bg-card px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive";

export type SeriesDefaults = {
  description?: string;
  areaId?: string;
  category?: string;
  notes?: string;
  amountKind?: string;
  amount?: string;
  frequency?: string;
  intervalMonths?: string;
  startDate?: string;
  endDate?: string;
  paymentMethod?: string;
};

type Props = {
  defaults: SeriesDefaults;
  errors?: Record<string, string>;
  areas: FinArea[];
  categories: string[];
  /** Data mínima para a primeira data (alteração a partir de uma data). */
  minStart?: string;
  /** Alteração de série: a forma de pagamento também pode mudar daqui em diante. */
  showPayment?: boolean;
};

/** Campos de uma série recorrente. Nomes compatíveis com saveSeriesAction. */
export function SeriesFields({ defaults, errors, areas, categories, minStart, showPayment }: Props) {
  const [amountKind, setAmountKind] = useState(defaults.amountKind || "fixo");
  const [frequency, setFrequency] = useState(defaults.frequency || "mensal");
  const [areaId, setAreaId] = useState(defaults.areaId ?? "");
  const [method, setMethod] = useState(defaults.paymentMethod ?? "");

  return (
    <div className="flex flex-col gap-4">
      <ChoiceChips
        id="series-kind"
        name="amountKind"
        legend="Valor"
        value={amountKind}
        onChange={setAmountKind}
        options={[
          { value: "fixo", label: "Sempre o mesmo" },
          { value: "variavel", label: "Muda a cada vez" },
        ]}
      />
      {amountKind === "fixo" ? (
        <Field id="series-amount" label="Valor (R$)" error={errors?.amount}>
          {(describedBy, invalid) => (
            <Input
              id="series-amount"
              name="amount"
              inputMode="decimal"
              autoComplete="off"
              placeholder="0,00"
              defaultValue={defaults.amount ?? ""}
              aria-invalid={invalid || undefined}
              aria-describedby={describedBy}
              className="h-10 tabular-nums"
            />
          )}
        </Field>
      ) : (
        <p className="text-sm text-muted-foreground">
          Cada conta começa com valor a informar.
          <input type="hidden" name="amount" value="" />
        </p>
      )}

      <Field id="series-description" label="Descrição" error={errors?.description}>
        {(describedBy, invalid) => (
          <Input
            id="series-description"
            name="description"
            maxLength={DESCRIPTION_MAX * 2}
            autoComplete="off"
            defaultValue={defaults.description ?? ""}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            className="h-10"
          />
        )}
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field id="series-frequency" label="Repete" error={errors?.frequency}>
          {(describedBy, invalid) => (
            <select
              id="series-frequency"
              name="frequency"
              value={frequency}
              onChange={(e) => setFrequency(e.target.value)}
              aria-invalid={invalid || undefined}
              aria-describedby={describedBy}
              className={selectClass}
            >
              <option value="mensal">Mensal</option>
              <option value="semanal">Semanal</option>
              <option value="quinzenal">A cada 2 semanas</option>
            </select>
          )}
        </Field>
        {frequency === "mensal" ? (
          <Field id="series-interval" label="A cada (meses)" error={errors?.intervalMonths}>
            {(describedBy, invalid) => (
              <Input
                id="series-interval"
                name="intervalMonths"
                inputMode="numeric"
                defaultValue={defaults.intervalMonths ?? "1"}
                aria-invalid={invalid || undefined}
                aria-describedby={describedBy}
                className="h-10"
              />
            )}
          </Field>
        ) : (
          <input type="hidden" name="intervalMonths" value="1" />
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Field id="series-start" label="Primeiro vencimento" error={errors?.startDate}>
          {(describedBy, invalid) => (
            <Input
              id="series-start"
              name="startDate"
              type="date"
              min={minStart ?? MIN_DATE}
              max={MAX_DATE}
              defaultValue={defaults.startDate ?? ""}
              aria-invalid={invalid || undefined}
              aria-describedby={describedBy}
              className="h-10"
            />
          )}
        </Field>
        <Field id="series-end" label="Até" optional error={errors?.endDate}>
          {(describedBy, invalid) => (
            <Input
              id="series-end"
              name="endDate"
              type="date"
              min={MIN_DATE}
              max={MAX_DATE}
              defaultValue={defaults.endDate ?? ""}
              aria-invalid={invalid || undefined}
              aria-describedby={describedBy}
              className="h-10"
            />
          )}
        </Field>
      </div>

      <AreaChoice id="series-area" areas={areas} value={areaId} onChange={setAreaId} error={errors?.areaId} />
      {showPayment && <PaymentChoice id="series-payment" value={method} onChange={setMethod} allowEmpty={!defaults.paymentMethod} error={errors?.paymentMethod} />}
      <DetailsFields idPrefix="series" categories={categories} category={defaults.category ?? ""} notes={defaults.notes ?? ""} errors={errors} />
    </div>
  );
}
