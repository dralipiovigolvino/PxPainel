"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { ChevronRight, MoreHorizontal, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { formatCnpj } from "@/lib/cnpj";
import { formatRate } from "@/lib/tax";
import { cn } from "@/lib/utils";
import { ConfirmDialog, type ConfirmRequest } from "@/modules/financas/components/confirm-dialog";
import { NoticeRegion, useNotice } from "@/modules/financas/components/form-bits";
import { deleteCnpjAction } from "../actions";
import type { Cnpj } from "../types";
import { CnpjForm } from "./cnpj-form";

/** Imposto estimado de um mês de pagamento (valores já formatados). */
export type CnpjTaxRow = {
  key: string;
  /** "Novembro de 2026". */
  payMonth: string;
  /** "20/11/2026". */
  dueDate: string;
  current: boolean;
  /** Mês do trabalho, em minúsculas ("outubro"). */
  workMonth: string;
  /** null = nada recebido por este CNPJ no mês do trabalho. */
  base: string | null;
  tax: string | null;
  /** "3 plantões e 1 perícia". */
  detail: string | null;
};

export type CnpjCard = Cnpj & { rows: CnpjTaxRow[] };

type Props = {
  cnpjs: CnpjCard[];
  suggestedRateBp: number;
  /** Nome do mês corrente, em minúsculas. */
  currentMonth: string;
};

export function CnpjManager({ cnpjs, suggestedRateBp, currentMonth }: Props) {
  const [notice, showNotice] = useNotice();
  const [editing, setEditing] = useState<{ open: boolean; cnpj: Cnpj | null }>({ open: false, cnpj: null });
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const done = useCallback(
    (m: string) => {
      setEditing({ open: false, cnpj: null });
      setConfirm(null);
      showNotice(m);
    },
    [showNotice],
  );

  return (
    <div className="flex flex-col gap-4">
      <NoticeRegion notice={notice} />
      {cnpjs.length === 0 ? (
        <section className="flex flex-col items-start gap-3 rounded-xl border bg-card p-4 shadow-xs" data-cnpj-empty="">
          <p className="font-medium">Cadastre o CNPJ pelo qual você recebe.</p>
          <p className="text-sm text-muted-foreground">
            Depois, marque &quot;Recebo por CNPJ&quot; nos plantões e nas perícias. O app estima o imposto e mostra como saída do mês seguinte ao trabalho, em Finanças.
          </p>
          <Button className="h-10 px-4" onClick={() => setEditing({ open: true, cnpj: null })} data-new-cnpj="">
            <Plus aria-hidden="true" />
            Cadastrar CNPJ
          </Button>
        </section>
      ) : (
        <>
          {cnpjs.map((c) => {
            const hasWork = c.rows.some((r) => r.base !== null);
            // Sem linhas zeradas: só os meses com imposto e o mês corrente.
            const rows = c.rows.filter((r) => r.base !== null || r.current);
            return (
              <section key={c.id} aria-label={c.name} className="rounded-xl border bg-card shadow-xs" data-cnpj={c.id}>
                <div className="flex items-center gap-1 pr-2">
                  <button
                    type="button"
                    onClick={() => setEditing({ open: true, cnpj: c })}
                    aria-label={`Editar ${c.name}`}
                    className="flex min-w-0 flex-1 items-center gap-3 rounded-tl-xl py-3 pl-4 text-left outline-none hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold break-words">{c.name}</span>
                      {c.number && (
                        <span className="block text-sm text-muted-foreground tabular-nums" data-cnpj-number="">
                          {formatCnpj(c.number)}
                        </span>
                      )}
                      <span className="block text-sm text-muted-foreground" data-cnpj-rule="">
                        Imposto estimado: <span className="font-medium text-foreground">{formatRate(c.taxRateBp)}</span> · pago no dia {c.taxDueDay} do mês seguinte ao trabalho
                      </span>
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  </button>
                  {c.links === 0 && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="size-10 shrink-0" aria-label={`Ações: ${c.name}`}>
                          <MoreHorizontal aria-hidden="true" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent>
                        <DropdownMenuItem
                          variant="destructive"
                          onSelect={() =>
                            setConfirm({ title: "Excluir CNPJ?", description: `"${c.name}" será excluído.`, confirmLabel: "Excluir", destructive: true, action: deleteCnpjAction, fields: { id: c.id } })
                          }
                        >
                          <Trash2 aria-hidden="true" />
                          Excluir
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
                <div className="border-t px-4 py-3">
                  <h2 className="text-sm font-semibold">Imposto estimado por mês</h2>
                  {hasWork ? (
                    <ul className="mt-1 divide-y" data-cnpj-taxes="">
                      {rows.map((r) => (
                        <li key={r.key} className="flex items-start justify-between gap-3 py-2 text-sm" data-cnpj-tax-month={r.key} data-current={r.current ? "" : undefined}>
                          <span className="min-w-0">
                            <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                              <span className={cn("font-medium", r.current && "text-primary")}>{r.payMonth}</span>
                              {r.current && <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">este mês</span>}
                            </span>
                            <span className="block text-muted-foreground">
                              {r.base === null ? `Nada por CNPJ em ${r.workMonth}.` : `Sobre ${r.workMonth}: ${r.base}${r.detail ? ` (${r.detail})` : ""} · vence ${r.dueDate}`}
                            </span>
                          </span>
                          <span className={cn("shrink-0 tabular-nums", r.tax === null ? "text-muted-foreground" : "font-semibold")} data-value="tax">
                            {r.tax ?? "—"}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1 text-sm text-muted-foreground" data-cnpj-no-work="">
                      Nada marcado como recebido por este CNPJ nestes meses. Marque &quot;Recebo por CNPJ&quot; em{" "}
                      <Link href="/plantoes" className="underline">
                        Plantões
                      </Link>{" "}
                      e em{" "}
                      <Link href="/pericias" className="underline">
                        Perícias
                      </Link>
                      .
                    </p>
                  )}
                </div>
              </section>
            );
          })}
          <p className="text-sm text-muted-foreground">
            O imposto do trabalho de um mês é pago no mês seguinte e entra como saída em{" "}
            <Link href="/financas" className="underline">
              Finanças → Visão geral
            </Link>
            . É uma estimativa: não substitui a apuração do contador.
          </p>
          <div>
            <Button variant="outline" className="h-10 px-4" onClick={() => setEditing({ open: true, cnpj: null })} data-new-cnpj="">
              <Plus aria-hidden="true" />
              Adicionar outro CNPJ
            </Button>
          </div>
        </>
      )}
      <Dialog open={editing.open} onOpenChange={(o) => setEditing((c) => ({ open: o, cnpj: o ? c.cnpj : null }))}>
        <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
          {editing.open && <CnpjForm cnpj={editing.cnpj} suggestedRateBp={suggestedRateBp} currentMonth={currentMonth} onSuccess={done} onCancel={() => setEditing({ open: false, cnpj: null })} />}
        </DialogContent>
      </Dialog>
      <ConfirmDialog request={confirm} onOpenChange={(o) => !o && setConfirm(null)} onSuccess={done} />
    </div>
  );
}
