import "server-only";

import { createNeonAuth } from "@neondatabase/auth/next/server";
import { getServerConfig } from "@/lib/server-config";

/**
 * Tempo (s) em que a sessão validada fica em cache no cookie assinado.
 * Leituras aceitam esse cache; mutações revalidam no servidor do Neon Auth.
 */
export const SESSION_CACHE_TTL_SECONDS = 60;

type NeonAuth = ReturnType<typeof createNeonAuth>;
let instance: NeonAuth | null = null;

/** Instância única do Neon Auth, ou `null` se a configuração estiver ausente. */
export function getNeonAuth(): NeonAuth | null {
  if (instance) return instance;
  const config = getServerConfig();
  if (!config) return null;
  instance = createNeonAuth({
    baseUrl: config.authBaseUrl,
    cookies: { secret: config.cookieSecret, sessionDataTtl: SESSION_CACHE_TTL_SECONDS },
    logLevel: "warn",
  });
  return instance;
}

/** Códigos que o SDK usa para falhas de rede até o servidor de Auth. */
export function isAuthNetworkError(error: { code?: unknown; status?: unknown } | null | undefined): boolean {
  return typeof error?.code === "string" && error.code.startsWith("NETWORK_");
}
