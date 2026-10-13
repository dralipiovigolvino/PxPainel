import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">Página não encontrada</h1>
      <p className="text-muted-foreground">O endereço acessado não existe neste sistema.</p>
      <Button asChild className="h-10 px-4">
        <Link href="/">Voltar ao Dashboard</Link>
      </Button>
    </main>
  );
}
