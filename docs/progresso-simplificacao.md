# Progresso — Simplificação geral, Finanças (forma de pagamento e fatura do cartão) e menu personalizável

Arquivo de retomada. Sem segredos nem dados pessoais. Ambiente: Neon **development**; production não é tocada; sem commit, push ou publicação.

## Ponto de partida (04/10/2026)

- Migrações aplicadas em development: 0001 a 0016.
- Pedido do usuário, em resumo:
  - Finanças separada por área; "Visão geral" como primeira aba, com gráficos que obedecem aos filtros.
  - "Cartões" vira "Formas de pagamento" (cartão, Pix ou boleto), com os cartões ativos no topo e **sem faturas** (ele não lança todas as compras de cada cartão).
  - Sem abas ou seções de cartões e áreas arquivados.
  - Conta nova não aparecia na aba Mês.
  - Tirar navegação redundante (botão que leva a uma aba já visível) e o excesso de informação do app inteiro: "o mais simples possível para uso diário".

## Causa do "não aparece em Mês"

As contas que "sumiam" eram compras no cartão: foram gravadas, mas a aba Mês só listava contas fora do cartão (as compras ficavam dentro da fatura, na aba Cartões). Agora cada parcela aparece no Mês, no mês do vencimento do cartão, e o aviso de criação diz quando vence a primeira.

## O que mudou

### Banco (migração 0017, só em development)

- `payment_method` (`'pix'`, `'boleto'` ou `NULL` = não informada) em `fin_entries`, `fin_series` e `fin_installment_plans`.
- `UPDATE (area_id)` em `fin_card_purchases`, para corrigir a área de uma compra.
- Em 05/10 a fatura (`fin_invoices`) ficou só como ciclo interno do cartão, sem tela nem pagamento. **Isso mudou em 06/10** (migração 0018, abaixo). Regras em [banco-de-dados.md](banco-de-dados.md#forma-de-pagamento-e-compras-no-cartão-migração-0017).

### Finanças

| Aba | Endereço | Conteúdo |
| --- | --- | --- |
| Visão geral | `/financas` | Período (mês ou ano), filtros por área, forma de pagamento e categoria; Total, Pago e A pagar; variação contra o período anterior; evolução de 12 meses; participação por categoria, forma de pagamento e área; maiores valores |
| Mês | `/financas/mes` | Contas agrupadas por área (cada área com o seu total) e um bloco por cartão: a linha da fatura, onde se paga, e as compras abaixo; situação Todas, A pagar ou Pagas |
| Recorrências | `/financas/recorrencias` | Contas recorrentes e parceladas em andamento (antes em duas abas) |
| Formas de pagamento | `/financas/formas-de-pagamento` | Cartões ativos primeiro, depois Pix e Boleto; arquivados no fim da mesma lista |
| Áreas | `/financas/areas` | Lista única; arquivadas no fim |

- Conta nova começa pela forma de pagamento (Pix, Boleto ou um cartão) e pelo tipo (uma vez, recorrente ou parcelada).
- Saíram: a aba de faturas, as abas "Parcelamentos" e "Cartões", seções de arquivados, botões que repetiam as abas. O pagamento do cartão voltou em 06/10, na linha do cartão da aba Mês (sem aba de faturas).
- Endereços antigos (`/financas/visao`, `/financas/parcelamentos`, `/financas/cartoes`) redirecionam (`next.config.ts`).
- Domínio puro novo: `domain/month.ts`, `domain/analytics.ts`, `domain/payment.ts` (com testes).

### Demais módulos

- **Dashboard:** só seções com itens; resumos de Plantões e Perícias somem quando o mês não tem nada; sem lista de módulos nem textos de escopo.
- **Plantões:** abas Calendário, Recebimentos, Recorrências e Tipos no layout; formulário de plantão com o essencial à vista e "Horário, data de pagamento e observação" recolhidos; detalhes sem linhas vazias; resumo do mês some em mês vazio.
- **Perícias:** abas Agenda e Empresas; resumo do mês some sem perícias; formulário sem parágrafos de ajuda.
- **Follow-up:** abas Acompanhamentos, Pacientes e Modelos; modelos e pacientes em lista única (arquivados no fim); linha do paciente com telefone, última consulta e só o que pede atenção; ações secundárias no menu "⋯".
- **Minha conta:** textos mais curtos.

### Padrões de interface adotados

- Abas do módulo no layout da rota (`SectionTabs`); nenhum botão que repita uma aba.
- Lista única com arquivados no fim, apagados e marcados "Arquivado".
- Tocar na linha abre a edição; ações secundárias no menu "⋯" (`ui/dropdown-menu.tsx`) ou no rodapé do diálogo.
- Escolhas curtas como chips (`ChoiceChips`, `FilterChips`); campos raros em `<details>`.
- Aviso de sucesso como toast que some sozinho (8 s).
- Bloco zerado não aparece; estado vazio é uma frase.

## Decisões tomadas (a confirmar com o usuário)

- (Substituída em 06/10.) Parcela de cartão sem situação paga/pendente, como "No cartão", fora do Dashboard. Hoje a fatura é paga na linha do cartão e entra em Pago ou A pagar.
- Contas anteriores à migração ficam com forma "não informada"; nada foi convertido.
- Recorrências encerradas e parcelamentos quitados não aparecem mais na lista.
- A versão do modelo de Follow-up continua gravada, mas não é mais mostrada na lista.
- O script `e2e-financas-avancadas.mjs` foi aposentado; `e2e-financas.mjs` cobre os fluxos atuais.

## Rodada de 06/10/2026 — cartão (compras agrupadas, total real, pagamento), nova recorrência e menu personalizável

### Pedidos do usuário

1. Em Mês, as compras do cartão ficam juntas debaixo de uma linha com o nome do cartão, e o pagamento é marcado nessa linha.
2. O total do cartão é editável: ele só cadastra as compras parceladas e informa o total que veio na fatura; as análises usam esse total.
3. Botão para criar recorrência na aba Recorrências.
4. Escolher a ordem dos itens do menu e poder ocultar algum.

Um roteiro longo e detalhado chegou colado antes do pedido 1; o usuário disse que **não** era aquilo e reescreveu o pedido com as próprias palavras. Vale o pedido curto. Do roteiro não foram feitos, de propósito: atribuir a parte sem detalhe a uma área, filtro "Mostrar concluídos" em Recorrências e identificador de reenvio no banco para recorrências.

### O que mudou

- **Banco, só em development:** migração 0018 (`fin_invoices.stated_total_cents`; pagamento pelo total informado; compras como detalhe em fatura paga com total informado) e migração 0019 (`user_preferences.menu_order` e `menu_hidden`). Regras em [banco-de-dados.md](banco-de-dados.md#fatura-do-cartão-total-informado-e-pagamento-migração-0018) e [banco-de-dados.md](banco-de-dados.md#menu-do-usuário-migração-0019).
- **Mês:** um bloco por cartão e vencimento. Linha do cartão: nome, vencimento, total e o círculo de pagar (o mesmo das contas). Abaixo, as compras daquele vencimento (descrição, parcela, área quando há mais de uma) e, se o total informado for diferente da soma, "Outros valores da fatura" (ou "Ajuste", se for menor). Tocar na linha abre o total da fatura; tocar numa compra abre a compra.
- **Fatura sem compras cadastradas:** botão "Fatura do <cartão>" na aba Mês (até o mês seguinte ao atual) cria a fatura daquele vencimento pelo total informado. Limpar o total de uma fatura sem compras a remove.
- **Pagamento do cartão:** diálogo com o total (já preenchido) e a data; um pagamento por fatura; voltar para a pagar pede confirmação e guarda o pagamento desfeito no histórico. Também pelo Dashboard, onde a fatura a pagar voltou a ser pendência (uma por cartão e vencimento).
- **Com filtro de área:** o bloco do cartão mostra só as compras da área e a soma delas; o pagamento continua sendo da fatura inteira.
- **Visão geral:** Total = Pago + A pagar (o cartão entra pela situação da fatura); gráfico de evolução com duas séries; a parte da fatura sem compra cadastrada aparece como "Cartão, sem detalhe" por categoria e por área.
- **Recorrências:** botão "Nova recorrência" sempre visível; abre direto o cadastro (Pix ou boleto, valor fixo ou variável, periodicidade e início) e mantém a pessoa na aba. Duplo clique não cria duas.
- **Menu:** em Minha conta → Menu, subir, descer e ocultar cada módulo (Finanças, Follow-up, Plantões, Perícias) e "Salvar menu". O Dashboard é fixo no topo. Vale para o menu lateral e para a barra do celular.

### Como os totais são calculados

- Cada fatura conta **uma vez**, pelo valor que conta: o pago, se estiver paga; senão o total informado; senão a soma das compras cadastradas (`invoiceTotal`).
- As compras só detalham a fatura. Total informado maior que a soma: a diferença é "outros valores" (sem área nem categoria; não é distribuída). Menor: ajuste negativo, com o sinal. As parcelas nunca são alteradas.
- Fatura a pagar entra em A pagar; paga, em Pago. Total = Pago + A pagar. Conta com valor a informar fica fora das somas, contada à parte.
- Mês, Visão geral e Dashboard usam a mesma regra e seguem o vencimento; a data do pagamento fica registrada à parte.
- Filtro de área ou de categoria mostra só o que foi atribuído (compras); o filtro pelo cartão mostra a fatura inteira.
- Conferência obrigatória coberta em teste unitário, de integração e de navegador: R$ 1.000,00 em compras com total real de R$ 2.500,00 = R$ 2.500,00 de despesa do cartão; ao pagar, o valor passa de A pagar para Pago, sem mudar o total nem as parcelas.

### Decisões tomadas (a confirmar com o usuário)

- Blocos de cartão ficam depois dos blocos de área na aba Mês; o total de cada área, nessa aba, é só das contas fora do cartão (a fatura não é repetida em cada área).
- Deixar o total em branco vale a soma das compras; nesse caso, depois de pago, o mês não recebe nem perde compras (mexer mudaria o valor pago). Com total informado, compras podem entrar ou sair depois sem mudar o valor pago.
- Fatura paga: o total só muda depois de voltar para a pagar.
- Módulo oculto no menu também sai do Dashboard; continua acessível pelo endereço e nada é apagado.
- Fatura a pagar aparece nas pendências do Dashboard (inclusive em Atrasados, se o vencimento passar sem pagamento marcado).

### Impacto no backup

- `db:backup` e `db:restore` leem tabelas e colunas do catálogo: as colunas novas entram sem mudança nos scripts.
- Um backup anterior às migrações 0018 e 0019 restaura no nível de migração em que foi feito; as colunas novas nascem vazias (sem total informado, menu padrão).
- O ensaio completo de backup e restauração **não foi repetido** depois de 0017, 0018 e 0019.

### Testes da rodada de 06/10/2026 (build final, Next 16.3.8)

Suítes de navegador contra o build de produção em `http://localhost:3100`, uma por vez.

| Verificação | Resultado |
| --- | --- |
| `npm run lint` e `npm run typecheck` | sem erros |
| Unitários (`npm test`) | 257 aprovados |
| Integração no Neon development (`npm run test:int`) | 111 aprovados, 1 ignorado (limpeza de resíduos, só sob demanda) |
| RLS (`npm run test:rls`) | 248/248 |
| Navegador — Finanças | 142/142 |
| Navegador — Dashboard | 47/47 |
| Navegador — Ajustes (impostos, Perícias, Plantões, Follow-up) | 114/114 |
| Navegador — Plantões | 119/119 (na repetição; ver abaixo) |
| Navegador — Follow-up | 107/107 |
| Navegador — Acesso | 16/16 |
| Navegador — Login e sessão, com o menu personalizável (`npm run test:e2e`) | 45/45 |
| Revisão visual (375, 768 e 1280 px) | 190 verificações, nenhum problema objetivo |

- Plantões falhou na primeira passagem (97 aprovados, 22 falhas em cascata a partir de "criar tipo do cenário de referência"): o registro do servidor mostra o serviço de login indisponível naquele momento (`AuthUnavailableError`), sem erro do app. Repetida sozinha no mesmo build, depois da fila: 119/119.
- Login ficou por último, com 10 minutos de pausa antes, e passou de primeira.
- Contas de teste conferidas depois da rodada: só a linha de preferências em cada uma. Conta do usuário conferida em modo somente leitura: nenhuma linha com marca de teste; os únicos registros novos são os que ele mesmo lançou.

## Testes da rodada de 05/10/2026 (Next 16.3.8)

Suítes de navegador contra o build de produção em `http://localhost:3100`, uma por vez.

| Verificação | Resultado |
| --- | --- |
| `npm run lint` e `npm run typecheck` | sem erros |
| Unitários (`npm test`) | 227 aprovados |
| Integração no Neon development (`npm run test:int`) | 102 aprovados, 1 ignorado (limpeza de resíduos, só sob demanda) |
| RLS (`npm run test:rls`) | 227/227 |
| Navegador — Finanças | 102/102 |
| Navegador — Dashboard | 38/38 |
| Navegador — Ajustes (impostos, Perícias, Plantões, Follow-up) | 114/114 |
| Navegador — Plantões | 119/119 |
| Navegador — Follow-up | 107/107 |
| Navegador — Login e sessão (`npm run test:e2e`) | 32/32 |
| Navegador — Acesso | 16/16 |
| Revisão visual (375, 768 e 1280 px) | 178 verificações, nenhum problema objetivo |

- A suíte de Login falhou duas vezes antes de passar: o Neon Auth respondeu 429 (limite de tentativas) depois de várias suítes seguidas. O app tratou como previsto ("serviço indisponível" ou "muitas tentativas"); com 10 minutos de pausa, 32/32. Ao rodar tudo em sequência, deixar Login por último e com pausa maior.
- Resíduo de teste encontrado e corrigido: compra criada e excluída pelo próprio teste deixava duas linhas de histórico (`fin_events`) na conta fictícia A, porque a limpeza procurava o histórico pela compra, que já não existia. `cards.integration.test.ts` e `e2e-financas.mjs` agora guardam o ID antes de excluir e limpam por ele. As 16 linhas acumuladas foram removidas por ID; depois de nova rodada das duas suítes, as contas de teste ficaram só com a linha de preferências.
- Conta do usuário conferida em modo somente leitura antes e depois: mesmas contagens em todas as tabelas, nenhuma linha com marca de teste, nenhuma alteração posterior ao último lançamento dele.

## Pendências

- Publicação: aguarda avaliação e aprovação do usuário. Production não foi tocada.
- Migrações 0017, 0018, 0019 e 0020 (CNPJ; ver [progresso-cnpj-visao-geral.md](progresso-cnpj-visao-geral.md)) existem só em development; aplicar em production faz parte da publicação e não é a única pendência (ver as demais abaixo e em `publicacao.md`).
- Ensaio de backup e restauração não foi repetido com as colunas novas (0017 a 0019). Recuperação que inclua identidades (Neon Auth) continua não testada.
- O vencimento de uma fatura já criada não é editável pela interface (segue os dias do cartão na criação).
- Aparelhos reais e outros navegadores (a revisão visual usa o Chrome em 375, 768 e 1280 px).
- Sugestões ainda não implementadas (dependem da escolha do usuário): limite por área ou categoria, resultado do mês com receitas de Plantões e Perícias, código do boleto ou chave Pix na conta, lembrete de vencimento, categorias em lista fixa, busca e exportação.
