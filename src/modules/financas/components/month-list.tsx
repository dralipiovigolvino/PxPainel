"use client";

import { CircleCheck, Circle, CreditCard, PencilLine } from "lucide-react";
import { formatCivilDate } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { CardGroup, InvoiceView } from "../domain/month";
import { PAYMENT_LABELS } from "../domain/payment";
import type { CardCharge, EntryView, FinArea } from "../types";
import { AreaDot } from "./form-bits";

type Props = {
  groups: Array<{ areaId: string; total: string; entries: EntryView[] }>;
  /** Um bloco por cartão e vencimento: a linha do cartão (onde se paga) e as compras abaixo. */
  cards: CardGroup[];
  areaById: Map<string, FinArea>;
  /** Com "Todas" as áreas, cada área vira um bloco com o próprio total. */
  showAreaHeaders: boolean;
  /** Mostrar a área de cada compra do cartão (há mais de uma área e nenhum filtro). */
  showAreaTags: boolean;
  onPay: (entry: EntryView) => void;
  onUnpay: (entry: EntryView) => void;
  onSetAmount: (entry: EntryView) => void;
  onOpenEntry: (entry: EntryView) => void;
  onOpenCharge: (charge: CardCharge) => void;
  onOpenInvoice: (invoice: InvoiceView) => void;
  onPayInvoice: (invoice: InvoiceView) => void;
  onUnpayInvoice: (invoice: InvoiceView) => void;
};

const toggleClass = "flex size-10 shrink-0 items-center justify-center rounded-full outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring";

/** Botão à esquerda: pagar, desfazer o pagamento ou informar o valor. */
function PayToggle({ entry, onPay, onUnpay, onSetAmount }: Pick<Props, "onPay" | "onUnpay" | "onSetAmount"> & { entry: EntryView }) {
  const paid = entry.status === "pago";
  const unknown = !paid && entry.amountCents === null;
  const label = paid ? `Voltar para a pagar: ${entry.description}` : unknown ? `Informar valor: ${entry.description}` : `Pagar: ${entry.description}`;
  return (
    <button
      type="button"
      onClick={() => (paid ? onUnpay(entry) : unknown ? onSetAmount(entry) : onPay(entry))}
      aria-label={label}
      title={paid ? "Paga — voltar para a pagar" : unknown ? "Informar valor" : "Marcar como paga"}
      className={cn(toggleClass, paid ? "text-emerald-700" : entry.overdue ? "text-destructive" : "text-muted-foreground")}
      data-pay={paid ? "paga" : unknown ? "valor" : "pagar"}
    >
      {paid ? <CircleCheck className="size-6" aria-hidden="true" /> : unknown ? <PencilLine className="size-5" aria-hidden="true" /> : <Circle className="size-6" aria-hidden="true" />}
    </button>
  );
}

function EntryRow({ entry, ...handlers }: Pick<Props, "onPay" | "onUnpay" | "onSetAmount" | "onOpenEntry"> & { entry: EntryView }) {
  const paid = entry.status === "pago";
  const meta = [
    paid ? `Paga em ${formatCivilDate(entry.paidOn ?? entry.dueDate)}` : `Vence ${formatCivilDate(entry.dueDate).slice(0, 5)}`,
    entry.paymentMethod && PAYMENT_LABELS[entry.paymentMethod],
    entry.kind === "parcela" && entry.installmentNumber && entry.installmentCount ? `Parcela ${entry.installmentNumber} de ${entry.installmentCount}` : null,
    entry.kind === "recorrente" || entry.kind === "variavel" ? "Recorrente" : null,
    entry.category,
  ].filter(Boolean);
  return (
    <li className="flex items-center gap-1 py-1 pr-3 pl-1" data-entry-id={entry.id} data-row="conta" data-status={entry.status}>
      <PayToggle entry={entry} {...handlers} />
      <button
        type="button"
        onClick={() => handlers.onOpenEntry(entry)}
        aria-label={`Abrir ${entry.description}`}
        className="flex min-h-12 min-w-0 flex-1 items-center gap-3 rounded-lg px-1 text-left outline-none hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="min-w-0 flex-1">
          <span className={cn("block font-medium break-words", paid && "text-muted-foreground")}>{entry.description}</span>
          <span className="block text-sm text-muted-foreground">{meta.join(" · ")}</span>
        </span>
        <span className="shrink-0 text-right">
          {entry.amountCents === null ? (
            <span className="text-sm text-amber-800 italic">Valor a informar</span>
          ) : (
            <span className={cn("font-semibold tabular-nums", paid && "font-normal text-muted-foreground")}>{formatCents(entry.amountCents)}</span>
          )}
          {entry.overdue && <span className="block text-xs font-medium text-destructive">Atrasada</span>}
        </span>
      </button>
    </li>
  );
}

/** Compra do cartão, subordinada à linha do cartão: sem pagamento próprio (é paga junto com a fatura). */
function ChargeRow({ charge, area, onOpenCharge }: { charge: CardCharge; area: FinArea | undefined; onOpenCharge: (c: CardCharge) => void }) {
  return (
    <li data-charge-id={charge.id} data-row="cartao">
      <button
        type="button"
        onClick={() => onOpenCharge(charge)}
        aria-label={`Abrir compra ${charge.description}`}
        className="flex min-h-11 w-full items-center gap-3 py-1.5 pr-4 pl-13 text-left text-sm outline-none hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        <span className="min-w-0 flex-1">
          <span className="block break-words">{charge.description}</span>
          <span className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
            <span>{charge.count > 1 ? `Parcela ${charge.number} de ${charge.count}` : "À vista"}</span>
            {area && (
              <span className="inline-flex items-center gap-1" data-charge-area="">
                · <AreaDot color={area.color} className="size-2" />
                {area.name}
              </span>
            )}
            {charge.category && <span>· {charge.category}</span>}
          </span>
        </span>
        <span className="shrink-0 tabular-nums">{formatCents(charge.amountCents)}</span>
      </button>
    </li>
  );
}

/** Cartão no mês: a linha da fatura (nome, vencimento, total e pagamento) e, abaixo, as compras dela. */
function CardSection({ group, areaById, showAreaTags, onOpenCharge, onOpenInvoice, onPayInvoice, onUnpayInvoice }: Pick<Props, "areaById" | "showAreaTags" | "onOpenCharge" | "onOpenInvoice" | "onPayInvoice" | "onUnpayInvoice"> & { group: CardGroup }) {
  const { invoice } = group;
  const paid = invoice.status === "pago";
  const meta = [
    paid ? `Paga em ${formatCivilDate(invoice.paidOn ?? invoice.dueDate)}` : `Vence ${formatCivilDate(invoice.dueDate).slice(0, 5)}`,
    group.scoped ? "só as compras desta área" : !paid && invoice.statedCents === null ? "total da fatura não informado" : null,
  ].filter(Boolean);
  return (
    <section aria-label={`Cartão ${invoice.cardName}, vence em ${formatCivilDate(invoice.dueDate)}`} className="rounded-xl border bg-card shadow-xs" data-card-group={invoice.id} data-invoice-id={invoice.id} data-status={invoice.status}>
      <div className="flex items-center gap-1 py-1 pr-3 pl-1">
        <button
          type="button"
          onClick={() => (paid ? onUnpayInvoice(invoice) : onPayInvoice(invoice))}
          aria-label={paid ? `Voltar para a pagar: ${invoice.cardName}` : `Pagar cartão: ${invoice.cardName}`}
          title={paid ? "Paga — voltar para a pagar" : "Marcar como paga"}
          className={cn(toggleClass, paid ? "text-emerald-700" : invoice.overdue ? "text-destructive" : "text-muted-foreground")}
          data-pay={paid ? "paga" : "pagar"}
        >
          {paid ? <CircleCheck className="size-6" aria-hidden="true" /> : <Circle className="size-6" aria-hidden="true" />}
        </button>
        <button
          type="button"
          onClick={() => onOpenInvoice(invoice)}
          aria-label={`Abrir fatura do ${invoice.cardName}`}
          className="flex min-h-12 min-w-0 flex-1 items-center gap-3 rounded-lg px-1 text-left outline-none hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="min-w-0 flex-1">
            <span className={cn("flex items-center gap-1.5 font-semibold", paid && "text-muted-foreground")}>
              <CreditCard className="size-4 shrink-0" aria-hidden="true" />
              <span className="break-words">{invoice.cardName}</span>
            </span>
            <span className="block text-sm text-muted-foreground" data-card-meta="">
              {meta.join(" · ")}
            </span>
          </span>
          <span className="shrink-0 text-right">
            <span className={cn("font-semibold tabular-nums", paid && "font-normal text-muted-foreground")} data-card-total="">
              {formatCents(group.cents)}
            </span>
            {invoice.overdue && <span className="block text-xs font-medium text-destructive">Atrasada</span>}
          </span>
        </button>
      </div>
      {(group.charges.length > 0 || group.remainderCents !== null) && (
        <ul className="border-t py-1" aria-label={`Compras no ${invoice.cardName}`}>
          {group.charges.map((charge) => (
            <ChargeRow key={charge.id} charge={charge} area={showAreaTags ? areaById.get(charge.areaId) : undefined} onOpenCharge={onOpenCharge} />
          ))}
          {group.remainderCents !== null && (
            <li className="flex min-h-11 items-center gap-3 py-1.5 pr-4 pl-13 text-sm text-muted-foreground" data-remainder="">
              <span className="min-w-0 flex-1">{group.remainderCents > 0 ? "Outros valores da fatura" : "Ajuste: total menor que as compras"}</span>
              <span className="shrink-0 tabular-nums">{formatCents(group.remainderCents)}</span>
            </li>
          )}
          {group.hiddenCount > 0 && (
            <li className="py-1.5 pr-4 pl-13 text-xs text-muted-foreground" data-hidden-charges="">
              {group.hiddenCount === 1 ? "+ 1 compra de outra área" : `+ ${group.hiddenCount} compras de outras áreas`}
            </li>
          )}
        </ul>
      )}
    </section>
  );
}

/** Contas do mês separadas por área (cada área com o próprio total) e, depois, um bloco por cartão. */
export function MonthList({ groups, cards, areaById, showAreaHeaders, showAreaTags, ...handlers }: Props) {
  return (
    <div className="flex flex-col gap-3">
      {groups.map((group) => {
        const area = areaById.get(group.areaId);
        const headingId = `area-${group.areaId}`;
        return (
          <section key={group.areaId} aria-labelledby={showAreaHeaders ? headingId : undefined} aria-label={showAreaHeaders ? undefined : "Contas"} className="rounded-xl border bg-card shadow-xs" data-area-group={group.areaId}>
            {showAreaHeaders && (
              <div className="flex items-center justify-between gap-3 border-b px-4 py-2.5">
                <h3 id={headingId} className="flex min-w-0 items-center gap-2 font-semibold">
                  {area && <AreaDot color={area.color} className="size-3" />}
                  <span className="truncate">{area?.name ?? "Área"}</span>
                </h3>
                <span className="shrink-0 font-semibold tabular-nums" data-area-total="">
                  {group.total}
                </span>
              </div>
            )}
            <ul className="divide-y">
              {group.entries.map((entry) => (
                <EntryRow key={entry.id} entry={entry} {...handlers} />
              ))}
            </ul>
          </section>
        );
      })}
      {cards.map((group) => (
        <CardSection key={group.invoice.id} group={group} areaById={areaById} showAreaTags={showAreaTags} {...handlers} />
      ))}
    </div>
  );
}
