import type { Metadata } from "next";
import { LoadError } from "@/components/load-error";
import { requireVerifiedUser } from "@/lib/auth/session";
import { todayInSaoPaulo } from "@/lib/dates";
import { TemplatesManager } from "@/modules/followup/components/templates-manager";
import { listTemplates } from "@/modules/followup/data";

export const metadata: Metadata = { title: "Follow-up · Modelos" };

export default async function ModelosPage() {
  const user = await requireVerifiedUser();
  let templates;
  try {
    templates = await listTemplates(user);
  } catch {
    return <LoadError />;
  }
  return <TemplatesManager templates={templates} today={todayInSaoPaulo()} />;
}
