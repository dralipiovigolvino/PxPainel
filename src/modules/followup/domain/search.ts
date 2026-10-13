/** Busca local (no navegador): sem acento, sem diferenciar maiúsculas; telefone pelos dígitos. */
export function normalizeSearch(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("pt-BR").replace(/\s+/g, " ").trim();
}

export function matchesPatientSearch(patient: { name: string; phone: string | null }, query: string): boolean {
  const q = normalizeSearch(query);
  if (q === "") return true;
  if (normalizeSearch(patient.name).includes(q)) return true;
  const digits = query.replace(/\D/g, "");
  return digits.length >= 3 && (patient.phone ?? "").replace(/\D/g, "").includes(digits);
}
