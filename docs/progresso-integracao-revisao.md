# Progresso — Dashboard integrado e revisão final (Etapas 13 e 14)

Arquivo de retomada. Não contém segredos, credenciais nem dados pessoais (testes usam só dados fictícios).

## Contexto de partida (03/10/2026)

- Projeto Neon `young-unit-87419729`, branch **development**. A `production` não é tocada.
- Migrações aplicadas: 0001 a 0010 (Finanças, Follow-up e Plantões concluídos; ver os demais documentos de progresso).
- Dashboard: só estados vazios fixos e um contrato inicial em `src/modules/dashboard/contract.ts`.
- Processos encontrados: um servidor `next start` da sessão anterior na porta 3000 (substituído após o novo build).

## Etapa 13 — Dashboard integrado

**Status: concluída e verificada no Neon real.**

Implementação:
- **Contrato** (`src/modules/dashboard/contract.ts`):
  - item com chave estável `fonte:tipo:id`, tipo de registro, natureza (pendência × compromisso), seção, situação de exibição, título, detalhe curto, data;
  - valor `none | unknown | known` (NULL nunca vira zero);
  - link interno e ações permitidas;
  - cobertura por módulo (geração pendente, aviso de incompletude).
- **Agregação pura** (`aggregate.ts`): seções Hoje / Atrasados / Próximos 7 dias / Plantões a confirmar; ordenação estável (data, módulo, tipo, título, id); resumo sobre o conjunto completo.
  - Exemplo do texto: "3 pagamentos — R$ 400,00 conhecidos + 1 valor a informar · 2 follow-ups · 2 plantões".
- **Regras em cada módulo** (`financas/dashboard.ts`, `followup/dashboard.ts`, `plantoes/dashboard.ts`), lidas das tabelas de origem a cada requisição (nenhuma cópia):
  - Finanças:
    - contas pendentes até hoje + 7, atrasadas de qualquer mês (inclusive de áreas ou cartões arquivados);
    - faturas inteiras pendentes com cobranças (cobranças nunca soltas);
    - pagas, canceladas e faturas vazias fora; variável sem valor = "Valor a informar".
  - Follow-up:
    - etapas pendentes de planos ativos (atrasadas, hoje, próximas), inclusive de paciente arquivado;
    - só nome, etapa (D7) e data; telefone, observação e mensagem não são enviados ao navegador.
  - Plantões:
    - classificação pura `classifyShift` sobre um único "agora" de São Paulo;
    - hoje, próximos, "em andamento" (inclusive o noturno iniciado ontem, uma vez só);
    - "a confirmar" = agendado já terminado (sem horário: dias anteriores); nada é realizado automaticamente;
    - valores só no resumo do mês (cálculos já testados da Etapa 12), sem misturar com contas a pagar.
- **Página inicial:**
  - `requireVerifiedUser` (sessão confirmada no servidor; fluxo único) e `nowInSaoPaulo()` calculado uma vez;
  - módulos carregados isoladamente: falha → "Painel parcial" + "Tentar novamente"; falha de autenticação interrompe a página inteira.
- **Geração:** se Finanças ou Plantões precisam gerar recorrências, o navegador chama as ações autenticadas existentes depois de montar a tela (nunca na renderização) e mostra "Atualizando…", sem zeros definitivos; erro informado.
- **Ações e links:**
  - "Pagar" reutiliza o diálogo de Finanças;
  - "Mensagem" e "Realizada" abrem os diálogos da página do paciente (mesmas validações; copiar não conclui);
  - faturas e plantões abrem o registro;
  - links de outro mês: `/financas?mes=…&conta=…` rola até a conta e a destaca; `/plantoes?mes=…&plantao=…` abre os detalhes.
- **Atualização:** toda mutação dos módulos também revalida "/".

Arquivos:
- `src/lib/dates.ts` (`nowInSaoPaulo`)
- `src/modules/dashboard/` (contract, aggregate + teste, components/dashboard-view, `dashboard.integration.test.ts`)
- `src/modules/{financas,followup,plantoes}/dashboard.ts`, `plantoes/domain/dashboard.ts` (+ teste)
- `src/app/(app)/page.tsx`
- links diretos: `financas/components/{finance-view,entries-list}.tsx`, `app/(app)/financas/page.tsx`, `plantoes/components/plantoes-view.tsx`, `app/(app)/plantoes/page.tsx`, `followup/components/{step-item,patient-detail}.tsx`, `app/(app)/follow-up/pacientes/[id]/page.tsx`
- revalidação de "/": `financas/actions.ts`, `financas/card-actions.ts`, `followup/actions.ts`, `plantoes/actions.ts`
- `scripts/e2e-dashboard.mjs`, `package.json` (`test:e2e:dashboard`)

Verificações:
- Unitários: virada do dia em São Paulo (UTC−3), virada de mês nos próximos 7 dias, plantão noturno e 24 h, resumo dos pagamentos, falha parcial e ordenação.
- Integração no Neon real: 6/6, cenário fictício com resultado calculado à mão:
  - hoje: 3 pagamentos, R$ 400 conhecidos + 1 a informar, fatura de R$ 300 com 2 cobranças contada uma vez; conta paga fora;
  - conta do mês anterior em Atrasados, com link para o mês certo;
  - follow-ups: hoje, atrasado, futuro e arquivado incluídos; realizado, cancelado e D30 fora;
  - plantões: hoje, noturno em andamento (uma vez), futuro, a confirmar; cancelado e realizado fora;
  - recorrências retroativas não geradas sinalizadas e, geradas (em paralelo, sem duplicar), aparecem;
  - isolamento A/B.
- Navegador: 38/38, incluindo:
  - conta vazia com estados vazios verdadeiros;
  - contadores completos com lista limitada a 5 e "Ver todos";
  - links de outro mês, fatura e plantão;
  - pagar pelo dashboard e atualização do resumo; "Realizada" na página do paciente e sumiço da pendência;
  - geração pelo acesso direto; falha parcial real (leitura de `pl_types` revogada e restaurada) e "Tentar novamente";
  - sessão revogada sem nomes de pacientes; B sem dados de A;
  - 375/768/1280 sem rolagem e alvos ≥ 24 px.

Correções durante a etapa:
- Expectativa do teste com contagem manual errada: o paciente arquivado também tinha D1 e D7 na janela; o código estava certo.
- Títulos-link dos itens com 20 px de altura → mínimo de 24 px.
- "Valor a informar" duplicado no item variável.

Pendências: nenhuma bloqueante. A virada do dia no navegador não foi simulada (o servidor usa o relógio real); está coberta por testes unitários com instantes fixos.


## Etapa 14 — Revisão e preparação para publicação

**Status: em andamento (não concluída).** Nada publicado; production não alterada; sem commit ou push.

### Concluído em 03/10/2026 (sessão anterior, resultados completos)

- **Backup e restauração dos dados do app** — ensaio `npm run db:restore-drill`: **28/28 verificações** (detalhes em `docs/backup.md`).
  - Arquivos: `scripts/lib/migrations.mjs`, `scripts/lib/db-snapshot.mjs`, `scripts/db-backup.mjs`, `scripts/db-restore.mjs`, `scripts/db-restore-drill.mjs`; `scripts/db-migrate.mjs` passou a usar a biblioteca de migrações (mesmo comportamento; `--status` conferido).
  - Depois do ensaio: só as branches development e production; 0 resíduos `[teste-…]` em development; pasta temporária apagada.
- **Next 16.3.6 → 16.3.8** (e `eslint-config-next`): correções de segurança publicadas na 16.3.8. Após a troca: lint, typecheck, 202/202 unitários e build OK.
- **SDK `@neondatabase/auth`**: 0.5.0-beta é a versão mais recente publicada no npm (dist-tag latest); sem atualização.
- **Neon Auth (leitura da configuração)**: development com remetente compartilhado do Neon, cadastro público desligado, nenhuma origem confiável extra; production sem Neon Auth configurado.

### Regressão (retomada)

Uma rodada de integração + RLS foi **interrompida** pela queda da sessão anterior: resultado desconhecido, **não conta**. Os resultados válidos são registrados abaixo, suíte por suíte, à medida que terminam.

| Suíte | Resultado | Quando |
| --- | --- | --- |
| Integração (`npm run test:int`) | **81/81** aprovados, 1 pulado (utilitário de limpeza manual). 1ª rodada desta sessão falhou 1 teste (ordem do histórico de plantões): defeito real corrigido (ver Falhas e correções); arquivo repetido 5× sem falha | 04/10/2026 03:09 |
| RLS (`npm run test:rls`) | **186/186** aprovados, 0 falhas; limpeza sem resíduo | 04/10/2026 03:11 |
| e2e autenticação (`npm run test:e2e`) | **32/32** aprovados; console sem erros | 04/10/2026 03:15 |
| e2e Finanças (`npm run test:e2e:financas`) | **53/53** aprovados | 04/10/2026 03:16 |
| e2e Finanças avançadas (`npm run test:e2e:avancadas`) | **130/130** aprovados | 04/10/2026 03:20 |
| e2e Follow-up (`npm run test:e2e:followup`) | **106/106** aprovados | 04/10/2026 03:22 |
| e2e Plantões — 1ª rodada desta sessão | **FALHOU**: 110 aprovados, 8 falhas, coincidindo com 14 respostas 429 (limite de requisições) do Neon Auth após 4 suítes e2e seguidas; não conta como aprovação | 04/10/2026 03:32 |
| e2e Plantões (`npm run test:e2e:plantoes`) — repetição isolada | **118/118** aprovados; nenhuma resposta 429 no servidor | 04/10/2026 03:37 |
| e2e Dashboard (`npm run test:e2e:dashboard`) | **38/38** aprovados | 04/10/2026 03:39 |
| e2e autenticação — repetição no build final (após ajuste do 429 em `session.ts`) | **32/32** aprovados | 04/10/2026 03:42 |
| Controle de acesso (`npm run test:e2e:acesso`, novo) | **16/16** aprovados: cadastro público recusado no serviço real, papel permitido entra, conta sem papel recusada; sessão já aberta recusada 70 s após remover o papel (cache de 60 s) | 04/10/2026 03:48 |
| Revisão visual 375/768/1280 (`npm run test:visual`, novo) | **131/131** verificações objetivas de layout aprovadas no build final; console sem erros; cenário fictício removido | 04/10/2026 04:06 |

As suítes e2e de Finanças, Finanças avançadas, Follow-up, Plantões e Dashboard acima rodaram ANTES da correção do componente compartilhado de formulários (`form-bits.tsx`). Repetição no build final:

| Suíte (build final) | Resultado | Quando |
| --- | --- | --- |
| e2e Finanças | **53/53** aprovados | 04/10/2026 04:08 |
| e2e Finanças avançadas | **130/130** aprovados | 04/10/2026 04:13 |
| e2e Follow-up | **106/106** aprovados | 04/10/2026 04:17 |
| e2e Plantões | **118/118** aprovados | 04/10/2026 04:22 |
| e2e Dashboard | **38/38** aprovados | 04/10/2026 04:25 |
| e2e autenticação | **32/32** aprovados | 04/10/2026 04:30 |
| Controle de acesso | **16/16** aprovados | 04/10/2026 04:32 |

Resultados **anteriores** (03/10/2026, antes das correções desta sessão; servem só de histórico): unitários 202/202, integração do Dashboard 6/6, e2e Dashboard 38/38, e2e Plantões 118/118, e2e Follow-up 106/106, e2e autenticação 32/32, RLS 186/186.

**Não executado:** ensaio de restauração (aprovado em 03/10 e não repetido — nenhum arquivo dele mudou depois); teste de entrega de e-mail; qualquer teste em aparelho real ou em navegador diferente do Chrome; simulação da virada do dia no navegador (coberta por testes unitários).

Após a última alteração de código: lint, typecheck, 202/202 unitários e build OK. Integração e RLS não dependem do build e não foram afetados pelas alterações posteriores a eles (componente de formulário e tratamento do 429).

### Falhas encontradas e correções (04/10/2026)

1. **Histórico fora de ordem** (defeito real, achado pela regressão de integração). As consultas de histórico ordenavam pelo texto da data, truncado ao segundo ou ao minuto, em vez do instante gravado: dois eventos próximos saíam em ordem aleatória. Corrigido em `plantoes/data.ts` (eventos do plantão), `followup/plans-data.ts` (planos e eventos do paciente) e `followup/data.ts` (consultas do mesmo dia).
2. **Campo de seleção mudava sozinho após erro** (defeito real, achado na revisão visual). Depois de um envio recusado, um seletor parado em "Escolha…" pulava para a primeira opção; um novo envio gravava nessa opção sem o usuário ter escolhido (ex.: conta na área errada). Corrigido no ponto comum (`financas/components/form-bits.tsx`, `useActionOutcome`): em caso de erro, cada seletor volta ao que estava no envio. Coberto por verificação nova no roteiro visual.
3. **Limite de requisições do Neon Auth (429)**. Quatro suítes e2e seguidas levaram o serviço a recusar validações de sessão; a 1ª rodada de Plantões falhou 8 verificações por isso. Repetida isoladamente: 118/118. O app tratava 429 como "sem sessão" e mandava ao login; agora trata como indisponibilidade temporária (`lib/auth/session.ts`) — o acesso continua negado, mas a tela diz para tentar de novo. O comportamento sob 429 real **não** foi reproduzido de propósito depois do ajuste.
4. **Roteiro de revisão visual**: a limpeza por IDs não cobria as ocorrências geradas pelas recorrências ao abrir as telas; sobraram registros `[teste-visual]` na conta de teste A, removidos (454), e a limpeza passou a ser por prefixo. Nenhum dado de outra conta foi tocado.

### Dependências e alertas de segurança

- **Next 16.3.6 → 16.3.8** (e `eslint-config-next`). Fonte: notas da versão v16.3.8 no repositório oficial `vercel/next.js` (30/09/2026), que listam GHSA-cjq9-62q9-8jv4 (alta, SSRF na otimização de imagens — o endpoint `/_next/image` existe por padrão), GHSA-f87g-xv8r-7p7x, GHSA-4jqv-mc3x-m676, GHSA-mcj8-r9mp-w47p, GHSA-3w37-wq28-93x7, GHSA-h694-7cp9-m8p3 e GHSA-39w2-rjm5-chcv. A v16.3.7 só corrige um travamento do Turbopack.
- **`@neondatabase/auth` 0.5.0-beta**: registro do npm (`dist-tags.latest = 0.5.0-beta`, publicada em 11/08/2026); não há versão mais nova nem estável. Mantida. Referências usadas: lista de verificação de produção e guia de e-mails da documentação do Neon Auth.
- **`npm audit`** (cadeias realmente instaladas):
  - Origem única: `braces@3.0.3`, GHSA-vfj7-8cjw-p6xm (alta; queda do processo por padrão de chaves muito aninhado). **Não existe versão corrigida** (3.0.3 é a última; o aviso lista "patched versions: none").
  - Quem traz:
    - `shadcn@4.21.0` → `fast-glob@3.3.3` → `micromatch@4.0.8` → `braces`;
    - `shadcn` → `ts-morph@26` → `@ts-morph/common@0.27` → `fast-glob`;
    - `eslint-config-next@16.3.8` → `@next/eslint-plugin-next` → `fast-glob@3.3.1` → `micromatch`.
  - O audit conta 8 pacotes: 6 na cadeia do shadcn e 2 do lint.
  - Onde roda: só em ferramentas de desenvolvimento (CLI do shadcn para gerar componentes; lint). O app importa do shadcn apenas `shadcn/tailwind.css` no build. Conferido no build: nenhum arquivo do servidor referencia `braces`, `micromatch`, `fast-glob` ou `ts-morph`; o servidor do Next usa `picomatch` próprio.
  - Impacto: para explorar, alguém precisa fornecer um padrão de arquivos malicioso a essas ferramentas na máquina de desenvolvimento ou no build; nenhuma entrada de usuário do app chega a elas.
  - Correção aplicada: `shadcn` movido de `dependencies` para `devDependencies` (mesma versão). `npm audit --omit=dev` → **0 vulnerabilidades**. Lint, typecheck, unitários e build repetidos.
  - Permanecem: os 8 alertas no conjunto de desenvolvimento. As "correções" oferecidas pelo audit são rebaixamentos (`shadcn@1.0.0`, `eslint-config-next@14.2.35`) que quebrariam o projeto; não aplicadas. Reavaliar quando houver `braces` corrigido.

### Controle de acesso (04/10/2026)

`npm run test:e2e:acesso` (novo, `scripts/e2e-acesso.mjs`), só com a conta fictícia B, cujo papel é rebaixado e restaurado pela CLI oficial:

- cadastro público: configuração do serviço conferida, tentativa real recusada, nenhuma conta criada, nenhuma rota de cadastro no app;
- papel `painel` entra; senha correta sem papel permitido é recusada, com mensagem genérica e sem cookies;
- sessão já aberta perde o acesso 69–70 s depois da remoção do papel (cache de 60 s do serviço) — limitação documentada;
- isolamento A/B e proteção do follow-up no Dashboard (sem telefone, observação ou mensagem; sessão revogada não vê nomes): verificações do e2e Dashboard e da integração, aprovadas no build final.

### Revisão visual (04/10/2026)

`npm run test:visual` (novo, `scripts/revisao-visual.mjs`, cenário em `scripts/lib/cenario-visual.mjs`): 131 verificações em 375, 768 e 1280 px — telas em estado vazio, telas com dados, diálogos, envios vazios com mensagens de erro e a navegação.

- Mede: rolagem horizontal, elementos cortados, alvos menores que 24 px, diálogo fora da tela, botão de envio inalcançável e conteúdo coberto pela barra fixa.
- Capturas inspecionadas a olho: Dashboard (vazio e com dados, 375 e 1280), Finanças 375, Plantões 375, paciente 375 e diálogo de nova conta com erros.
- Único defeito objetivo: o item 2 das correções.
- Observações de preferência, deixadas para a avaliação do usuário: no Dashboard, o detalhe da fatura quebra em três linhas iniciadas por "·"; os textos explicativos dos cartões de plantões são longos no celular.
- Não coberto: aparelho real (iOS/Android), Safari, Firefox, teclado virtual, modo escuro, leitor de tela.

### Documentos

- `docs/backup.md` (novo): escopo, comandos, evidência do ensaio de 28 verificações, identidades e `user_id`, pendências.
- `docs/publicacao.md` (novo): plano de publicação, não executado.
- `docs/banco-de-dados.md`: seção de backup aponta para `backup.md`.
- `README.md`: comandos novos e limitações atualizadas.

### Git

`git init` feito, **nenhum commit**, **nenhum remoto**, `user.name` e `user.email` não configurados. Nada foi alterado no Git. Há um arquivo `NUL` vazio na raiz (resíduo de um redirecionamento no Windows) que não deve entrar no primeiro commit.

### Situação da Etapa 14

**Revisão técnica concluída** (em development): regressão completa no build final, controle de acesso, análise de dependências, revisão visual automatizada, backup dos dados do app com restauração provada, documentação.

**Pendências operacionais** — requisitos da etapa ainda abertos; a etapa **não** está totalmente concluída:

1. Entrega de e-mail de recuperação: nunca comprovada; depende de autorização para um teste e, em produção, de um provedor SMTP próprio.
2. Recuperação de identidades (`neon_auth`) e religação por `user_id`: não testada.
3. Rotina de backup em uso (frequência, local, retenção): não definida.
4. Identidade Git, primeiro commit e repositório remoto privado: dependem do usuário.
5. Decisão sobre o plano da hospedagem (restrição de uso não comercial do plano gratuito).

**Avaliação manual do usuário: pendente.** Ajustes de funcionamento e aparência serão feitos depois dela.

**Publicação: não autorizada.** `production` sem Neon Auth e sem migrações; nada publicado.

Estado ao parar: aplicativo em `http://localhost:3000` com o build final (Next 16.3.8); contas de teste sem resíduos; branches do Neon: development e production.
