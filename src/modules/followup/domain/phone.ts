/**
 * Telefone opcional (WhatsApp), guardado em E.164 ("+5511987654321").
 * Aceita formatação brasileira ("(11) 98765-4321", "011 98765-4321", "11987654321")
 * e internacional com "+" ou "00" ("+1 415 555 2671").
 */

export type PhoneResult = { ok: true; e164: string | null } | { ok: false; error: string };

const ALLOWED = /^[0-9\s().+\-]*$/;
export const PHONE_HINT = "DDD + número, ex.: (11) 98765-4321, ou internacional com +, ex.: +1 415 555 2671.";

/** Número nacional brasileiro (sem o 55): DDD + 8 dígitos (fixo) ou DDD + 9 + 8 dígitos (celular). */
function validBrazilian(national: string): boolean {
  if (!/^[1-9][1-9]\d{8,9}$/.test(national)) return false;
  if (national.length === 11) return national[2] === "9";
  return /[2-8]/.test(national[2]);
}

export function normalizePhone(input: unknown): PhoneResult {
  if (typeof input !== "string") return { ok: false, error: "Telefone inválido." };
  const raw = input.trim();
  if (raw === "") return { ok: true, e164: null };
  if (raw.length > 40 || !ALLOWED.test(raw)) return { ok: false, error: `Use só números, espaços, parênteses, hífen e +. ${PHONE_HINT}` };
  const plus = raw.indexOf("+");
  if (plus > 0 || raw.lastIndexOf("+") !== plus) return { ok: false, error: `O "+" só pode aparecer no início. ${PHONE_HINT}` };
  let digits = raw.replace(/\D/g, "");
  let international = plus === 0;
  if (!international && digits.startsWith("00")) {
    international = true;
    digits = digits.slice(2);
  }
  if (international) {
    if (digits.startsWith("55")) {
      return validBrazilian(digits.slice(2)) ? { ok: true, e164: `+${digits}` } : { ok: false, error: `Número brasileiro incompleto ou inválido. ${PHONE_HINT}` };
    }
    if (!/^[1-9]\d{7,14}$/.test(digits)) return { ok: false, error: `Número internacional deve ter de 8 a 15 dígitos após o +. ${PHONE_HINT}` };
    return { ok: true, e164: `+${digits}` };
  }
  // Nacional: tira o 0 de operadora/longa distância; aceita também o 55 sem "+".
  if (digits.startsWith("0")) digits = digits.replace(/^0+/, "");
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith("55") && validBrazilian(digits.slice(2))) return { ok: true, e164: `+${digits}` };
  if (!validBrazilian(digits)) return { ok: false, error: `Telefone incompleto ou inválido. ${PHONE_HINT}` };
  return { ok: true, e164: `+55${digits}` };
}

/** Exibição: "+55 (11) 98765-4321" / "+55 (11) 3333-4444"; demais países: E.164 sem agrupamento. */
export function formatPhone(e164: string | null): string {
  if (!e164) return "";
  if (e164.startsWith("+55") && (e164.length === 13 || e164.length === 14)) {
    const n = e164.slice(3);
    const ddd = n.slice(0, 2);
    const rest = n.slice(2);
    const split = rest.length === 9 ? 5 : 4;
    return `+55 (${ddd}) ${rest.slice(0, split)}-${rest.slice(split)}`;
  }
  return e164;
}

