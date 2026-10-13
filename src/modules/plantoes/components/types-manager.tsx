"use client";

import { useActionState, useCallback, useEffect, useRef, useState, useTransition } from "react";
import { Archive, ArchiveRestore, CalendarClock, Check, ChevronRight, Loader2, MoreHorizontal, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatCents, formatCentsForInput } from "@/lib/money";
import { cn } from "@/lib/utils";
import { CnpjField } from "@/modules/cnpj/components/cnpj-field";
import type { CnpjOption } from "@/modules/cnpj/types";
import { ConfirmDialog, type ConfirmRequest } from "@/modules/financas/components/confirm-dialog";
import { Field, FormError, NoticeRegion, useActionOutcome, useNotice } from "@/modules/financas/components/form-bits";
import { applyTypeRuleAction, archiveTypeAction, deleteTypeAction, saveTypeAction, typeRuleImpactAction, type ActionState } from "../actions";
import { describePayRule, expectedPayDate } from "../domain/payment";
import type { TypeRuleImpact } from "../forecast-data";
import { describeHours } from "../domain/hours";
import { LOCATION_MAX, NOTES_MAX, TYPE_COLORS, TYPE_NAME_MAX } from "../domain/schemas";
import type { PlType } from "../types";
import { HoursFields } from "./hours-fields";

const initial: ActionState = { status: "idle" };

export const Dot = ({ color, className }: { color: string; className?: string }) => (
  <span aria-hidden="true" className={cn("inline-block size-2.5 shrink-0 rounded-full", className)} style={{ backgroundColor: color }} />
);

function TypeForm({ type, cnpjs, onSuccess, onCancel }: { type: PlType | null; cnpjs: CnpjOption[]; onSuccess: (m: string) => void; onCancel: () => void }) {
  const [state, action, pending] = useActionState(saveTypeAction, initial);
  const formRef = useRef<HTMLFormElement>(null);
  useActionOutcome(state, onSuccess, formRef);
  const values = state.status === "error" ? state.values : undefined;
  const errors = state.status === "error" ? state.fieldErrors : undefined;
  const [color, setColor] = useState(values?.color || type?.color || TYPE_COLORS[0].value);
  // "Recebo por CNPJ": o padrão dos novos plantões do tipo (desmarcado enquanto o usuário não marcar).
  const [cnpjId, setCnpjId] = useState(values?.cnpjId ?? type?.cnpjId ?? "");
  const [payDay, setPayDay] = useState(values?.payDay ?? (type?.payDay != null ? String(type.payDay) : ""));
  const [payMonthOffset, setPayMonthOffset] = useState<0 | 1>(values?.payMonthOffset === "0" || (!values && type?.payMonthOffset === 0) ? 0 : 1);
  const day = /^\d{1,2}$/.test(payDay.trim()) ? Number(payDay) : NaN;
  const payExample = Number.isInteger(day) && day >= 1 && day <= 31 ? expectedPayDate("2026-10-15", day, payMonthOffset) : null;
  return (
    <form ref={formRef} action={action} className="flex flex-col gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>{type ? "Editar tipo de plantão" : "Novo tipo de plantão"}</DialogTitle>
        <DialogDescription>
          Valor, CNPJ, regra de pagamento, horários e observação padrão são copiados para cada plantão novo.{type && " Alterar aqui não muda plantões já criados."}
        </DialogDescription>
      </DialogHeader>
      {type && <input type="hidden" name="id" value={type.id} />}
      <input type="hidden" name="color" value={color} />
      <Field id="type-name" label="Nome" error={errors?.name}>
        {(d, i) => <Input id="type-name" name="name" maxLength={TYPE_NAME_MAX * 2} autoComplete="off" defaultValue={values?.name ?? type?.name ?? ""} aria-invalid={i || undefined} aria-describedby={d} className="h-10" />}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="type-location" label="Local" optional error={errors?.location}>
          {(d, i) => <Input id="type-location" name="location" maxLength={LOCATION_MAX * 2} defaultValue={values?.location ?? type?.location ?? ""} aria-invalid={i || undefined} aria-describedby={d} className="h-10" />}
        </Field>
        <Field id="type-amount" label="Valor padrão (R$)" error={errors?.amount}>
          {(d, i) => (
            <Input
              id="type-amount"
              name="amount"
              inputMode="decimal"
              placeholder="0,00"
              defaultValue={values?.amount ?? (type ? formatCentsForInput(type.amountCents) : "")}
              aria-invalid={i || undefined}
              aria-describedby={d}
              className="h-10 tabular-nums"
            />
          )}
        </Field>
      </div>
      <CnpjField idPrefix="type" options={cnpjs} value={cnpjId} onChange={setCnpjId} error={errors?.cnpjId} />
      <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
      <Field
        id="type-pay-day"
        label="Dia do pagamento"
        optional
        error={errors?.payDay}
        hint={
          payExample
            ? `Exemplo: ${payExample.slice(8, 10)}/${payExample.slice(5, 7)}. Dias inexistentes usam o último dia do mês.`
            : "Em branco: sem previsão."
        }
      >
        {(d, i) => <Input id="type-pay-day" name="payDay" inputMode="numeric" autoComplete="off" value={payDay} onChange={(e) => setPayDay(e.target.value)} aria-invalid={i || undefined} aria-describedby={d} className="h-10 sm:max-w-32" />}
      </Field>
      <fieldset className="flex flex-col gap-1.5">
        <legend className="text-sm font-medium">Mês do pagamento</legend>
        <input type="hidden" name="payMonthOffset" value={payMonthOffset} />
        <div className="flex gap-2">
          {([[0, "Este mês"], [1, "Mês seguinte"]] as const).map(([offset, label]) => <Button key={offset} type="button" variant={payMonthOffset === offset ? "default" : "outline"} className="h-10 px-3" onClick={() => setPayMonthOffset(offset)}>{label}</Button>)}
        </div>
        {errors?.payMonthOffset && <p className="text-sm text-destructive">{errors.payMonthOffset}</p>}
      </fieldset>
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1.5 text-sm font-medium">Cor no calendário</legend>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Cor do tipo">
          {TYPE_COLORS.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={value === color}
              aria-label={label}
              title={label}
              onClick={() => setColor(value)}
              className={cn("flex size-9 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2", value === color && "ring-2 ring-foreground/70 ring-offset-2")}
              style={{ backgroundColor: value }}
            >
              {value === color && <Check className="size-4 text-white" aria-hidden="true" />}
            </button>
          ))}
        </div>
        {errors?.color && <p className="text-sm text-destructive">{errors.color}</p>}
      </fieldset>
      <HoursFields idPrefix="type" initial={type?.hours ?? null} errors={errors} />
      <Field id="type-notes" label="Observação padrão" optional error={errors?.notes}>
        {(d, i) => <Textarea id="type-notes" name="notes" rows={2} maxLength={NOTES_MAX * 2} defaultValue={values?.notes ?? type?.notes ?? ""} aria-invalid={i || undefined} aria-describedby={d} />}
      </Field>
      <FormError state={state} />
      <DialogFooter>
        <Button type="button" variant="outline" className="h-10" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" disabled={pending} className="h-10 px-4">
          {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
          {pending ? "Salvando…" : type ? "Salvar" : "Criar tipo"}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Prévia e confirmação de aplicar a regra de pagamento atual do tipo aos plantões já criados. */
function ApplyRuleForm({ type, onSuccess, onCancel }: { type: PlType; onSuccess: (m: string) => void; onCancel: () => void }) {
  const [state, action, pending] = useActionState(applyTypeRuleAction, initial);
  useActionOutcome(state, onSuccess);
  const [impact, setImpact] = useState<{ id: string; value: TypeRuleImpact | null } | null>(null);
  useEffect(() => {
    let active = true;
    typeRuleImpactAction(type.id).then((value) => active && setImpact({ id: type.id, value }));
    return () => {
      active = false;
    };
  }, [type.id]);
  const v = impact?.id === type.id ? impact.value : undefined;
  const total = v ? v.fill + v.change : 0;
  const plural = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`);
  return (
    <form action={action} className="flex flex-col gap-4" data-apply-rule="">
      <DialogHeader>
        <DialogTitle>Aplicar previsão de pagamento</DialogTitle>
        <DialogDescription>
          {type.name}: {describePayRule(type.payDay).toLowerCase()}. Plantões novos já usam esta regra; aqui você decide se os já criados também passam a usá-la.
        </DialogDescription>
      </DialogHeader>
      <input type="hidden" name="id" value={type.id} />
      {v === undefined ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Calculando a prévia…
        </p>
      ) : v === null ? (
        <p className="text-sm text-destructive">Tipo não encontrado. Atualize a página.</p>
      ) : (
        <ul className="flex flex-col gap-1 rounded-lg bg-muted/60 px-3 py-2 text-sm" data-rule-impact="">
          <li data-impact="fill">{plural(v.fill, "plantão sem previsão passa a ter", "plantões sem previsão passam a ter")} a data calculada (qualquer data, sem recebimento registrado).</li>
          <li data-impact="change">{plural(v.change, "plantão agendado de hoje em diante troca", "plantões agendados de hoje em diante trocam")} de regra.</li>
          <li data-impact="series">{plural(v.series, "recorrência ativa passa", "recorrências ativas passam")} a gerar com esta regra.</li>
          <li data-impact="preserved" className="text-muted-foreground">
            {plural(v.preserved, "plantão fica", "plantões ficam")} como está (recebidos, previsões ajustadas manualmente, realizados e passados com outra regra).
          </li>
        </ul>
      )}
      <FormError state={state} />
      <DialogFooter>
        <Button type="button" variant="outline" className="h-10" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" disabled={pending || !v || total + v.series === 0} className="h-10 px-4">
          {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
          {v && total + v.series === 0 ? "Nada a aplicar" : "Aplicar aos plantões listados"}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function TypesManager({ types, cnpjs }: { types: PlType[]; cnpjs: CnpjOption[] }) {
  const [notice, showNotice] = useNotice();
  const [applying, setApplying] = useState<PlType | null>(null);
  const [editing, setEditing] = useState<{ open: boolean; type: PlType | null }>({ open: false, type: null });
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const done = useCallback(
    (m: string) => {
      setEditing({ open: false, type: null });
      setConfirm(null);
      setApplying(null);
      showNotice(m);
    },
    [showNotice],
  );
  const [archiveState, archiveAction] = useActionState(archiveTypeAction, initial);
  useActionOutcome(archiveState, done);
  // Tipo com recorrências ativas: o servidor pede confirmação antes de arquivar (e suspender).
  const archiving = useRef<PlType | null>(null);
  useEffect(() => {
    if (archiveState.status !== "confirm" || !archiving.current) return;
    const t = archiving.current;
    setConfirm({
      title: "Arquivar e suspender recorrências?",
      description: archiveState.message,
      confirmLabel: "Arquivar e suspender",
      action: archiveTypeAction,
      fields: { id: t.id, archive: "true", confirmSeries: "true" },
    });
  }, [archiveState]);

  const [, startArchive] = useTransition();
  const toggleArchive = (t: PlType) => {
    archiving.current = t;
    const fd = new FormData();
    fd.set("id", t.id);
    fd.set("archive", String(!t.archived));
    startArchive(() => archiveAction(fd));
  };
  // Ativos primeiro; arquivados no fim, apagados (sem seção própria).
  const ordered = [...types.filter((t) => !t.archived), ...types.filter((t) => t.archived)];

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Button className="h-10 px-4" onClick={() => setEditing({ open: true, type: null })}>
          <Plus aria-hidden="true" />
          Novo tipo
        </Button>
      </div>
      <NoticeRegion notice={notice} />
      {archiveState.status === "error" && (
        <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {archiveState.message}
        </p>
      )}
      {ordered.length === 0 ? (
        <p className="rounded-xl border bg-card px-4 py-8 text-center text-sm text-muted-foreground shadow-xs">Nenhum tipo ainda. Crie o primeiro.</p>
      ) : (
        <ul className="divide-y rounded-xl border bg-card shadow-xs" aria-label="Tipos de plantão">
          {ordered.map((t) => (
            <li key={t.id} className={cn("flex items-center gap-1 pr-2", t.archived && "opacity-60")} data-type="" data-archived={t.archived ? "" : undefined}>
              <button
                type="button"
                onClick={() => setEditing({ open: true, type: t })}
                aria-label={`Editar ${t.name}`}
                className="flex min-w-0 flex-1 items-center gap-3 py-3 pl-4 text-left outline-none hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
              >
                <Dot color={t.color} className="size-3.5" />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium break-words">
                    {t.name}
                    {t.archived && <span className="ml-2 text-xs font-normal text-muted-foreground">Arquivado</span>}
                  </span>
                  <span className="block text-sm text-muted-foreground">
                    {[t.location, `${formatCents(t.amountCents)}${t.cnpjId ? " por CNPJ" : ""}`, describeHours(t.hours)].filter(Boolean).join(" · ")}
                  </span>
                  <span className="block text-sm text-muted-foreground" data-type-pay-rule="">
                    {describePayRule(t.payDay)}
                  </span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="size-10 shrink-0" aria-label={`Ações: ${t.name}`}>
                    <MoreHorizontal aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem onSelect={() => setApplying(t)}>
                    <CalendarClock aria-hidden="true" />
                    Aplicar previsão aos plantões
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => toggleArchive(t)}>
                    {t.archived ? <ArchiveRestore aria-hidden="true" /> : <Archive aria-hidden="true" />}
                    {t.archived ? "Restaurar" : "Arquivar"}
                  </DropdownMenuItem>
                  {t.links === 0 && (
                    <DropdownMenuItem
                      variant="destructive"
                      onSelect={() =>
                        setConfirm({
                          title: "Excluir tipo?",
                          description: `"${t.name}" será excluído.`,
                          confirmLabel: "Excluir",
                          destructive: true,
                          action: deleteTypeAction,
                          fields: { id: t.id },
                        })
                      }
                    >
                      <Trash2 aria-hidden="true" />
                      Excluir
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          ))}
        </ul>
      )}
      <Dialog open={editing.open} onOpenChange={(o) => setEditing((c) => ({ open: o, type: o ? c.type : null }))}>
        <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">{editing.open && <TypeForm type={editing.type} cnpjs={cnpjs} onSuccess={done} onCancel={() => setEditing({ open: false, type: null })} />}</DialogContent>
      </Dialog>
      <Dialog open={applying !== null} onOpenChange={(o) => !o && setApplying(null)}>
        <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">{applying && <ApplyRuleForm type={applying} onSuccess={done} onCancel={() => setApplying(null)} />}</DialogContent>
      </Dialog>
      <ConfirmDialog request={confirm} onOpenChange={(o) => !o && setConfirm(null)} onSuccess={done} />
    </div>
  );
}
