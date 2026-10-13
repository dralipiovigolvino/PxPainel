"use client";

import { useActionState, useCallback, useRef, useState } from "react";
import { Ban, CircleStop, Loader2, MoreHorizontal, Pencil, Play, Plus, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { formatCivilDate, type CivilDate } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { cancelPlanAction, planPaymentAction, type ActionState } from "../actions";
import { PAYMENT_LABELS } from "../domain/payment";
import { describeRule } from "../domain/recurrence";
import type { FinArea, FinPlan, FinSeries } from "../types";
import { ConfirmDialog, type ConfirmRequest } from "./confirm-dialog";
import { EntryFormDialog } from "./entry-form-dialog";
import { AreaDot, FormError, NoticeRegion, PaymentChoice, useActionOutcome, useNotice } from "./form-bits";
import { GenerationSync } from "./generation-sync";
import { EndSeriesDialog, ResumeSeriesDialog, SeriesChangeDialog, type ChangeScope } from "./series-dialogs";

const initial: ActionState = { status: "idle" };

type Props = { series: FinSeries[]; plans: FinPlan[]; areas: FinArea[]; categories: string[]; today: CivilDate; generationTarget: CivilDate | null };

function RowMenu({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-10 shrink-0" aria-label={`Ações: ${label}`}>
          <MoreHorizontal aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>{children}</DropdownMenuContent>
    </DropdownMenu>
  );
}

function PlanPaymentDialog({ plan, onOpenChange, onSuccess }: { plan: FinPlan | null; onOpenChange: (open: boolean) => void; onSuccess: (m: string) => void }) {
  return (
    <Dialog open={plan !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">{plan && <PlanPaymentForm plan={plan} onSuccess={onSuccess} onCancel={() => onOpenChange(false)} />}</DialogContent>
    </Dialog>
  );
}

function PlanPaymentForm({ plan, onSuccess, onCancel }: { plan: FinPlan; onSuccess: (m: string) => void; onCancel: () => void }) {
  const [state, action, pending] = useActionState(planPaymentAction, initial);
  const formRef = useRef<HTMLFormElement>(null);
  useActionOutcome(state, onSuccess, formRef);
  const [method, setMethod] = useState<string>(plan.paymentMethod ?? "");
  return (
    <form ref={formRef} action={action} className="flex flex-col gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>Forma de pagamento</DialogTitle>
        <DialogDescription>{plan.description}: vale para as parcelas ainda a pagar.</DialogDescription>
      </DialogHeader>
      <input type="hidden" name="planId" value={plan.id} />
      <PaymentChoice id="plan-payment" value={method} onChange={setMethod} allowEmpty={plan.paymentMethod === null} error={state.status === "error" ? state.fieldErrors?.paymentMethod : undefined} />
      <FormError state={state} />
      <DialogFooter>
        <Button type="button" variant="outline" className="h-10" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" disabled={pending || method === ""} className="h-10 px-4">
          {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
          Salvar
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Contas recorrentes (ativas e suspensas) e parcelamentos com parcelas a pagar. Encerrados e quitados não aparecem. */
export function RecurrencesView({ series, plans, areas, categories, today, generationTarget }: Props) {
  const [notice, showNotice] = useNotice();
  const [change, setChange] = useState<{ series: FinSeries; scope: ChangeScope; fromDate: CivilDate } | null>(null);
  const [ending, setEnding] = useState<FinSeries | null>(null);
  const [resuming, setResuming] = useState<FinSeries | null>(null);
  const [paymentPlan, setPaymentPlan] = useState<FinPlan | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [creating, setCreating] = useState(false);
  const areaById = new Map(areas.map((a) => [a.id, a]));
  const activeAreas = areas.filter((a) => !a.archived);
  const showArea = activeAreas.length > 1;

  const done = useCallback(
    (message: string) => {
      setChange(null);
      setEnding(null);
      setResuming(null);
      setPaymentPlan(null);
      setConfirm(null);
      setCreating(false);
      showNotice(message);
    },
    [showNotice],
  );

  const activeSeries = series.filter((s) => !s.ended).sort((a, b) => Number(a.suspended) - Number(b.suspended));
  const openPlans = plans.filter((p) => p.pendingCount > 0);

  const areaLabel = (areaId: string) => {
    const area = areaById.get(areaId);
    if (!showArea || !area) return null;
    return (
      <span className="inline-flex items-center gap-1">
        <AreaDot color={area.color} />
        {area.name}
      </span>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <GenerationSync target={generationTarget} />
      <div className="flex flex-wrap items-center gap-2">
        <Button className="h-10 px-4" disabled={activeAreas.length === 0} onClick={() => setCreating(true)} data-new-series="">
          <Plus aria-hidden="true" />
          Nova recorrência
        </Button>
        {activeAreas.length === 0 && <p className="text-sm text-muted-foreground">Crie uma área antes, na aba Áreas.</p>}
      </div>
      <NoticeRegion notice={notice} />

      <section aria-labelledby="recorrentes" className="rounded-xl border bg-card shadow-xs">
        <h2 id="recorrentes" className="border-b px-4 py-3 font-semibold">
          Recorrentes
        </h2>
        {activeSeries.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">Nenhuma conta recorrente.</p>
        ) : (
          <ul className="divide-y">
            {activeSeries.map((s) => {
              const area = areaById.get(s.areaId);
              const meta = [
                describeRule(s).split(" (")[0],
                s.amountKind === "fixo" && s.amountCents !== null ? formatCents(s.amountCents) : "valor variável",
                s.paymentMethod && PAYMENT_LABELS[s.paymentMethod],
                s.nextDue ? `próxima ${formatCivilDate(s.nextDue)}` : null,
              ].filter(Boolean);
              return (
                <li key={s.id} className="flex items-center gap-2 py-2 pr-2 pl-4" data-series={s.id}>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 font-medium">
                      <span className="break-words">{s.description}</span>
                      {s.suspended && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-900 ring-1 ring-amber-200">Suspensa</span>}
                    </p>
                    <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
                      {areaLabel(s.areaId)}
                      <span>{meta.join(" · ")}</span>
                    </p>
                  </div>
                  <RowMenu label={s.description}>
                    {s.suspended ? (
                      <DropdownMenuItem disabled={!area || area.archived} onSelect={() => setResuming(s)}>
                        <Play aria-hidden="true" />
                        {area?.archived ? "Retomar (restaure a área antes)" : "Retomar"}
                      </DropdownMenuItem>
                    ) : (
                      <>
                        <DropdownMenuItem onSelect={() => setChange({ series: s, scope: "futuras", fromDate: today })}>
                          <Pencil aria-hidden="true" />
                          Alterar daqui em diante
                        </DropdownMenuItem>
                        <DropdownMenuItem variant="destructive" onSelect={() => setEnding(s)}>
                          <CircleStop aria-hidden="true" />
                          Encerrar
                        </DropdownMenuItem>
                      </>
                    )}
                  </RowMenu>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="parceladas" className="rounded-xl border bg-card shadow-xs">
        <h2 id="parceladas" className="border-b px-4 py-3 font-semibold">
          Parceladas
        </h2>
        {openPlans.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">Nenhum parcelamento a pagar. Compras parceladas no cartão ficam no Mês.</p>
        ) : (
          <ul className="divide-y">
            {openPlans.map((p) => {
              const meta = [
                `${p.count}x · total ${formatCents(p.totalCents)}`,
                `faltam ${p.pendingCount} (${formatCents(BigInt(p.pendingCents))})`,
                p.paymentMethod && PAYMENT_LABELS[p.paymentMethod],
                p.nextDue ? `próxima ${formatCivilDate(p.nextDue)}` : null,
              ].filter(Boolean);
              return (
                <li key={p.id} className="flex items-center gap-2 py-2 pr-2 pl-4" data-plan={p.id}>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 font-medium">
                      <span className="break-words">{p.description}</span>
                      {p.overdueCount > 0 && (
                        <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
                          {p.overdueCount === 1 ? "1 atrasada" : `${p.overdueCount} atrasadas`}
                        </span>
                      )}
                    </p>
                    <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
                      {areaLabel(p.areaId)}
                      <span>{meta.join(" · ")}</span>
                    </p>
                  </div>
                  <RowMenu label={p.description}>
                    <DropdownMenuItem onSelect={() => setPaymentPlan(p)}>
                      <Wallet aria-hidden="true" />
                      Forma de pagamento
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      variant="destructive"
                      onSelect={() =>
                        setConfirm({
                          title: "Cancelar parcelas a pagar?",
                          description: `${p.pendingCount === 1 ? "1 parcela" : `${p.pendingCount} parcelas`} de "${p.description}" (${formatCents(BigInt(p.pendingCents))}) serão canceladas. As pagas continuam.`,
                          confirmLabel: "Cancelar parcelas",
                          destructive: true,
                          action: cancelPlanAction,
                          fields: { planId: p.id },
                        })
                      }
                    >
                      <Ban aria-hidden="true" />
                      Cancelar parcelas a pagar
                    </DropdownMenuItem>
                  </RowMenu>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <EntryFormDialog
        open={creating}
        onOpenChange={setCreating}
        fixedKind="recorrente"
        areas={areas}
        cards={[]}
        categories={categories}
        defaultDueDate={today}
        today={today}
        onAskConfirm={() => {}}
        onSuccess={done}
      />
      <SeriesChangeDialog request={change} areas={areas} categories={categories} onOpenChange={(open) => !open && setChange(null)} onSuccess={done} />
      <EndSeriesDialog series={ending} today={today} onOpenChange={(open) => !open && setEnding(null)} onSuccess={done} />
      <ResumeSeriesDialog series={resuming} today={today} onOpenChange={(open) => !open && setResuming(null)} onSuccess={done} />
      <PlanPaymentDialog plan={paymentPlan} onOpenChange={(open) => !open && setPaymentPlan(null)} onSuccess={done} />
      <ConfirmDialog request={confirm} onOpenChange={(open) => !open && setConfirm(null)} onSuccess={done} />
    </div>
  );
}
