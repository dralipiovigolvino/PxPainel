"use client";

import { useActionState, useCallback, useState, useTransition } from "react";
import { Archive, ArchiveRestore, ChevronRight, MoreHorizontal, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { CivilDate } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { NoticeRegion, useActionOutcome, useNotice } from "@/modules/financas/components/form-bits";
import { archiveTemplateAction, type ActionState } from "../actions";
import { stepLabel } from "../domain/messages";
import type { FuTemplate } from "../types";
import { TemplateFormDialog } from "./template-form-dialog";

const initial: ActionState = { status: "idle" };

export function TemplatesManager({ templates, today }: { templates: FuTemplate[]; today: CivilDate }) {
  const [notice, showNotice] = useNotice();
  const [editing, setEditing] = useState<{ open: boolean; template: FuTemplate | null }>({ open: false, template: null });
  const done = useCallback(
    (message: string) => {
      setEditing({ open: false, template: null });
      showNotice(message);
    },
    [showNotice],
  );
  const [archiveState, archiveAction] = useActionState(archiveTemplateAction, initial);
  useActionOutcome(archiveState, done);
  const [, startArchive] = useTransition();
  const toggleArchive = (t: FuTemplate) => {
    const fd = new FormData();
    fd.set("id", t.id);
    fd.set("archive", String(!t.archived));
    startArchive(() => archiveAction(fd));
  };
  // Ativos primeiro; arquivados no fim, apagados (sem seção própria).
  const ordered = [...templates.filter((t) => !t.archived), ...templates.filter((t) => t.archived)];

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Button className="h-10 px-4" onClick={() => setEditing({ open: true, template: null })}>
          <Plus aria-hidden="true" />
          Novo modelo
        </Button>
      </div>
      <NoticeRegion notice={notice} />
      {archiveState.status === "error" && (
        <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {archiveState.message}
        </p>
      )}
      {ordered.length === 0 ? (
        <p className="rounded-xl border bg-card px-4 py-8 text-center text-sm text-muted-foreground shadow-xs">Nenhum modelo ainda. Crie o primeiro.</p>
      ) : (
        <ul className="divide-y rounded-xl border bg-card shadow-xs" aria-label="Modelos">
          {ordered.map((t) => (
            <li key={t.id} className={cn("flex items-center gap-1 pr-2", t.archived && "opacity-60")} data-template="" data-template-version={t.version} data-archived={t.archived ? "" : undefined}>
              <button
                type="button"
                onClick={() => setEditing({ open: true, template: t })}
                aria-label={`Editar modelo ${t.name}`}
                className="flex min-w-0 flex-1 items-center gap-3 py-3 pl-4 text-left outline-none hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
              >
                <span className="min-w-0 flex-1">
                  <span className="block font-medium break-words">
                    {t.name}
                    {t.archived && <span className="ml-2 text-xs font-normal text-muted-foreground">Arquivado</span>}
                  </span>
                  {t.description && <span className="block text-sm break-words whitespace-pre-wrap text-muted-foreground">{t.description}</span>}
                  <span className="mt-1 flex flex-wrap gap-1.5">
                    {t.steps.map((s) => (
                      <span key={s.dayOffset} className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium tabular-nums">
                        {stepLabel(s.dayOffset)}
                      </span>
                    ))}
                  </span>
                  {t.durationDays !== null && (
                    <span className="mt-1 block text-sm text-muted-foreground" data-template-duration="">
                      Duração: {t.durationDays} dias após a consulta · aviso {t.noticeDays === 0 ? "só no último dia" : `${t.noticeDays} dia(s) antes do término`}.
                    </span>
                  )}
                </span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="size-10 shrink-0" aria-label={`Ações do modelo ${t.name}`}>
                    <MoreHorizontal aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem onSelect={() => toggleArchive(t)}>
                    {t.archived ? <ArchiveRestore aria-hidden="true" /> : <Archive aria-hidden="true" />}
                    {t.archived ? "Restaurar" : "Arquivar"}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          ))}
        </ul>
      )}
      <TemplateFormDialog
        open={editing.open}
        onOpenChange={(o) => setEditing((c) => ({ open: o, template: o ? c.template : null }))}
        template={editing.template}
        today={today}
        onSuccess={done}
      />
    </div>
  );
}
