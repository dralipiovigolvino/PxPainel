"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import type { ActionState } from "../actions";
import { FormError, useActionOutcome } from "./form-bits";

const initial: ActionState = { status: "idle" };

export type ConfirmRequest = {
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  fields: Record<string, string>;
};

type Props = {
  request: ConfirmRequest | null;
  onOpenChange: (open: boolean) => void;
  onSuccess: (message: string) => void;
};

/** Confirmação que só fecha depois que o servidor confirma a operação. */
export function ConfirmDialog({ request, onOpenChange, onSuccess }: Props) {
  return (
    <AlertDialog open={request !== null} onOpenChange={onOpenChange}>
      <AlertDialogContent>{request && <ConfirmForm request={request} onSuccess={onSuccess} />}</AlertDialogContent>
    </AlertDialog>
  );
}

function ConfirmForm({ request, onSuccess }: { request: ConfirmRequest; onSuccess: (m: string) => void }) {
  const [state, action, pending] = useActionState(request.action, initial);
  useActionOutcome(state, onSuccess);

  return (
    <form action={action} className="flex flex-col gap-4">
      <AlertDialogHeader>
        <AlertDialogTitle>{request.title}</AlertDialogTitle>
        <AlertDialogDescription>{request.description}</AlertDialogDescription>
      </AlertDialogHeader>
      {Object.entries(request.fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <FormError state={state} />
      <AlertDialogFooter>
        <AlertDialogCancel className="h-10">Cancelar</AlertDialogCancel>
        <Button type="submit" variant={request.destructive ? "destructive" : "default"} disabled={pending} className="h-10 px-4">
          {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
          {request.confirmLabel}
        </Button>
      </AlertDialogFooter>
    </form>
  );
}
