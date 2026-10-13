"use client";

import { useCallback, useState } from "react";
import { ChevronRight, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { FinArea } from "../types";
import { AreaFormDialog } from "./area-form-dialog";
import { ConfirmDialog, type ConfirmRequest } from "./confirm-dialog";
import { AreaDot, NoticeRegion, useNotice } from "./form-bits";

/** Áreas numa lista só: ativas primeiro, arquivadas no fim (apagadas). Editar, arquivar e excluir ficam no diálogo. */
export function AreasManager({ areas }: { areas: FinArea[] }) {
  const [notice, showNotice] = useNotice();
  const [editing, setEditing] = useState<{ open: boolean; area: FinArea | null }>({ open: false, area: null });
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const done = useCallback(
    (message: string) => {
      setEditing({ open: false, area: null });
      setConfirm(null);
      showNotice(message);
    },
    [showNotice],
  );
  // listAreas já ordena: ativas e depois arquivadas, por nome.
  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button className="h-10 px-4" onClick={() => setEditing({ open: true, area: null })}>
          <Plus aria-hidden="true" />
          Nova área
        </Button>
      </div>
      <NoticeRegion notice={notice} />
      {areas.length === 0 ? (
        <p className="rounded-xl border bg-card px-4 py-8 text-center text-sm text-muted-foreground shadow-xs">Nenhuma área ainda. Crie uma para lançar contas.</p>
      ) : (
        <ul className="divide-y rounded-xl border bg-card shadow-xs" aria-label="Áreas">
          {areas.map((area) => (
            <li key={area.id} data-area={area.id} data-archived={area.archived ? "" : undefined}>
              <button
                type="button"
                onClick={() => setEditing({ open: true, area })}
                aria-label={`Editar ${area.name}`}
                className={cn("flex w-full items-center gap-3 px-4 py-3 text-left outline-none hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset", area.archived && "opacity-60")}
              >
                <AreaDot color={area.color} className="size-3.5" />
                <span className="min-w-0 flex-1 truncate font-medium">{area.name}</span>
                {area.archived && <span className="text-xs text-muted-foreground">Arquivada</span>}
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <AreaFormDialog
        open={editing.open}
        onOpenChange={(open) => setEditing((current) => ({ open, area: open ? current.area : null }))}
        area={editing.area}
        onSuccess={done}
        onAskConfirm={(request) => {
          setEditing({ open: false, area: null });
          setConfirm(request);
        }}
      />
      <ConfirmDialog request={confirm} onOpenChange={(open) => !open && setConfirm(null)} onSuccess={done} />
    </div>
  );
}
