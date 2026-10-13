# Meu Painel

Sistema web pessoal e responsivo com seis áreas: **Dashboard**, **Finanças**, **Follow-up de pacientes**, **Plantões**, **Perícias** e **CNPJ**. A interface é em português do Brasil, com valores em reais e datas no fuso `America/Sao_Paulo`.

> **Estado atual (Neon, branch development):**
> - Login por e-mail e senha e logout com o **Neon Auth** (Managed Better Auth). Todas as rotas protegidas.
> - Dados no **Neon Postgres**, com RLS por usuário em todas as tabelas.
> - **Finanças:** Visão geral (entradas de plantões e perícias pelo dia em que o dinheiro entra, saídas com o imposto estimado do CNPJ, resultado, gráfico de 12 meses, próximos 30 dias e divisões por categoria, área e forma de pagamento), Mês (contas separadas por área e, de cada cartão, a linha da fatura com as compras abaixo; o total da fatura é informado por você e o pagamento é feito nessa linha), Recorrências (recorrentes e parceladas), Formas de pagamento (cartões, Pix e boleto) e Áreas.
> - **Follow-up**, **Plantões** e **Perícias** completos; **Dashboard** reúne o que vence, o que confirmar e os resumos do mês.
> - **CNPJ:** cadastro do CNPJ com o percentual estimado de imposto; plantões e perícias marcados como "Recebo por CNPJ" geram o imposto estimado, que entra como saída no mês seguinte ao do trabalho.
> - **Menu personalizável** (Minha conta → Menu): ordem dos módulos e módulos ocultos, por usuário.
>
> Use somente dados e contas **fictícios** no desenvolvimento.

## Tecnologias

| Pacote | Versão |
| --- | --- |
| Next.js (App Router, Turbopack) | 16.3.8 |
| React / React DOM | 19.2.8 |
| TypeScript (modo estrito) | 5.9.3 |
| Tailwind CSS | 4.3.3 |
| shadcn/ui (CLI, `radix-nova`) + radix-ui | 4.21.0 / 1.6.7 |
| lucide-react | 1.48.0 |
| @neondatabase/auth (Neon Auth, **beta**) | 0.5.0-beta (versão fixa) |
| @neondatabase/serverless (driver Postgres) | 1.1.0 |
| zod | 4.6.5 |
| ESLint + eslint-config-next / Vitest | 9.39.5 + 16.3.6 / 5.0.2 |
| Neon CLI (global, ferramenta de configuração) | 6.2.4 |

> O SDK oficial do Neon Auth só existe em versões beta (todas as 27 publicadas até 28/09/2026). A versão está fixada e deve ser revisada antes da publicação.

## Requisitos

- Node.js 22 ou superior (desenvolvido com o 24.19.0) e npm.
- Conta Neon com o projeto `young-unit-87419729` ("App Pessoal", região `aws-sa-east-1`, PostgreSQL 18, plano Free).
- Neon CLI: `npm i -g neon@6.2.4` e `neon auth` (login pelo navegador).
- Google Chrome, só para `npm run test:e2e`.
- Não é preciso Docker, Vercel nem GitHub.

## Branches do Neon

| Branch | Uso | Estado |
| --- | --- | --- |
| `production` | publicação futura | vazia (só o schema `public`), **sem Neon Auth** e sem tabelas do app. Não alterar agora. |
| `development` | desenvolvimento local | criada a partir da `production` vazia. Tem Neon Auth, a migração 0001 e o papel `app_runtime`. |

A pasta fica ligada à `development` pelo arquivo `.neon` (ignorado pelo Git), criado por:

```bash
neon link --project-id young-unit-87419729 --branch development -y
```

Esse comando também grava em `.env.local` as variáveis `DATABASE_URL`, `DATABASE_URL_UNPOOLED` e `NEON_BRANCH`. As duas URLs são do **dono** do banco (`neondb_owner`, com `BYPASSRLS`) e servem **somente** para migrações e provisionamento. O app recusa usá-las.

## Variáveis de ambiente

Todas ficam em `.env.local` (ignorado pelo Git). Nenhuma vai para o navegador.

| Variável | Uso | Como obter |
| --- | --- | --- |
| `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `NEON_BRANCH` | scripts de banco (dono) | `neon link` (acima) |
| `NEON_AUTH_BASE_URL` | app: Neon Auth da branch | `neon neon-auth status --branch development --output json` + `npm run env:set` (abaixo) |
| `NEON_AUTH_COOKIE_SECRET` | app: assina o cache de sessão (≥ 32 caracteres) | `npm run env:set -- NEON_AUTH_COOKIE_SECRET --random` |
| `APP_DATABASE_URL` | app: papel `app_runtime` (sem BYPASSRLS) | `npm run db:provision-runtime` |
| `APP_URL` (opcional) | links de senha e testes | padrão `http://localhost:3000` |
| `RLS_TEST_*` (opcional) | contas fictícias A e B | `npm run auth:create-test-users` |

Gravar a URL do Neon Auth sem exibi-la:

```bash
neon neon-auth status --branch development --output json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.stdout.write(JSON.parse(s).base_url))" | npm run env:set -- NEON_AUTH_BASE_URL
```

Comportamento com configuração incompleta:
- **Não há acesso**: todas as rotas vão para `/login`, que mostra "acesso indisponível".
- O terminal lista só os **nomes** das variáveis que faltam.

## Autenticação (Neon Auth)

- **Métodos:**
  - Somente e-mail e senha.
  - O **cadastro público está desligado** no serviço (`Disable Sign Up: true`), e o login social (Google, chaves compartilhadas do Neon) foi removido.
  - Conferir com: `neon neon-auth config email-password get --branch development` e `neon neon-auth oauth-provider list --branch development`.
- **Segunda barreira no app:**
  - Só entram contas com papel `admin` ou `painel`, atribuído administrativamente.
  - Uma conta criada por qualquer outro caminho recebe o papel padrão `user` e é recusada no servidor.
- **Sessão:**
  - Cookies `__Secure-neon-auth.*` (HttpOnly, Secure, SameSite=Lax). `localhost` é aceito como contexto seguro.
  - O SDK guarda a sessão validada num cookie assinado por **60 s** (`SESSION_CACHE_TTL_SECONDS`).
  - **Leituras** aceitam esse cache. **Gravações** revalidam a sessão no servidor do Neon Auth antes de gravar.
- **Login recusado pela barreira de papel:** a sessão recém-criada no Neon Auth é encerrada, além dos cookies.
- **Logout** (POST): encerra a sessão no Neon Auth e apaga os cookies. Limitação real:
  - Uma cópia dos cookies feita **antes** do logout ainda pode **ler** páginas por até 60 s.
  - Essa cópia não consegue **gravar**.

### Provisionar o usuário inicial (sem cadastro público)

A API administrativa do Neon cria usuários **sem senha**. A senha é definida por um link enviado por e-mail, que abre a tela `/redefinir-senha` do app.

1. Deixe o app rodando em `http://localhost:3000` (`npm run dev`).
2. Crie o usuário e dê o papel de administrador:

   ```bash
   neon neon-auth user create --email SEU_EMAIL --name "Seu nome" --branch development
   neon neon-auth user set-role ID_EXIBIDO_ACIMA --roles admin --branch development
   ```

3. Envie o link de senha: `npm run auth:send-link -- SEU_EMAIL`. O e-mail sai do provedor compartilhado do Neon (`auth@mail.myneon.app`) e o link expira em 15 minutos. Verifique também o spam.
4. Abra o link, defina a senha (mínimo de 12 caracteres) e entre em `/login`.

**Recuperação de acesso:** repita o passo 3. Não existe pedido de link público na tela de login.

**Troca de senha:** em **Minha conta → Senha**. Exige a senha atual e encerra as outras sessões.

> Em 28/09/2026 o e-mail do link (provedor compartilhado do Neon) **não chegou** à caixa do usuário. A senha inicial foi definida pelo mesmo fluxo `reset-password`, usando o token pendente lido do banco da branch de desenvolvimento, e gravada num arquivo local fora do projeto. Para produção, configure um provedor de e-mail próprio (`neon neon-auth config email-provider`) e teste a entrega.

### Contas fictícias para os testes de isolamento

```bash
npm run auth:create-test-users
```

- Pede o seu e-mail e a sua senha de admin. A senha é digitada sem eco e não é guardada.
- Cria `teste-a.painel@example.com` e `teste-b.painel@example.com` com o papel `painel` e senhas aleatórias, pela API admin.
- Grava `RLS_TEST_*` em `.env.local`, sem imprimir.

## Banco e migrações

- **Migrações:** ficam em `db/migrations/NNNN_nome.sql` e são aplicadas em ordem pelo **dono** do banco, uma transação por arquivo, com controle em `app_private.schema_migrations`.
- **Trava de branch:** os scripts só rodam na `development` (confere `NEON_BRANCH`).

```bash
npm run db:migrate -- --status   # lista aplicadas/pendentes
npm run db:migrate               # aplica pendentes
npm run db:provision-runtime     # (re)define a senha do app_runtime e grava APP_DATABASE_URL
```

Estratégia de acesso, RLS, regra de propriedade entre tabelas e backup: [docs/banco-de-dados.md](docs/banco-de-dados.md).

## Execução local

```bash
npm install
npm run dev        # http://localhost:3000
```

Produção local: `npm run build` e `npm run start`.

## Testes

```bash
npm run lint
npm run typecheck
npm test            # Vitest: datas, dinheiro (parser/limites), finanças (atraso, resumo, filtros, validação), auth…
npm run build
npm run test:rls    # RLS no Neon real com o papel app_runtime: preferências + finanças (A/B, visitante, FK composta, corridas)
npm run test:e2e    # login/sessão/preferências no Chrome (exige app rodando e contas A/B)
npm run test:e2e:financas  # Finanças no Chrome: áreas, formas de pagamento, Mês, recorrências, compra no cartão e Visão geral (dados "[teste-e2e]" da conta A, limpos ao final)
npm run test:e2e:followup  # Follow-up; test:e2e:plantoes, test:e2e:dashboard e test:e2e:ajustes cobrem os demais módulos
npm run test:e2e:acesso    # cadastro público bloqueado e barreira de papéis (rebaixa e restaura o papel da conta fictícia B)
npm run test:visual        # revisão de layout em 375/768/1280 px; capturas em VISUAL_SHOTS_DIR (fora do repositório)
npm run db:backup -- --out <pasta fora do repositório>   # backup lógico dos dados do app
npm run db:restore-drill   # ensaio de restauração numa branch descartável do Neon
```

Os testes de Finanças criam só registros identificáveis (`[teste-rls …]` e `[teste-e2e]`) nas contas fictícias e removem apenas esses registros ao final.

## Rotas

| Rota | Acesso | Tela |
| --- | --- | --- |
| `/login` | pública | Entrar |
| `/redefinir-senha?token=…` | pública | Definir senha (link recebido por e-mail) |
| `/`, `/follow-up`, `/plantoes` (`?mes=AAAA-MM`) | protegidas | Módulos |
| `/financas?mes=AAAA-MM` ou `?periodo=ano&ano=AAAA` (`&area=`, `&forma=`, `&categoria=`) | protegida | Visão geral: entradas, saídas (com imposto estimado) e resultado; com filtro, só as contas que combinam |
| `/financas/mes?mes=AAAA-MM&area=<uuid>&situacao=…` | protegida | Contas do mês por área e um bloco por cartão (fatura, compras, total informado e pagamento) |
| `/financas/recorrencias` | protegida | Contas recorrentes e parceladas em andamento |
| `/financas/formas-de-pagamento` | protegida | Cartões (ativos primeiro), Pix e boleto |
| `/financas/areas` | protegida | Áreas (arquivadas no fim da mesma lista) |
| `/pericias`, `/pericias/empresas` | protegidas | Agenda de perícias e empresas |
| `/plantoes/previsao` | protegida | Recebimentos previstos de plantões, por data |
| `/minha-conta` | protegida | Nome de exibição, menu, senha e "Sair" |
| `/cnpj` | protegida | Cadastro do CNPJ, percentual estimado de imposto e o imposto por mês (pago no mês seguinte ao trabalho) |

Endereços antigos (`/financas/visao`, `/financas/cartoes`, `/financas/parcelamentos`) redirecionam para as telas atuais.

Regras de Finanças (valores, datas, pagamento, atraso, áreas arquivadas, escopo dos filtros e totais): [docs/banco-de-dados.md](docs/banco-de-dados.md#finanças-migração-0002). Forma de pagamento: [docs/banco-de-dados.md](docs/banco-de-dados.md#forma-de-pagamento-e-compras-no-cartão-migração-0017). Fatura do cartão (total informado e pagamento): [docs/banco-de-dados.md](docs/banco-de-dados.md#fatura-do-cartão-total-informado-e-pagamento-migração-0018). O que mudou na simplificação das telas e os padrões de interface adotados: [docs/progresso-simplificacao.md](docs/progresso-simplificacao.md).

## Limitações e pendências

- SDK do Neon Auth em beta (0.5.0-beta), com avisos de conflito de dependências entre pacotes internos do próprio SDK.
- Leitura com cookies copiados antes do logout é aceita por até 60 s (as gravações são recusadas).
- Não foi possível comprovar se o login por código enviado por e-mail (OTP) respeita o bloqueio de cadastro: o teste exige receber um código real. A barreira por papel, validada no Neon real, impede o acesso de contas assim criadas, mas elas poderiam existir no Auth.
- A entrega de e-mails do provedor compartilhado do Neon falhou no teste (link de senha não recebido).
- Remover o papel de uma conta não derruba a sessão já aberta na hora: leva cerca de 1 minuto (cache de sessão do serviço). Um novo login é recusado imediatamente.
- O Neon Auth limita requisições: várias suítes e2e seguidas provocam respostas 429. Rode-as com intervalo; o app mostra "tente novamente" nesses casos.
- O plugin de organizações do Neon Auth está habilitado por padrão e não é usado.
- Sem MFA. A branch `production` ainda não foi configurada. Nada foi publicado.
- Backup dos dados do app com restauração provada ([docs/backup.md](docs/backup.md)); a recuperação de **identidades** (usuários e senhas do Neon Auth) e a entrega de e-mails continuam pendentes para uso real e produção.
- `npm audit`: 0 alertas nas dependências de produção; 8 alertas altos só em ferramentas de desenvolvimento (`braces`, sem versão corrigida). Detalhes em [docs/progresso-integracao-revisao.md](docs/progresso-integracao-revisao.md).
- Plano de publicação (não executado): [docs/publicacao.md](docs/publicacao.md).
