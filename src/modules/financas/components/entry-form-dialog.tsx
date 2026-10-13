"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Loader2, Trash2 } from "lucide-react";
import { ChoiceChips } from "@/components/choice-chips";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { formatCivilDate, type CivilDate } from "@/lib/dates";
import { formatCentsForInput } from "@/lib/money";
import { deleteEntryAction, saveEntryAction, saveSeriesAction, type ActionState } from "../actions";
import { PAYMENT_LABELS, PAYMENT_METHODS, type PaymentMethod } from "../domain/payment";
import { DESCRIPTION_MAX, MAX_DATE, MIN_DATE } from "../domain/schemas";
import type { FinArea, FinCard, FinEntry } from "../types";
import type { ConfirmRequest } from "./confirm-dialog";
import { AreaChoice, DetailsFields, Field, FormError, PaymentChoice, useActionOutcome } from "./form-bits";
import { InstallmentEditForm, PlanCreateForm } from "./plan-forms";
import { PurchaseForm } from "./purchase-form-dialog";
import type { ChangeScope } from "./series-dialogs";
import { SeriesFields } from "./series-fields";

const initial: ActionState = { status: "idle" };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entry?: FinEntry | null;
  areas: FinArea[];
  /** Cartões do usuário: aparecem como formas de pagamento. */
  cards: FinCard[];
  /** Categorias já usadas (sugestões). */
  categories: string[];
  /** Área pré-selecionada ao criar (ex.: filtro atual). */
  defaultAreaId?: string | null;
  /** Sugestão de vencimento ao criar. */
  defaultDueDate: CivilDate;
  today: CivilDate;
  onSuccess: (message: string) => void;
  /** Ocorrência de série: alterar esta e as próximas / as futuras, ou encerrar a recorrência. */
  onSeriesAction?: (entry: FinEntry, action: ChangeScope | "encerrar") => void;
  /** Confirmação (ex.: excluir), aberta no lugar deste diálogo. */
  onAskConfirm: (request: ConfirmRequest) => void;
  /** Abre direto no cadastro de conta recorrente (sem a escolha "uma vez / recorrente / parcelada"). */
  fixedKind?: "recorrente";
};

export function EntryFormDialog({ open, onOpenChange, ...rest }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">{open && <EntryDialogBody {...rest} onCancel={() => onOpenChange(false)} />}</DialogContent>
    </Dialog>
  );
}

type BodyProps = Omit<Props, "open" | "onOpenChange"> & { onCancel: () => void };

/** Contas de uma área só: a escolha vem pronta. */
const singleActiveArea = (areas: FinArea[]) => {
  const active = areas.filter((a) => !a.archived);
  return active.length === 1 ? active[0].id : "";
};

function EntryDialogBody(props: BodyProps) {
  const { entry } = props;
  const [scope, setScope] = useState<"esta" | null>(entry?.seriesId ? null : "esta");
  if (entry?.seriesId && scope === null) {
    return <ScopeStep entry={entry} today={props.today} onCancel={props.onCancel} onChoose={(s) => (s === "esta" ? setScope("esta") : props.onSeriesAction?.(entry, s))} />;
  }
  if (entry?.installmentPlanId) {
    return <InstallmentEditForm entry={entry} area={props.areas.find((a) => a.id === entry.areaId)} categories={props.categories} onSuccess={props.onSuccess} onCancel={props.onCancel} />;
  }
  if (entry) return <EntryForm {...props} entry={entry} />;
  return <NewEntry {...props} />;
}

type AccountKind = "unica" | "recorrente" | "parcelada";

/** Nova conta: primeiro a forma de pagamento (Pix, boleto ou um cartão); depois o resto. */
function NewEntry(props: BodyProps) {
  // Recorrência é sempre fora do cartão (Pix ou boleto).
  const activeCards = props.fixedKind ? [] : props.cards.filter((c) => !c.archived);
  const [method, setMethod] = useState("");
  const [kind, setKind] = useState<AccountKind>(props.fixedKind ?? "unica");
  const card = method.startsWith("cartao:") ? activeCards.find((c) => `cartao:${c.id}` === method) : undefined;
  const paymentMethod = (PAYMENT_METHODS as readonly string[]).includes(method) ? (method as PaymentMethod) : null;

  return (
    <div className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>{props.fixedKind ? "Nova recorrência" : "Nova conta"}</DialogTitle>
        <DialogDescription className="sr-only">Escolha a forma de pagamento e preencha os dados.</DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-1.5">
        <ChoiceChips
          id="entry-method"
          name="method"
          legend="Forma de pagamento"
          value={method}
          onChange={setMethod}
          options={[...PAYMENT_METHODS.map((m) => ({ value: m, label: PAYMENT_LABELS[m] })), ...activeCards.map((c) => ({ value: `cartao:${c.id}`, label: c.name }))]}
        />
        {activeCards.length === 0 && !props.fixedKind && (
          <Link href="/financas/formas-de-pagamento?novo=1" className="w-fit text-sm text-muted-foreground underline underline-offset-4">
            Cadastrar cartão
          </Link>
        )}
      </div>
      {card ? (
        <PurchaseForm key={card.id} card={card} areas={props.areas} categories={props.categories} today={props.today} defaultAreaId={props.defaultAreaId} onSuccess={props.onSuccess} onCancel={props.onCancel} />
      ) : paymentMethod ? (
        <>
          {!props.fixedKind && (
            <ChoiceChips
              id="entry-kind"
              name="kind"
              legend="Repetição"
              hideLegend
              value={kind}
              onChange={(v) => setKind(v as AccountKind)}
              options={[
                { value: "unica", label: "Uma vez" },
                { value: "recorrente", label: "Recorrente" },
                { value: "parcelada", label: "Parcelada" },
              ]}
            />
          )}
          {kind === "unica" ? (
            <EntryForm key={`unica-${paymentMethod}`} {...props} paymentMethod={paymentMethod} />
          ) : kind === "recorrente" ? (
            <SeriesCreateForm key={`rec-${paymentMethod}`} {...props} paymentMethod={paymentMethod} />
          ) : (
            <PlanCreateForm
              key={`plan-${paymentMethod}`}
              areas={props.areas}
              categories={props.categories}
              defaultAreaId={props.defaultAreaId ?? singleActiveArea(props.areas)}
              defaultDueDate={props.defaultDueDate}
              paymentMethod={paymentMethod}
              onSuccess={props.onSuccess}
              onCancel={props.onCancel}
            />
          )}
        </>
      ) : (
        <DialogFooter>
          <Button type="button" variant="outline" className="h-10" onClick={props.onCancel}>
            Cancelar
          </Button>
        </DialogFooter>
      )}
    </div>
  );
}

function ScopeStep({ entry, today, onChoose, onCancel }: { entry: FinEntry; today: CivilDate; onChoose: (s: "esta" | ChangeScope | "encerrar") => void; onCancel: () => void }) {
  const from = entry.occurrenceDate ?? entry.dueDate;
  const options: Array<["esta" | ChangeScope | "encerrar", string, string]> = [
    ["esta", "Só esta conta", `A de ${formatCivilDate(entry.dueDate)}. Também para pagar, excluir ou mudar o valor só dela.`],
    ["proximas", "Esta e as próximas", `A partir de ${formatCivilDate(from)}.`],
    ["futuras", "Todas as futuras", `A partir de hoje (${formatCivilDate(today)}).`],
    ["encerrar", "Encerrar a recorrência", "Para de gerar contas depois da data escolhida."],
  ];
  return (
    <div className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>{entry.description}</DialogTitle>
        <DialogDescription>Conta recorrente. O que você quer alterar?</DialogDescription>
      </DialogHeader>
      <ul className="flex flex-col gap-2">
        {options.map(([value, label, hint]) => (
          <li key={value}>
            <button
              type="button"
              onClick={() => onChoose(value)}
              className="flex w-full flex-col items-start rounded-lg border p-3 text-left text-sm outline-none hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="font-medium">{label}</span>
              <span className="text-muted-foreground">{hint}</span>
            </button>
          </li>
        ))}
      </ul>
      <DialogFooter>
        <Button type="button" variant="outline" className="h-10" onClick={onCancel}>
          Cancelar
        </Button>
      </DialogFooter>
    </div>
  );
}

function SeriesCreateForm({ areas, categories, defaultAreaId, defaultDueDate, onSuccess, onCancel, paymentMethod }: BodyProps & { paymentMethod: PaymentMethod }) {
  const [state, action, pending] = useActionState(saveSeriesAction, initial);
  const formRef = useRef<HTMLFormElement>(null);
  useActionOutcome(state, onSuccess, formRef);
  const values = state.status === "error" ? state.values : undefined;
  const errors = state.status === "error" ? state.fieldErrors : undefined;
  const activeDefault = defaultAreaId && areas.some((a) => a.id === defaultAreaId && !a.archived) ? defaultAreaId : singleActiveArea(areas);
  // Duplo clique não cria duas recorrências: o segundo envio é ignorado enquanto o primeiro não volta.
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
    >
      <input type="hidden" name="paymentMethod" value={paymentMethod} />
      <SeriesFields areas={areas} categories={categories} errors={errors} defaults={values ?? { areaId: activeDefault, startDate: defaultDueDate }} />
      <FormError state={state} />
      <DialogFooter>
        <Button type="button" variant="outline" className="h-10" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" disabled={pending} className="h-10 px-4">
          {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
          {pending ? "Salvando…" : "Criar recorrência"}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Conta única (nova, com a forma já escolhida) ou edição de uma conta existente. */
function EntryForm({ entry, areas, categories, defaultAreaId, defaultDueDate, onSuccess, onCancel, onAskConfirm, paymentMethod }: BodyProps & { paymentMethod?: PaymentMethod }) {
  const [state, action, pending] = useActionState(saveEntryAction, initial);
  const formRef = useRef<HTMLFormElement>(null);
  useActionOutcome(state, onSuccess, formRef);
  const values = state.status === "error" ? state.values : undefined;
  const errors = state.status === "error" ? state.fieldErrors : undefined;
  const variable = Boolean(entry?.isVariable);
  const activeDefault = defaultAreaId && areas.some((a) => a.id === defaultAreaId && !a.archived) ? defaultAreaId : singleActiveArea(areas);
  // Controlados: o reinício automático do formulário após a ação não pode perder as escolhas.
  const [areaId, setAreaId] = useState(values?.areaId ?? entry?.areaId ?? activeDefault);
  const [method, setMethod] = useState<string>(values?.paymentMethod ?? entry?.paymentMethod ?? "");

  const askDelete = () =>
    entry &&
    onAskConfirm({
      title: "Excluir conta?",
      description: entry.seriesId
        ? `"${entry.description}" de ${formatCivilDate(entry.dueDate)} será excluída e não volta a ser gerada. As demais continuam.`
        : `"${entry.description}" será excluída definitivamente.`,
      confirmLabel: "Excluir",
      destructive: true,
      action: deleteEntryAction,
      fields: { id: entry.id },
    });

  return (
    <form ref={formRef} action={action} className="flex flex-col gap-4" noValidate>
      {entry && (
        <DialogHeader>
          <DialogTitle>{entry.seriesId ? "Editar só esta conta" : "Editar conta"}</DialogTitle>
          <DialogDescription className={entry.status === "pago" ? undefined : "sr-only"}>
            {entry.status === "pago" ? `Paga em ${formatCivilDate(entry.paidOn ?? entry.dueDate)}.` : "Altere os dados da conta."}
          </DialogDescription>
        </DialogHeader>
      )}
      {entry && <input type="hidden" name="id" value={entry.id} />}
      {variable && <input type="hidden" name="variable" value="true" />}
      {paymentMethod && <input type="hidden" name="paymentMethod" value={paymentMethod} />}

      <div className="grid grid-cols-2 gap-4">
        <Field id="entry-amount" label="Valor (R$)" optional={variable} error={errors?.amountCents} hint={variable ? "Vazio = valor a informar." : undefined}>
          {(describedBy, invalid) => (
            <Input
              id="entry-amount"
              name="amount"
              inputMode="decimal"
              autoComplete="off"
              placeholder={variable ? "A informar" : "0,00"}
              defaultValue={values?.amountCents ?? (entry && entry.amountCents !== null ? formatCentsForInput(entry.amountCents) : "")}
              aria-invalid={invalid || undefined}
              aria-describedby={describedBy}
              className="h-10 tabular-nums"
            />
          )}
        </Field>
        <Field id="entry-due" label="Vencimento" error={errors?.dueDate}>
          {(describedBy, invalid) => (
            <Input
              id="entry-due"
              name="dueDate"
              type="date"
              min={MIN_DATE}
              max={MAX_DATE}
              defaultValue={values?.dueDate ?? entry?.dueDate ?? defaultDueDate}
              aria-invalid={invalid || undefined}
              aria-describedby={describedBy}
              className="h-10"
            />
          )}
        </Field>
      </div>

      <Field id="entry-description" label="Descrição" error={errors?.description}>
        {(describedBy, invalid) => (
          <Input
            id="entry-description"
            name="description"
            maxLength={DESCRIPTION_MAX * 2}
            autoComplete="off"
            defaultValue={values?.description ?? entry?.description ?? ""}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            className="h-10"
          />
        )}
      </Field>

      <AreaChoice areas={areas} value={areaId} onChange={setAreaId} keepId={entry?.areaId} error={errors?.areaId} />
      {entry && <PaymentChoice value={method} onChange={setMethod} allowEmpty={entry.paymentMethod === null} error={errors?.paymentMethod} />}
      <DetailsFields idPrefix="entry" categories={categories} category={values?.category ?? entry?.category ?? ""} notes={values?.notes ?? entry?.notes ?? ""} errors={errors} />

      <FormError state={state} />
      <DialogFooter className="sm:justify-between">
        {entry ? (
          <Button type="button" variant="ghost" className="h-10 px-3 text-destructive hover:text-destructive" onClick={askDelete}>
            <Trash2 aria-hidden="true" />
            Excluir
          </Button>
        ) : (
          <span />
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <Button type="button" variant="outline" className="h-10" onClick={onCancel}>
            Cancelar
          </Button>
          <Button type="submit" disabled={pending} className="h-10 px-4">
            {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
            {pending ? "Salvando…" : entry ? "Salvar" : "Criar conta"}
          </Button>
        </div>
      </DialogFooter>
    </form>
  );
}
