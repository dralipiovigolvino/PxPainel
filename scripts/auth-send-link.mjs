// Envia a um usuário JÁ CRIADO administrativamente o link para definir/redefinir a senha.
// O link leva a APP_URL/redefinir-senha (padrão http://localhost:3000) e expira em 15 minutos.
// Não cria contas: o cadastro público continua bloqueado.
//
// Uso: npm run auth:send-link -- email@exemplo.com

import { assertBranch } from "./lib/branch-guard.mjs";
import { APP_URL, createAuthHttp } from "./lib/neon-auth-http.mjs";

assertBranch("auth:send-link");
const email = process.argv[2]?.trim();
if (!email || !/^[^\s@]+@[^\s@]+$/.test(email)) {
  console.error("Informe o e-mail: npm run auth:send-link -- email@exemplo.com");
  process.exit(2);
}

const { call } = createAuthHttp();
const result = await call("POST", "request-password-reset", { email, redirectTo: `${APP_URL}/redefinir-senha` });
if (!result.ok) {
  console.error(`Falha ao solicitar o link (HTTP ${result.status}, código ${result.code ?? "?"}).`);
  process.exit(1);
}
console.log(
  "Pedido aceito. Se o e-mail pertence a um usuário existente, o link foi enviado (expira em 15 minutos).\n" +
    `Mantenha o app rodando em ${APP_URL} ao abrir o link.`,
);
