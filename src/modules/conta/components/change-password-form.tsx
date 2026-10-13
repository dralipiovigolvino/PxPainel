"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { PasswordInput } from "@/components/password-input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PASSWORD_MAX, PASSWORD_MIN } from "@/lib/auth/password-policy";
import { cn } from "@/lib/utils";
import { changePasswordAction, type ChangePasswordState } from "../password-actions";

const initialState: ChangePasswordState = { status: "idle" };

export function ChangePasswordForm() {
  const [state, formAction, pending] = useActionState(changePasswordAction, initialState);
  const isError = state.status === "error";

  return (
    <form action={formAction} className="flex max-w-md flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="currentPassword">Senha atual</Label>
        <PasswordInput id="currentPassword" name="currentPassword" autoComplete="current-password" required className="h-10" />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="newPassword">Nova senha</Label>
        <PasswordInput
          id="newPassword"
          name="newPassword"
          autoComplete="new-password"
          required
          minLength={PASSWORD_MIN}
          maxLength={PASSWORD_MAX}
          aria-describedby="nova-senha-ajuda"
          className="h-10"
        />
        <p id="nova-senha-ajuda" className="text-sm text-muted-foreground">
          Mínimo de {PASSWORD_MIN} caracteres.
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="confirmation">Confirme a nova senha</Label>
        <PasswordInput id="confirmation" name="confirmation" autoComplete="new-password" required maxLength={PASSWORD_MAX} className="h-10" />
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Button type="submit" disabled={pending} className="h-10 px-4">
          {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
          {pending ? "Alterando…" : "Alterar senha"}
        </Button>
        <p
          id="senha-status"
          role={isError ? "alert" : "status"}
          className={cn("min-h-5 text-sm", isError ? "text-destructive" : "text-muted-foreground")}
        >
          {state.status !== "idle" && !pending ? state.message : ""}
        </p>
      </div>
    </form>
  );
}
