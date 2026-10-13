"use client";

import { useFormStatus } from "react-dom";
import { Loader2, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { signOutAction } from "@/lib/auth/actions";
import { cn } from "@/lib/utils";

function SubmitButton({ className }: { className?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="outline" disabled={pending} className={cn("h-10 gap-2", className)}>
      {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <LogOut aria-hidden="true" />}
      {pending ? "Saindo…" : "Sair"}
    </Button>
  );
}

/** Logout por POST, via Server Action. */
export function SignOutButton({ className }: { className?: string }) {
  return (
    <form action={signOutAction}>
      <SubmitButton className={className} />
    </form>
  );
}
