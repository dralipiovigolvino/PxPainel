"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChoiceChips } from "@/components/choice-chips";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { ActionState } from "../actions";
import { PAYMENT_LABELS, PAYMENT_METHODS } from "../domain/payment";
import { CATEGORY_MAX, NOTES_MAX } from "../domain/schemas";
import type { FinArea } from "../types";

type FieldProps = {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  optional?: boolean;
  className?: string;
  children: (describedBy: string | undefined, invalid: boolean) => React.ReactNode;
};

/** Rótulo + campo + dica + erro ligados por aria-describedby. */
export function Field({ id, label, error, hint, optional, className, children }: FieldProps) {
  const describedBy = [hint && `${id}-dica`, error && `${id}-erro`].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={id}>
        {label}
        {optional && <span className="font-normal text-muted-foreground">(opcional)</span>}
      </Label>
      {children(describedBy, Boolean(error))}
      {hint && !error && (
        <p id={`${id}-dica`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-erro`} className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

export function FormError({ state }: { state: ActionState }) {
  if (state.status !== "error") return null;
  return (
    <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
      {state.message}
    </p>
  );
}

export type Notice = { id: number; text: string };

/** Aviso de sucesso; cada chamada gera um id novo, mesmo com texto igual. */
export function useNotice(initial?: string) {
  const [notice, setNotice] = useState<Notice | null>(initial ? { id: 0, text: initial } : null);
  const counter = useRef(0);
  const show = useCallback((text: string) => setNotice({ id: ++counter.current, text }), []);
  return [notice, show] as const;
}

/**
 * Aviso flutuante (não ocupa espaço na página) que some sozinho depois de alguns segundos.
 * O parágrafo é recriado a cada aviso (key = id): leitores de tela anunciam o novo nó mesmo
 * quando o texto se repete.
 */
export function NoticeRegion({ notice }: { notice: Notice | null }) {
  const [dismissed, setDismissed] = useState<number | null>(null);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setDismissed(notice.id), 8000);
    return () => clearTimeout(timer);
  }, [notice]);
  const visible = notice && notice.id !== dismissed ? notice : null;
  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-notice=""
      className="pointer-events-none fixed inset-x-4 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-50 flex justify-center md:inset-x-auto md:right-6 md:bottom-6"
    >
      {visible && (
        <p key={visible.id} className="pointer-events-auto max-w-md rounded-lg bg-foreground px-4 py-3 text-sm text-background shadow-lg">
          {visible.text}
        </p>
      )}
    </div>
  );
}

export function AreaDot({ color, className }: { color: string; className?: string }) {
  return <span aria-hidden="true" className={cn("inline-block size-2.5 shrink-0 rounded-full", className)} style={{ backgroundColor: color }} />;
}

/** Área em botões: áreas ativas e, na edição, a atual (mesmo arquivada, para não trocar em silêncio). */
export function AreaChoice({ areas, value, onChange, keepId, error, id = "entry-area" }: { areas: FinArea[]; value: string; onChange: (id: string) => void; keepId?: string | null; error?: string; id?: string }) {
  const options = areas.filter((a) => !a.archived || a.id === keepId).map((a) => ({ value: a.id, label: a.archived ? `${a.name} (arquivada)` : a.name, dot: a.color }));
  return <ChoiceChips id={id} name="areaId" legend="Área" options={options} value={value} onChange={onChange} error={error} />;
}

/** Pix ou boleto. Sem escolha (registro antigo), nada é enviado e a forma continua não informada. */
export function PaymentChoice({ value, onChange, allowEmpty, error, id = "entry-payment" }: { value: string; onChange: (method: string) => void; allowEmpty?: boolean; error?: string; id?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <ChoiceChips id={id} name="paymentMethod" legend="Forma de pagamento" options={PAYMENT_METHODS.map((m) => ({ value: m, label: PAYMENT_LABELS[m] }))} value={value} onChange={onChange} error={error} />
      {allowEmpty && value === "" && <p className="text-xs text-muted-foreground">Ainda não informada.</p>}
    </div>
  );
}

/** Categoria (com sugestões das já usadas) e observação, recolhidas até serem necessárias. */
export function DetailsFields({ idPrefix, categories, category, notes, errors }: { idPrefix: string; categories: string[]; category: string; notes: string; errors?: Record<string, string> }) {
  const open = Boolean(category || notes || errors?.category || errors?.notes);
  return (
    <details className="rounded-lg border" open={open || undefined} data-details="">
      <summary className="cursor-pointer px-3 py-2.5 text-sm font-medium">Categoria e observação</summary>
      <div className="flex flex-col gap-4 border-t p-3">
        <Field id={`${idPrefix}-category`} label="Categoria" optional error={errors?.category}>
          {(describedBy, invalid) => (
            <Input
              id={`${idPrefix}-category`}
              name="category"
              list={`${idPrefix}-categories`}
              maxLength={CATEGORY_MAX * 2}
              autoComplete="off"
              defaultValue={category}
              aria-invalid={invalid || undefined}
              aria-describedby={describedBy}
              className="h-10"
            />
          )}
        </Field>
        <datalist id={`${idPrefix}-categories`}>
          {categories.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        <Field id={`${idPrefix}-notes`} label="Observação" optional error={errors?.notes}>
          {(describedBy, invalid) => <Textarea id={`${idPrefix}-notes`} name="notes" rows={2} maxLength={NOTES_MAX * 2} defaultValue={notes} aria-invalid={invalid || undefined} aria-describedby={describedBy} />}
        </Field>
      </div>
    </details>
  );
}

const CHOICES = "select, input[type=radio], input[type=checkbox]";
type Choice = HTMLSelectElement | HTMLInputElement;
const choiceState = (el: Choice) => (el instanceof HTMLSelectElement ? el.value : String(el.checked));

/** Devolve seletores, rádios e caixas de marcar ao estado que tinham no envio (mesma ordem). */
function restoreChoices(form: HTMLFormElement, values: string[]) {
  const fields = form.querySelectorAll<Choice>(CHOICES);
  if (fields.length !== values.length) return;
  fields.forEach((el, i) => {
    if (choiceState(el) === values[i]) return;
    if (el instanceof HTMLSelectElement) el.value = values[i];
    else el.checked = values[i] === "true";
  });
}

/**
 * Após sucesso CONFIRMADO pelo servidor: avisa a página e fecha o diálogo.
 * Após erro: leva o foco ao primeiro campo inválido (ou mantém no formulário).
 */
export function useActionOutcome(state: ActionState, onSuccess: (message: string) => void, formRef?: React.RefObject<HTMLFormElement | null>) {
  const handled = useRef<ActionState | null>(null);
  // Escolhas (seletores, rádios e caixas de marcar) no momento do envio. Depois de uma ação, o navegador
  // reinicia o formulário: um <select> parado em "Escolha…" pula para a primeira opção válida e rádios e
  // caixas voltam ao estado inicial. A tela mostraria uma escolha que o usuário não fez e o reenvio
  // gravaria nela. Em caso de erro, devolvemos cada escolha ao que estava quando o usuário enviou.
  const sent = useRef<string[]>([]);
  useEffect(() => {
    const form = formRef?.current;
    if (!form) return;
    const remember = () => {
      sent.current = [...form.querySelectorAll<Choice>(CHOICES)].map(choiceState);
    };
    form.addEventListener("submit", remember, true);
    return () => form.removeEventListener("submit", remember, true);
  }, [formRef]);
  useEffect(() => {
    if (handled.current === state) return;
    handled.current = state;
    if (state.status === "success") onSuccess(state.message);
    if (state.status === "error" && formRef?.current) {
      restoreChoices(formRef.current, sent.current);
      const invalid = formRef.current.querySelector<HTMLElement>("[aria-invalid='true']");
      invalid?.focus();
    }
  }, [state, onSuccess, formRef]);
}
