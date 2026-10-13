// Impede operações de banco fora da branch esperada.
// NEON_BRANCH é gravada em .env.local pelo `neon link`.

export function assertBranch(action) {
  const branch = process.env.NEON_BRANCH;
  const allowed = process.env.DB_ALLOW_BRANCH ?? "development";
  if (!branch) {
    console.error(`${action}: NEON_BRANCH ausente em .env.local (rode "neon link --branch development").`);
    process.exit(2);
  }
  if (branch !== allowed) {
    console.error(
      `${action}: a pasta está ligada à branch "${branch}", mas a operação só é permitida em "${allowed}". ` +
        `Para outra branch, defina DB_ALLOW_BRANCH=${branch} conscientemente.`,
    );
    process.exit(2);
  }
  return branch;
}

/** Descrição segura de uma URL de conexão: papel e endpoint, sem senha. */
export function describeDbUrl(value) {
  const url = new URL(value);
  return `papel=${decodeURIComponent(url.username)} endpoint=${url.hostname.split(".")[0]} banco=${url.pathname.slice(1)}`;
}
