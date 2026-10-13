"use client";

import { useCallback, useState } from "react";
import { ChevronRight, CreditCard, Landmark, Plus, QrCode } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { FinArea, FinCard } from "../types";
import { CardFormDialog } from "./card-form-dialog";
import { ConfirmDialog, type ConfirmRequest } from "./confirm-dialog";
import { AreaDot, NoticeRegion, useNotice } from "./form-bits";

type Props = { cards: FinCard[]; areas: FinArea[]; /** Abre o cadastro de cartão ao carregar (link "Cadastrar cartão"). */ openNewCard?: boolean };

/** Formas de pagamento: cartões ativos primeiro, depois Pix e boleto; cartões arquivados no fim, apagados. */
export function CardsManager({ cards, areas, openNewCard }: Props) {
  const [notice, showNotice] = useNotice();
  const [editing, setEditing] = useState<{ open: boolean; card: FinCard | null }>({ open: Boolean(openNewCard), card: null });
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const done = useCallback(
    (message: string) => {
      setEditing({ open: false, card: null });
      setConfirm(null);
      showNotice(message);
    },
    [showNotice],
  );
  const areaById = new Map(areas.map((a) => [a.id, a]));
  const active = cards.filter((c) => !c.archived);
  const archived = cards.filter((c) => c.archived);

  const cardRow = (card: FinCard) => {
    const area = card.defaultAreaId ? areaById.get(card.defaultAreaId) : undefined;
    return (
      <li key={card.id} data-card={card.id} data-archived={card.archived ? "" : undefined}>
        <button
          type="button"
          onClick={() => setEditing({ open: true, card })}
          aria-label={`Editar ${card.name}`}
          className={cn("flex w-full items-center gap-3 px-4 py-3 text-left outline-none hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset", card.archived && "opacity-60")}
        >
          <CreditCard className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <span className="block font-medium">
              {card.name}
              {card.archived && <span className="ml-2 text-xs font-normal text-muted-foreground">Arquivado</span>}
            </span>
            <span className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
              <span>
                Fecha dia {card.closingDay} · vence dia {card.dueDay}
              </span>
              {area && (
                <span className="inline-flex items-center gap-1" data-card-default-area="">
                  · <AreaDot color={area.color} />
                  {area.name}
                </span>
              )}
            </span>
          </span>
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </button>
      </li>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button className="h-10 px-4" onClick={() => setEditing({ open: true, card: null })}>
          <Plus aria-hidden="true" />
          Cadastrar cartão
        </Button>
      </div>
      <NoticeRegion notice={notice} />
      <section aria-label="Formas de pagamento" className="rounded-xl border bg-card shadow-xs">
        <ul className="divide-y">
          {active.map(cardRow)}
          {active.length === 0 && <li className="px-4 py-4 text-sm text-muted-foreground">Nenhum cartão cadastrado.</li>}
          {(
            [
              ["pix", "Pix", QrCode],
              ["boleto", "Boleto", Landmark],
            ] as const
          ).map(([key, label, Icon]) => (
            <li key={key} className="flex items-center gap-3 px-4 py-3" data-method={key}>
              <Icon className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="font-medium">{label}</span>
            </li>
          ))}
          {archived.map(cardRow)}
        </ul>
      </section>

      <CardFormDialog
        open={editing.open}
        onOpenChange={(o) => setEditing((c) => ({ open: o, card: o ? c.card : null }))}
        card={editing.card}
        areas={areas}
        onSuccess={done}
        onAskConfirm={(request) => {
          setEditing({ open: false, card: null });
          setConfirm(request);
        }}
      />
      <ConfirmDialog request={confirm} onOpenChange={(o) => !o && setConfirm(null)} onSuccess={done} />
    </div>
  );
}
