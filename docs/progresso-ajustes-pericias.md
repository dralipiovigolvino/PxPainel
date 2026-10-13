# Progresso — Impostos estimados, Perícias e ajustes (blocos 1 a 6)

> **Atualização de 06/10/2026:** o percentual de impostos por usuário e a escolha bruto/líquido descritos aqui foram substituídos pelo cadastro de CNPJ e pela marcação "Recebo por CNPJ" (migração 0020). Ver [progresso-cnpj-visao-geral.md](progresso-cnpj-visao-geral.md). O restante deste registro vale como histórico.

Arquivo de retomada. Sem segredos nem dados pessoais. Ambiente: Neon **development**; production não é tocada; sem commit, push ou publicação.

## Ponto de partida (04/10/2026)

- Migrações aplicadas em development: 0001 a 0010.
- Build final anterior: Next 16.3.8; regressão completa aprovada (ver `progresso-integracao-revisao.md`).
- Conta do usuário em development: sem registros nos módulos.

## Decisões de desenho (valem para todos os blocos)

- **Percentual em pontos-base** (`tax_rate_bp`, 900 = 9%), até duas casas decimais (ex.: 9,25%).
- **Arredondamento**: imposto = bruto × percentual, arredondado ao centavo mais próximo (meio centavo para cima); após impostos = bruto − imposto. Cálculo inteiro, sem ponto flutuante (`src/lib/tax.ts`).
- **Cada registro guarda a alíquota aplicada**. Imposto e valor após impostos são derivados do valor e da alíquota gravados; mudar a configuração não altera registros existentes.
- **Valor líquido**: sem alíquota gravada; imposto original "Não informado".
- **Registro antigo sem classificação** (plantões anteriores a esta entrega): "bruto/líquido não definido"; nada é presumido.
- Estimativas são sempre rotuladas como estimativas. Nenhuma despesa de imposto é criada em Finanças.
- **Recebimento** é separado da realização (mesmo padrão de Plantões).

## Blocos

| Bloco | Situação |
| --- | --- |
| 1. Configuração de impostos estimados | concluído e verificado (unitário, integração, navegador) |
| 2. Módulo Perícias | concluído e verificado (integração, RLS, navegador) |
| 3. Plantões: bruto/líquido, repetição semanal, previsão de pagamento | concluído e verificado (integração, RLS, navegador) |
| 4. Finanças: cartão e parcelamento simplificado | concluído e verificado (integração, navegador) |
| 5. Follow-up: duração, avisos e próxima consulta | concluído e verificado (integração, RLS, navegador) |
| 6. Dashboard, navegação e validação | concluído e verificado (integração, navegador, 375/768/1280) |

Os detalhes e resultados de cada bloco são acrescentados abaixo, na ordem em que terminam.

## Migrações aplicadas em development nesta entrega

- `0011_impostos_estimados.sql` — `user_preferences.tax_rate_bp` (padrão 900).
- `0012_pericias.sql` — `per_companies`, `per_exams`, `per_events` (RLS forçada, permissões por coluna, chave estrangeira composta com o usuário).
- `0013_plantoes_bruto_previsao.sql` — classificação bruto/líquido, alíquota e regra de pagamento em tipos, séries e ocorrências; data prevista mantida por gatilho.

## Bloco 1 — impostos estimados

- `src/lib/tax.ts` (+ teste, 7): cálculo exato, leitura e formatação do percentual.
- `src/modules/conta/`: `tax-data.ts`, `tax-actions.ts`, `tax-update.ts`, `components/tax-rate-form.tsx`, `components/tax-update-form.tsx`; seção "Impostos estimados" em Minha conta.
- Atualização dos futuros: ação explícita em duas etapas (prévia → confirmação). Entram perícias agendadas e plantões brutos agendados de hoje em diante, sem recebimento e sem alteração individual, e recorrências ativas. Histórico gravado em cada registro.

## Bloco 2 — Perícias

- `src/modules/pericias/` (tipos, validação, totais + teste, dados, ações, telas) e rotas `/pericias` e `/pericias/empresas`; módulo na navegação (5 colunas no celular).
- Horário da perícia é obrigatório. Recebimento registra só a data (não há valor recebido, porque o valor cadastrado é bruto).
- Integração (`pericias.integration.test.ts`): alíquota gravada e preservada ao mudar a configuração; valor herdado da empresa e independente do padrão depois; envio duplicado; situação × recebimento; totais calculados à mão; isolamento A/B e permissões por coluna.

## Bloco 3 — Plantões

- Tipos: bruto/líquido obrigatório ao salvar (tipos antigos ficam "não definido" até serem editados) e dia de pagamento no mês seguinte (opcional).
- Ocorrências guardam classificação, alíquota, regra copiada, data prevista e se a previsão é manual. A data automática é recalculada pelo banco ao mover; a manual e os recebimentos são preservados.
- "Aplicar previsão" no tipo: prévia + confirmação. Sem regra anterior: preenche qualquer plantão não recebido. Com outra regra: só agendados de hoje em diante.
- "Repetir semanalmente" no formulário do plantão cria uma recorrência pelo mecanismo existente.
- `/plantoes/previsao`: recebimentos previstos agrupados por data; previsão vencida separada de "a confirmar".
- Resumo do mês ganhou "Por classificação" (bruto com imposto estimado e após impostos; líquido; não definido), sem somar brutos e líquidos como total bruto.
- Integração (`bruto-previsao.integration.test.ts`, 9): herança, função do banco × regra pura (virada de ano, dias 29–31, bissexto), mover, mudança de regra com prévia, tipo sem regra, quintas sem duplicar e agrupadas por data, registro antigo, alíquota dos futuros, isolamento.

Falha corrigida durante o bloco: a expressão regular do dia de pagamento foi gravada sem a barra (`d{1,2}`), recusando qualquer dia; achada pelo teste de integração e coberta por teste unitário.

## Migrações (continuação)

- `0014_cartao_area_padrao.sql` — `fin_cards.default_area_id` (chave estrangeira composta com o usuário).
- `0015_followup_prazo_proxima_consulta.sql` — duração e aviso em modelos e planos; `fu_appointments` (RLS forçada, sem DELETE); novas ações no histórico.
- `0016_followup_agendamento_indice.sql` — unicidade da próxima consulta em aberto por (usuário, paciente).

## Bloco 4 — cartão e parcelamento simplificado

- "Nova conta" começa por **Fora do cartão / No cartão**. No cartão: valor total, parcelas e cartão; prévia com total, quantidade e valor das parcelas, fatura e vencimento de cada uma; "Data, descrição e mais detalhes" recolhido (data = hoje, descrição opcional, primeira fatura, categoria, observação).
- Descrição vazia vira "Compra de DD/MM/AAAA".
- Área: o cartão pode ter **área padrão** (escolhida pelo usuário). Cartão sem padrão pede a área na compra, à vista, com a opção de gravá-la como padrão; nunca escolhe a primeira.
- Botão "Cartões" na tela de Finanças; "Cadastrar cartão" na tela de cartões e no formulário quando não há cartão.
- Compras continuam gerando só cobranças nas faturas (nenhuma conta separada); pagamento é da fatura; proteção e reabertura inalteradas. Parcelamento fora do cartão não mudou. Nenhum registro existente foi convertido.
- Integração (`cards.integration.test.ts`, 15, 3 novos): área padrão e área de outra conta recusada; 3× de R$ 100,00 = 33,34 + 33,33 + 33,33 nas faturas de outubro, novembro e dezembro; virada de ano; compra no dia do fechamento; nenhuma conta criada; pagamento e reabertura pela fatura.

## Bloco 5 — Follow-up

- Modelo: duração total e aviso (sugestão 7), opcionais; a duração precisa cobrir a última etapa (nenhuma etapa é removida).
- O plano copia duração e aviso ao ser gerado; a prévia mostra a data final. Planos antigos: "Sem duração definida", com "Definir duração" explícito e registrado no histórico.
- Indicadores: em acompanhamento, perto de encerrar, termina hoje, prazo encerrado, com data e dias restantes. O fim do prazo não altera etapas.
- Próxima consulta: uma em aberto por paciente; agendar (data de hoje em diante, horário opcional), reagendar, cancelar e, depois da data, confirmar o atendimento — que registra a consulta **sem** acompanhamento automático.
- Mostrado na lista de pacientes, na página do paciente e na central (seção "Prazos e próximas consultas").
- Integração (`prazo-proxima.integration.test.ts`, 7): validação, cópia para o plano, plano antigo, estados antes/no dia/depois, agendar/reagendar/cancelar, confirmação após a data, isolamento e permissões.
- Falha corrigida: a unicidade por paciente era checada antes da chave estrangeira e revelava, pelo tipo de erro, se havia agendamento em aberto para um paciente de outra conta → migração 0016.

## Bloco 6 — Dashboard e navegação

- Perícias de hoje e próximas (e "a confirmar"); seção nova "Acompanhamentos: prazo e próxima consulta"; itens de plantão com valor informado (bruto/líquido) e "pagamento previsto para"; resumo de plantões com "Programado por classificação" e "Recebimentos previstos"; resumo de perícias do mês.
- Nenhum desses valores entra na soma de pagamentos a fazer; não há saldo.
- Navegação com 5 módulos no computador e no celular.
- Integração (`dashboard-novos.integration.test.ts`, 3).

## Verificações

| Verificação | Resultado | Quando |
| --- | --- | --- |
| Lint, typecheck, build | OK | 04/10/2026 06:24 |
| Unitários (`npm test`) | **229/229** | 04/10/2026 06:24 |
| Integração no Neon (`npm run test:int`) | **108/108** (1 pulado: utilitário de limpeza manual) | 04/10/2026 06:24 |
| RLS no Neon (`npm run test:rls`) | **214/214** (28 verificações novas: 27 tabelas com RLS forçada, perícias, colunas novas de plantões, área padrão do cartão, próxima consulta) | 04/10/2026 06:28 |
| e2e ajustes (`npm run test:e2e:ajustes`, novo) — 1ª rodada | 110 aprovados, 4 falhas: 2 do roteiro e 2 defeitos reais (opções de marcar após erro; rolagem em 768 px), corrigidos | 04/10/2026 06:41 |
| e2e ajustes — build final | **114/114**; console sem erros; 99 registros de teste removidos | 04/10/2026 06:41 |
| e2e autenticação | **32/32** | 04/10/2026 06:44 |
| e2e Finanças | **53/53** | 04/10/2026 06:46 |
| e2e Finanças avançadas | **130/130** | 04/10/2026 06:51 |
| e2e Follow-up | **106/106** | 04/10/2026 06:55 |
| e2e Plantões | **FALHOU** 13/31 | 04/10/2026 07:03 |
| e2e Plantões — 1ª rodada | **FALHOU** 13/31: o roteiro criava o primeiro tipo sem escolher bruto/líquido (agora obrigatório); roteiro ajustado | 04/10/2026 07:04 |
| e2e Plantões — 2ª rodada | **FALHOU** 115/118: 3 verificações comparavam textos antigos (rótulo do recebimento, aviso do tipo, valor seguido da classificação); roteiro ajustado | 04/10/2026 07:10 |
| e2e Plantões — build final | **118/118** | 04/10/2026 07:15 |
| e2e Dashboard | **38/38** | 04/10/2026 07:18 |
| Revisão visual 375/768/1280 (`npm run test:visual`) | **173/173**; console sem erros; cenário removido. Capturas inspecionadas: formulário de perícia com erros (375), paciente (768), Dashboard (375) | 04/10/2026 07:25 |
| e2e Dashboard — build final (após ajuste do texto da seção de prazos) | **38/38** | 04/10/2026 07:27 |
| e2e ajustes — repetição no build final | **114/114** | 04/10/2026 07:32 |
| Controle de acesso (`npm run test:e2e:acesso`) | **16/16** | 04/10/2026 07:34 |

Não executado nesta entrega: ensaio de backup e restauração com as tabelas novas (os scripts são genéricos, mas o ensaio de 03/10 é anterior às migrações 0011–0016); teste em aparelho real e em outros navegadores; envio de e-mail.

## Falhas encontradas e corrigidas nesta entrega

1. **Dia de pagamento recusava qualquer valor** — expressão regular gravada sem a barra; achada pela integração; coberta por teste unitário.
2. **Unicidade da próxima consulta revelava informação entre contas** pelo tipo do erro — migração 0016.
3. **Opções de marcar voltavam ao estado inicial após erro de validação** (bruto/líquido, data manual): o reenvio poderia gravar a opção errada. Corrigido no ponto comum dos formulários (`form-bits.tsx`), que já tratava os seletores; coberto pelo e2e novo.
4. **Rolagem horizontal em 768 px** na página do paciente com os três botões da próxima consulta — botões passaram para baixo do texto.
5. **Texto de estado vazio errado** na seção de prazos do Dashboard ("Atualizando recorrências…").
6. Roteiros e2e antigos ajustados aos rótulos novos (bruto/líquido obrigatório no tipo, "Cadastrar cartão", textos de recebimento, 5 itens na barra inferior). Nenhuma regra antiga mudou.

## Decisões e limites

- Tipos de plantão antigos ficam com "bruto/líquido não definido" e sem regra de pagamento; ao editá-los, a classificação passa a ser pedida. Plantões antigos só mudam se editados um a um.
- "Aplicar previsão" não altera plantões realizados ou passados que já tinham outra regra; para esses, ajuste a data no próprio plantão.
- O recebimento de plantão continua registrando o valor informado do plantão (não há valor recebido diferente do informado). Em Perícias, o recebimento guarda só a data.
- Substituir as etapas pendentes por outro modelo não troca a duração já copiada no plano (altere em "Alterar duração").
- Prazo encerrado sem próxima consulta fica no Dashboard e na central por 60 dias.
- A confirmação de um atendimento agendado registra a consulta na data agendada, sem acompanhamento; aplicar um modelo continua sendo um passo explícito.
- Lembretes só dentro do aplicativo (sem e-mail ou notificação).

## Estado ao parar (04/10/2026)

- Migrações 0001–0016 aplicadas em **development**; production intocada; branches: development e production.
- Aplicativo em `http://localhost:3000` com o build final.
- Contas de teste sem resíduos (só as preferências, com o percentual de volta a 9%). Registros da conta do usuário não foram tocados.
- Sem commit, push ou publicação. Aguardando a avaliação do usuário.
