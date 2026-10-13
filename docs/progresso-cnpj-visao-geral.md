# Progresso — CNPJ, imposto no mês seguinte e Visão geral completa de Finanças

Rodada de 06/10/2026 (segunda parte do dia). Tudo foi feito na branch **development** do Neon. Production não foi tocada; nada foi publicado, commitado nem enviado.

## Pedido do usuário

> "com esse programa, eu quero ter uma visão ampla das minhas finanças, já está bem estruturada as saídas e entradas, mas não estou vendo onde analisar isso tudo junto pra ficar adequado visualmente e útil na minha vida."

Depois de duas perguntas, ele definiu:

1. **Entradas contam quando o dinheiro entra** (recebido: pela data do recebimento; a receber: pela data prevista de pagamento).
2. **Imposto estimado pelo sistema:** ao cadastrar um plantão ou uma perícia, marcar (com um botão de marcar) o que é recebido por CNPJ. O imposto do trabalho de um mês é pago no **mês seguinte**.
3. **Módulo CNPJ novo**, onde ele cadastra o CNPJ e define ali a estimativa do imposto, integrado aos demais módulos.

## O que foi entregue

- **Módulo CNPJ** (`/cnpj`, item novo no menu): cadastro com nome, número (opcional, com conferência dos dígitos, inclusive no formato alfanumérico de 2026), percentual estimado de imposto e dia do pagamento (padrão 20). Cada CNPJ mostra o imposto estimado por mês de pagamento, com o mês do trabalho que o originou.
- **"Recebo por CNPJ"** (caixa de marcar) no plantão, no tipo de plantão, na recorrência de plantões, na perícia e na empresa de perícias. Substituiu a escolha "bruto/líquido". Marcado: mostra o imposto estimado e o mês em que é pago. Desmarcado: o valor vale inteiro, sem imposto.
- **Imposto no mês seguinte:** a estimativa do trabalho de outubro aparece como saída de novembro, no dia de pagamento do CNPJ.
- **Finanças → Visão geral** passou a juntar tudo:
  - **Entradas** (plantões e perícias, pelo dia em que o dinheiro entra), com recebido e a receber;
  - **Saídas** (contas, cartões e imposto estimado), com pago, a pagar e imposto;
  - **Resultado** (entradas − saídas);
  - gráfico de 12 meses com entradas e saídas lado a lado (cada mês leva ao mês);
  - **De onde veio** (por tipo de plantão e por empresa de perícia);
  - **Próximos 30 dias** (o que ainda vai entrar e sair, em ordem de data), só no período de hoje;
  - as divisões das saídas que já existiam (categoria, forma de pagamento, área, maiores valores), agora com a linha "Imposto estimado (CNPJ)".
- **Minha conta** perdeu a seção "Impostos estimados" (o percentual agora é do CNPJ).
- **Menu:** o item CNPJ entra no fim da ordem de quem já tinha personalizado o menu e pode ser reordenado e ocultado como os outros.

## Regras (como os números são calculados)

- **Entrada de um plantão:** data do recebimento registrado; sem ele, a data prevista de pagamento (regra do tipo ou data ajustada); sem ela, o dia do plantão.
- **Entrada de uma perícia:** data do recebimento registrado; sem ele, o dia da perícia (perícia não tem data prevista de pagamento).
- **Cancelados** ficam fora de entradas e de imposto.
- **Imposto estimado:** soma, registro a registro, de valor × alíquota gravada no registro, dos plantões e das perícias por CNPJ pelo **dia do trabalho**; entra no mês seguinte, no dia de pagamento do CNPJ. Não é conta: não tem "pago" nem "atrasado" e não aparece nas pendências do Dashboard nem na aba Mês.
- **Saídas = Pago + A pagar + Imposto estimado.** Pago e A pagar são os mesmos da aba Mês.
- **Com filtro de área, forma de pagamento ou categoria**, a Visão geral mostra só as contas que combinam: entradas, imposto e resultado ficam de fora (o imposto não tem área, forma nem categoria), e a tela avisa.
- **Sem plantões nem perícias lançados** no intervalo do gráfico, a tela mostra só as saídas (sem blocos zerados).
- **Percentual do CNPJ:** cada plantão ou perícia guarda o percentual de quando foi marcado. Mudar o percentual no CNPJ vale para o trabalho do **mês corrente em diante** (inclusive realizados e recebidos deste mês) e para as recorrências ativas; meses anteriores não mudam.
- **Recebimento registrado:** o valor continua travado; a marcação de CNPJ pode ser corrigida depois.

Detalhes do banco em [banco-de-dados.md](banco-de-dados.md#cnpj-e-imposto-estimado-migração-0020).

## Decisões tomadas (a confirmar com o usuário)

- **Dia do pagamento do imposto** no cadastro do CNPJ (padrão 20). Ele pediu só "no mês seguinte"; o dia serve para a lista dos próximos 30 dias.
- **Mais de um CNPJ é permitido.** Com um só, a tela é só a caixa de marcar; com mais de um, aparece a escolha de qual.
- **O imposto estimado não é uma conta para dar baixa.** Aparece nos totais e nos gráficos; não há "marcar como pago".
- **Padrão por tipo de plantão e por empresa:** a marcação de CNPJ do tipo e da empresa é copiada para os novos registros; mudar o padrão não mexe nos já criados (a tela avisa).
- **Registros antigos sem classificação** (o tipo e o plantão que o usuário já tinha) aparecem desmarcados e continuam como estão até ele marcar.
- **A aba Mês não mudou:** continua sendo a lista do que se paga e se dá baixa.
- **Exclusão de CNPJ** só quando nada o usa. Não há "arquivar".

## Fora desta rodada

- Aplicar de uma vez a marcação de CNPJ do tipo aos plantões já criados (hoje: editar o plantão ou a recorrência).
- Registrar o imposto realmente pago e comparar com a estimativa.
- Outras fontes de entrada além de plantões e perícias.
- Data prevista de pagamento para perícias.

## Arquivos principais

- Banco: `db/migrations/0020_cnpj.sql`.
- Módulo: `src/modules/cnpj/` (cadastro, regra do imposto em `domain/tax.ts`, contrato `contract.ts`, caixa de marcar `components/cnpj-field.tsx`, quadro do imposto `components/tax-breakdown.tsx`) e `src/app/(app)/cnpj/page.tsx`; número do CNPJ em `src/lib/cnpj.ts`.
- Leituras para imposto e entradas: `src/modules/plantoes/work-data.ts` e `src/modules/pericias/work-data.ts`.
- Visão geral: `src/modules/financas/domain/cashflow.ts` (entradas, imposto como saída, próximos dias), `domain/analytics.ts` (imposto nos totais e nas divisões), `components/overview-view.tsx` e `src/app/(app)/financas/page.tsx`.
- Removidos: `src/modules/conta/tax-*.ts`, os formulários de imposto de Minha conta, `src/components/tax-breakdown.tsx` e `src/modules/plantoes/components/kind-field.tsx`.

## Testes

Build final de 06/10/2026 (Next 16.3.8). Suítes de navegador contra o build de produção em `http://localhost:3100`, uma por vez.

| Verificação | Resultado |
| --- | --- |
| Ensaio da migração 0020 em transação desfeita (contas de teste) | 49/49; nada gravado; nenhum registro de outras contas alterado |
| `npm run lint` e `npm run typecheck` | sem erros |
| Unitários (`npm test`) | 285 aprovados |
| Integração no Neon development (`npm run test:int`) | 118 aprovados, 1 ignorado (limpeza de resíduos, só sob demanda) |
| RLS (`npm run test:rls`) | 279/279 |
| Navegador — Ajustes (CNPJ, Perícias, Plantões por CNPJ, entradas e imposto em Finanças, Follow-up, Dashboard) | 146/146 |
| Navegador — Plantões | 119/119 |
| Navegador — Finanças | 142/142 |
| Navegador — Dashboard | 47/47 |
| Navegador — Follow-up | 107/107 |
| Navegador — Acesso | 16/16 |
| Navegador — Login e sessão, com o menu de seis itens (`npm run test:e2e`) | 45/45 (na repetição; ver abaixo) |
| Revisão visual (375, 768 e 1280 px), com as telas do CNPJ e a nova Visão geral | 216 verificações, nenhum problema objetivo |

- **Login:** a primeira passagem deu 40 aprovados e 5 falhas, todas em conferências do próprio roteiro que ainda contavam cinco itens no menu (o app já mostrava os seis, com o CNPJ). Roteiro corrigido; repetido depois da pausa do serviço de login: 45/45.
- **RLS:** a primeira passagem com o bloco novo deu 1 falha na conferência de limpeza do próprio bloco (contava tipos de plantão de outras seções do roteiro). Conferência corrigida; 279/279.
- **Integração** foi rodada duas vezes: depois da camada de dados pronta e de novo no código final (118 nas duas).
- **Conferência de ponta a ponta no navegador:** plantões por CNPJ no mês seguinte ao de hoje, pagos no dia 20 de dois meses à frente — o imposto estimado (9%) aparece no módulo CNPJ e na Visão geral de Finanças no mês seguinte ao do trabalho, as entradas aparecem no mês do pagamento previsto e o resultado é entradas − saídas.
- **Telas olhadas uma a uma** nas capturas (fora do repositório): Visão geral (mês, ano e com filtro), CNPJ (vazio, com dados, cadastro e erro), plantão e perícia (formulário e detalhes), Perícias, Dashboard. Depois da primeira passada: resumo alinhado no celular, colunas do gráfico mais largas em telas grandes, cartões em duas colunas equilibradas, caixa "Recebo por CNPJ" sem texto ao lado e CNPJ sem linhas zeradas.
- Contas de teste conferidas ao final: só a linha de preferências em cada uma. Conta do usuário conferida em modo somente leitura: nenhum CNPJ criado pela migração, nenhum plantão alterado (mesmas datas de alteração de antes), nenhuma linha com marca de teste.
- A sessão caiu uma vez no meio do build; ao retomar, banco e contas de teste foram conferidos antes de seguir.

## Pendências

- Publicação: aguarda avaliação e aprovação do usuário. A migração 0020 existe só em development, como a 0017, a 0018 e a 0019.
- Ensaio de backup e restauração não foi repetido com a tabela nova (`db:backup` e `db:restore` leem as tabelas e a ordem de dependência do catálogo, então a tabela entra sem mudança nos scripts, mas isso não foi ensaiado).
- Aparelhos reais e outros navegadores (a revisão visual usa o Chrome em 375, 768 e 1280 px).
