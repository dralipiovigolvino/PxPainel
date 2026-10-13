"use client";

import { useActionState, useCallback, useState, useTransition } from "react";
import { Archive, ArchiveRestore, ChevronRight, MoreHorizontal, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { formatCents } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { CnpjOption } from "@/modules/cnpj/types";
import type { ActionState } from "@/modules/financas/actions";
import { ConfirmDialog, type ConfirmRequest } from "@/modules/financas/components/confirm-dialog";
import { NoticeRegion, useActionOutcome, useNotice } from "@/modules/financas/components/form-bits";
import { archiveCompanyAction, deleteCompanyAction } from "../actions";
import type { PerCompany } from "../types";
import { CompanyForm } from "./company-form";

const initial: ActionState = { status: "idle" };

/** Empresas numa lista só: ativas primeiro, arquivadas no fim (apagadas). */
export function CompaniesManager({ companies, cnpjs }: { companies: PerCompany[]; cnpjs: CnpjOption[] }) {
  const [notice, showNotice] = useNotice();
  const [editing, setEditing] = useState<{ open: boolean; company: PerCompany | null }>({ open: false, company: null });
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const done = useCallback(
    (m: string) => {
      setEditing({ open: false, company: null });
      setConfirm(null);
      showNotice(m);
    },
    [showNotice],
  );
  const [archiveState, archiveAction] = useActionState(archiveCompanyAction, initial);
  useActionOutcome(archiveState, done);
  const [, startArchive] = useTransition();
  const toggleArchive = (c: PerCompany) => {
    const fd = new FormData();
    fd.set("id", c.id);
    fd.set("archive", String(!c.archived));
    startArchive(() => archiveAction(fd));
  };
  const ordered = [...companies.filter((c) => !c.archived), ...companies.filter((c) => c.archived)];

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Button className="h-10 px-4" onClick={() => setEditing({ open: true, company: null })}>
          <Plus aria-hidden="true" />
          Nova empresa
        </Button>
      </div>
      <NoticeRegion notice={notice} />
      {archiveState.status === "error" && (
        <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {archiveState.message}
        </p>
      )}
      {ordered.length === 0 ? (
        <p className="rounded-xl border bg-card px-4 py-8 text-center text-sm text-muted-foreground shadow-xs">Nenhuma empresa ainda. Cadastre a primeira.</p>
      ) : (
        <ul className="divide-y rounded-xl border bg-card shadow-xs" aria-label="Empresas">
          {ordered.map((c) => {
            return (
              <li key={c.id} className={cn("flex items-center gap-1 pr-2", c.archived && "opacity-60")} data-company={c.id} data-archived={c.archived ? "" : undefined}>
                <button
                  type="button"
                  onClick={() => setEditing({ open: true, company: c })}
                  aria-label={`Editar ${c.name}`}
                  className="flex min-w-0 flex-1 items-center gap-3 py-3 pl-4 text-left outline-none hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium break-words">
                      {c.name}
                      {c.archived && <span className="ml-2 text-xs font-normal text-muted-foreground">Arquivada</span>}
                    </span>
                    <span className="block text-sm text-muted-foreground tabular-nums">
                      {formatCents(c.defaultAmountCents)} por perícia{c.cnpjId ? " · por CNPJ" : ""}
                    </span>
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                </button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="size-10 shrink-0" aria-label={`Ações: ${c.name}`}>
                      <MoreHorizontal aria-hidden="true" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuItem onSelect={() => toggleArchive(c)}>
                      {c.archived ? <ArchiveRestore aria-hidden="true" /> : <Archive aria-hidden="true" />}
                      {c.archived ? "Restaurar" : "Arquivar"}
                    </DropdownMenuItem>
                    {c.links === 0 && (
                      <DropdownMenuItem
                        variant="destructive"
                        onSelect={() =>
                          setConfirm({
                            title: "Excluir empresa?",
                            description: `"${c.name}" será excluída.`,
                            confirmLabel: "Excluir",
                            destructive: true,
                            action: deleteCompanyAction,
                            fields: { id: c.id },
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
            );
          })}
        </ul>
      )}
      <Dialog open={editing.open} onOpenChange={(o) => setEditing((c) => ({ open: o, company: o ? c.company : null }))}>
        <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-md">
          {editing.open && <CompanyForm company={editing.company} cnpjs={cnpjs} onSuccess={done} onCancel={() => setEditing({ open: false, company: null })} />}
        </DialogContent>
      </Dialog>
      <ConfirmDialog request={confirm} onOpenChange={(o) => !o && setConfirm(null)} onSuccess={done} />
    </div>
  );
}
