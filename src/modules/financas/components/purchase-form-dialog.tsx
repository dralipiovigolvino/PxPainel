"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { addMonths, formatCivilDate, formatYearMonth, parseCivilDate, parseYearMonth, type CivilDate } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import type { ActionState } from "../actions";
import { previewPurchaseAction, savePurchaseAction } from "../card-actions";
import type { PurchasePreview } from "../cards-data";
import { cycleDates } from "../domain/cards";
import { describeSplit } from "../domain/installments";
import { DESCRIPTION_MAX, MAX_DATE, MIN_DATE } from "../domain/schemas";
import type { FinArea, FinCard } from "../types";
import { AreaChoice, DetailsFields, Field, FormError, useActionOutcome } from "./form-bits";
import { selectClass } from "./series-fields";

const initial: ActionState = { status: "idle" };

/** Meses que podem receber a 1ª parcela: do mês anterior à compra até 3 meses depois. */
function referenceOptions(purchaseDate: string): string[] {
  const parts = parseCivilDate(purchaseDate);
  if (!parts) return [];
  const month = { year: parts.year, month: parts.month };
  return [-1, 0, 1, 2, 3].map((d) => formatYearMonth(addMonths(month, d)));
}

type PreviewInput = { cardId: string; purchaseDate: string; total: string; count: string; firstReference: string };
type PreviewResult = PurchasePreview | { error: string } | null;

/** Prévia do servidor com atraso curto; só mostra a resposta da combinação atual. */
function usePurchasePreview(input: PreviewInput): PreviewResult | "loading" | "idle" {
  const ready = input.total.trim() !== "" && parseCivilDate(input.purchaseDate) !== null;
  const key = ready ? JSON.stringify(input) : null;
  const [result, setResult] = useState<{ key: string; value: PreviewResult } | null>(null);
  useEffect(() => {
    if (!key) return;
    let active = true;
    const timer = setTimeout(() => {
      previewPurchaseAction(JSON.parse(key) as PreviewInput)
        .then((value) => active && setResult({ key, value }))
        .catch(() => active && setResult({ key, value: { error: "Não foi possível calcular a prévia agora." } }));
    }, 300);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [key]);
  if (!key) return "idle";
  return result?.key === key ? result.value : "loading";
}

function PreviewBox({ preview }: { preview: PreviewResult | "loading" | "idle" }) {
  if (preview === "idle") return null;
  if (preview === "loading") {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Calculando as parcelas…
      </p>
    );
  }
  if (preview === null) return <p className="text-sm text-destructive">Cartão não encontrado.</p>;
  if ("error" in preview) return <p className="text-sm text-destructive">{preview.error}</p>;
  const amounts = preview.cycles.map((c) => c.amountCents);
  const total = amounts.reduce((sum, v) => sum + BigInt(v), 0n);
  const first = preview.cycles[0];
  const last = preview.cycles.at(-1)!;
  return (
    <div className="flex flex-col gap-1 rounded-lg bg-muted/60 px-3 py-2 text-sm" aria-live="polite" data-purchase-preview="">
      <p className="font-medium" data-purchase-summary="">
        {formatCents(total)} {amounts.length === 1 ? "à vista" : `em ${amounts.length} parcelas: ${describeSplit(amounts)}`}
      </p>
      <p className="text-muted-foreground" data-purchase-dates="">
        {amounts.length === 1 ? `Vence em ${formatCivilDate(first.dueDate)}.` : `Vencimentos de ${formatCivilDate(first.dueDate)} a ${formatCivilDate(last.dueDate)}.`}
      </p>
      {preview.cycles.some((c) => c.locked) && <p className="text-destructive">Um desses meses do cartão já está pago: volte o cartão para a pagar ou escolha outro mês para a 1ª parcela.</p>}
    </div>
  );
}

type FormProps = {
  card: FinCard;
  areas: FinArea[];
  categories: string[];
  today: CivilDate;
  /** Área do filtro atual (usada se o cartão não tiver área padrão). */
  defaultAreaId?: string | null;
  onSuccess: (message: string) => void;
  onCancel: () => void;
};

const DETAIL_FIELDS = ["purchaseDate", "firstReference"];

/** Compra no cartão já escolhido: valor total e parcelas à vista; data e mês da 1ª parcela recolhidos. */
export function PurchaseForm({ card, areas, categories, today, defaultAreaId, onSuccess, onCancel }: FormProps) {
  const [state, action, pending] = useActionState(savePurchaseAction, initial);
  const formRef = useRef<HTMLFormElement>(null);
  useActionOutcome(state, onSuccess, formRef);
  const values = state.status === "error" ? state.values : undefined;
  const errors = state.status === "error" ? state.fieldErrors : undefined;
  const [requestId] = useState(() => crypto.randomUUID());
  const activeAreas = areas.filter((a) => !a.archived);
  // Área: padrão do cartão; sem padrão, a do filtro atual ou a única área. Nunca "a primeira" em silêncio.
  const cardDefault = card.defaultAreaId && activeAreas.some((a) => a.id === card.defaultAreaId) ? card.defaultAreaId : null;
  const fallback = defaultAreaId && activeAreas.some((a) => a.id === defaultAreaId) ? defaultAreaId : activeAreas.length === 1 ? activeAreas[0].id : "";
  const [areaId, setAreaId] = useState(values?.areaId ?? cardDefault ?? fallback);
  const [saveDefault, setSaveDefault] = useState(values?.saveDefaultArea === "true");
  const [purchaseDate, setPurchaseDate] = useState(values?.purchaseDate ?? today);
  const [total, setTotal] = useState(values?.total ?? "");
  const [count, setCount] = useState(values?.count ?? "1");
  const [firstReference, setFirstReference] = useState(values?.firstReference ?? "");
  const options = referenceOptions(purchaseDate);
  const reference = options.includes(firstReference) ? firstReference : "";
  const preview = usePurchasePreview({ cardId: card.id, purchaseDate, total, count, firstReference: reference });
  const detailsOpen = purchaseDate !== today || reference !== "" || DETAIL_FIELDS.some((f) => errors?.[f]);

  const submitting = useRef(false);
  useEffect(() => {
    if (!pending) submitting.current = false;
  }, [pending, state]);

  return (
    <form
      ref={formRef}
      action={action}
      onSubmit={(event) => {
        if (submitting.current) event.preventDefault();
        submitting.current = true;
      }}
      className="flex flex-col gap-4"
      noValidate
      data-purchase-form=""
    >
      <input type="hidden" name="requestId" value={requestId} />
      <input type="hidden" name="cardId" value={card.id} />
      <div className="grid grid-cols-3 gap-4">
        <Field id="purchase-total" label="Valor total (R$)" error={errors?.total} className="col-span-2">
          {(describedBy, invalid) => (
            <Input id="purchase-total" name="total" inputMode="decimal" autoComplete="off" placeholder="0,00" value={total} onChange={(e) => setTotal(e.target.value)} aria-invalid={invalid || undefined} aria-describedby={describedBy} className="h-10 tabular-nums" />
          )}
        </Field>
        <Field id="purchase-count" label="Parcelas" error={errors?.count ?? errors?.cardId}>
          {(describedBy, invalid) => (
            <Input id="purchase-count" name="count" inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value)} aria-invalid={invalid || undefined} aria-describedby={describedBy} className="h-10" />
          )}
        </Field>
      </div>
      <PreviewBox preview={preview} />
      <Field id="purchase-description" label="Descrição" optional error={errors?.description}>
        {(describedBy, invalid) => (
          <Input
            id="purchase-description"
            name="description"
            maxLength={DESCRIPTION_MAX * 2}
            autoComplete="off"
            placeholder={`Compra de ${formatCivilDate(parseCivilDate(purchaseDate) ? purchaseDate : today)}`}
            defaultValue={values?.description ?? ""}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            className="h-10"
          />
        )}
      </Field>
      <AreaChoice id="purchase-area" areas={areas} value={areaId} onChange={setAreaId} error={errors?.areaId} />
      {!cardDefault && areaId !== "" && (
        <label className="-mt-2 flex items-center gap-2 text-sm">
          <input type="checkbox" name="saveDefaultArea" value="true" checked={saveDefault} onChange={(e) => setSaveDefault(e.target.checked)} className="size-4 accent-primary" />
          Usar esta área nas próximas compras do {card.name}
        </label>
      )}
      <details className="rounded-lg border" open={detailsOpen || undefined} data-purchase-details="">
        <summary className="cursor-pointer px-3 py-2.5 text-sm font-medium">Data da compra e 1ª parcela</summary>
        <div className="grid gap-4 border-t p-3 sm:grid-cols-2">
          <Field id="purchase-date" label="Data da compra" error={errors?.purchaseDate}>
            {(describedBy, invalid) => (
              <Input id="purchase-date" name="purchaseDate" type="date" min={MIN_DATE} max={MAX_DATE} value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} aria-invalid={invalid || undefined} aria-describedby={describedBy} className="h-10" />
            )}
          </Field>
          <Field id="purchase-first" label="1ª parcela vence em" error={errors?.firstReference}>
            {(describedBy, invalid) => (
              <select id="purchase-first" name="firstReference" value={reference} onChange={(e) => setFirstReference(e.target.value)} aria-invalid={invalid || undefined} aria-describedby={describedBy} className={selectClass}>
                <option value="">Automático (pelo fechamento)</option>
                {options.map((ref) => (
                  <option key={ref} value={ref}>
                    {formatCivilDate(cycleDates(parseYearMonth(ref)!, card.closingDay, card.dueDay).dueDate)}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
      </details>
      <DetailsFields idPrefix="purchase" categories={categories} category={values?.category ?? ""} notes={values?.notes ?? ""} errors={errors} />
      <FormError state={state} />
      <DialogFooter>
        <Button type="button" variant="outline" className="h-10" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" disabled={pending} className="h-10 px-4">
          {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
          {pending ? "Lançando…" : "Lançar compra"}
        </Button>
      </DialogFooter>
    </form>
  );
}
