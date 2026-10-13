// Cria (ou reconfigura) as contas FICTÍCIAS A e B usadas nos testes de isolamento,
// pela API admin do Neon Auth, sem abrir cadastro público.
//
// - Você entra com a SUA conta admin (a senha é digitada sem eco e não é guardada).
// - A e B recebem o papel "painel" e senhas aleatórias.
// - E-mails, senhas e ids de A e B são gravados em .env.local (RLS_TEST_*), nunca impressos.
//
// Uso: npm run auth:create-test-users

import { randomBytes } from "node:crypto";
import { assertBranch } from "./lib/branch-guard.mjs";
import { setEnvVar } from "./lib/env-file.mjs";
import { ask, createAuthHttp } from "./lib/neon-auth-http.mjs";

assertBranch("auth:create-test-users");
const { call } = createAuthHttp();

const adminEmail = process.env.ADMIN_EMAIL || (await ask("E-mail da sua conta admin: "));
const adminPassword = await ask("Senha da sua conta admin (não aparece): ", { hidden: true });

const signIn = await call("POST", "sign-in/email", { email: adminEmail, password: adminPassword });
if (!signIn.ok) {
  console.error(`Não foi possível entrar como admin (HTTP ${signIn.status}, código ${signIn.code ?? "?"}).`);
  process.exit(1);
}

const tag = process.env.RLS_TEST_TAG ?? "painel";
const accounts = [
  { key: "A", email: `teste-a.${tag}@example.com`, name: "Conta Teste A" },
  { key: "B", email: `teste-b.${tag}@example.com`, name: "Conta Teste B" },
];

let failed = false;
for (const account of accounts) {
  const password = randomBytes(24).toString("base64url");
  let id;
  const created = await call("POST", "admin/create-user", {
    email: account.email,
    password,
    name: account.name,
    role: "painel",
  });
  if (created.ok) {
    id = created.data?.user?.id;
  } else {
    // Já existe: localiza e redefine senha e papel.
    const list = await call("GET", `admin/list-users?searchField=email&searchOperator=contains&searchValue=${encodeURIComponent(account.email)}&limit=5`);
    id = list.data?.users?.find((u) => u.email === account.email)?.id;
    const setPassword = id && (await call("POST", "admin/set-user-password", { userId: id, newPassword: password }));
    const setRole = id && (await call("POST", "admin/set-role", { userId: id, role: "painel" }));
    if (!id || !setPassword?.ok || !setRole?.ok) {
      console.error(`Conta ${account.key}: não foi possível criar nem reconfigurar (HTTP ${created.status}, código ${created.code ?? "?"}).`);
      failed = true;
      continue;
    }
  }
  setEnvVar(`RLS_TEST_${account.key}_EMAIL`, account.email);
  setEnvVar(`RLS_TEST_${account.key}_PASSWORD`, password);
  setEnvVar(`RLS_TEST_${account.key}_ID`, id);
  console.log(`Conta ${account.key} pronta (papel "painel"); dados gravados em .env.local.`);
}

await call("POST", "sign-out", {});
process.exit(failed ? 1 : 0);
