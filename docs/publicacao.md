# Preparação para publicação

**Nada foi publicado.** Este documento é um plano: a branch `production` do Neon não foi alterada, nenhum serviço pago foi contratado e não há commit, push ou remoto Git. Não contém segredos — só nomes de variáveis.

Estado em 04/10/2026:

| Frente | Situação |
| --- | --- |
| Revisão técnica do código (V1) | Concluída em desenvolvimento — ver `progresso-integracao-revisao.md` |
| Avaliação manual do usuário (funcionamento e aparência) | **Pendente** |
| Pendências operacionais (abaixo) | **Abertas** |
| Publicação | **Não autorizada** |

## 1. Hospedagem proposta

Proposta: **Vercel** (app Next.js) + **Neon** (banco e autenticação, projeto já existente).

| Item | Custo | Fonte / observação |
| --- | --- | --- |
| Vercel, plano Hobby | **Gratuito** | Documentação oficial do plano Hobby (atualizada em 14/09/2026): 1.000.000 de invocações de função, 4 CPU-horas ativas, 100 GB de transferência, 100 deploys/dia, funções de até 300 s. Ao estourar um limite, o recurso fica pausado por até 30 dias |
| Vercel Hobby — restrição de uso | **Atenção** | "Hobby teams are restricted to non-commercial personal use only." Uso comercial = implantação usada para ganho financeiro de quem participa da produção do projeto. Um painel pessoal sem cobrança, anúncio ou venda tende a caber, mas o app organiza atividade profissional (plantões, acompanhamento de pacientes): **confirme com o suporte da Vercel ou adote o Pro** se houver dúvida |
| Vercel Pro | **Pago** — US$ 20 por usuário/mês | Só se o Hobby não puder ser usado |
| Neon, plano Free (banco) | **Gratuito** | Página oficial de preços: 10 branches e 1 GB por projeto, 6 horas de histórico, 1 snapshot manual. Verificado no projeto: `history_retention_seconds = 21600` |
| Neon Auth | **Gratuito** até 60 mil usuários ativos/mês | Página oficial de preços |
| Provedor de e-mail próprio (SMTP) | **Não verificado** | Necessário para recuperação de senha confiável (seção 6). Preço e limites dependem do provedor escolhido; nenhum foi avaliado ou contratado |
| Domínio próprio | **Pago**, opcional — **não verificado** | O endereço gratuito `*.vercel.app` funciona sem domínio |
| Região das funções na Vercel | **Não verificado** | O banco está em `aws-sa-east-1` (São Paulo). Conferir se o Hobby permite escolher a região de São Paulo; outra região só aumenta a latência |
| Acordos de proteção de dados (LGPD) com Vercel e Neon | **Não verificado** | Decisão sua antes de dados reais de pacientes |

Alternativas não avaliadas: Netlify, Cloudflare, servidor próprio.

## 2. Pré-requisitos que ainda não existem

1. **Repositório Git com histórico.** Hoje: pasta com `git init`, **nenhum commit**, **nenhum remoto**, **sem identidade Git configurada** (`user.name`/`user.email` vazios). Você precisa: definir a identidade, fazer o primeiro commit e criar um repositório **privado** (ex.: GitHub) para a Vercel implantar a partir dele. Antes do primeiro commit, confira que `.env.local`, `.neon` e pastas de backup não entram (o `.gitignore` já os exclui).
2. **Conta na Vercel** ligada a esse repositório.
3. **Neon Auth na branch `production`**: hoje "not configured".
4. **Estrutura do banco em `production`**: nenhuma migração aplicada.

## 3. Branch de produção e migrações

Ordem proposta, cada passo com a sua autorização explícita:

1. Habilitar o Neon Auth em `production`: `neon neon-auth enable --branch production`.
2. Repetir em `production` a configuração validada em development e **conferir** depois:
   - cadastro público desligado (`neon neon-auth config email-password get --branch production` → `disable_sign_up: true`);
   - nenhum login social (`neon neon-auth oauth-provider list --branch production` → vazio);
   - domínio do app em produção como origem confiável (`neon neon-auth domain add <domínio> --branch production`);
   - **desligar "Allow Localhost"** em produção (a documentação oficial pede isso; em development fica ligado).
3. Aplicar todas as migrações de `db/migrations` (hoje, 0001 a 0020) com a conexão do **dono** de `production`, a partir de uma pasta ligada a essa branch e com `DB_ALLOW_BRANCH=production`: `npm run db:migrate -- --status`, depois `npm run db:migrate`.
4. Provisionar o papel do app em `production`: `npm run db:provision-runtime` (gera a senha do `app_runtime`; guarde a `APP_DATABASE_URL` resultante só na Vercel).
5. Conferir o RLS em `production` antes de qualquer dado real (a suíte `test:rls` usa contas fictícias; decidir se elas serão criadas e depois removidas em produção, ou se a conferência será pela impressão digital da estrutura contra development).

Migrações futuras: sempre primeiro em development, com testes; depois em production, antes do deploy do código que depende delas. Migração aplicada nunca é editada.

## 4. Variáveis de ambiente (só os nomes)

Na Vercel, ambiente Production. Nenhuma tem prefixo `NEXT_PUBLIC_` — nada vai para o navegador.

| Variável | Para quê | Valor em produção |
| --- | --- | --- |
| `APP_DATABASE_URL` | conexão do app (papel `app_runtime`, com pooler) | gerada no passo 3.4 |
| `NEON_AUTH_BASE_URL` | serviço de autenticação da branch | `neon neon-auth status --branch production` |
| `NEON_AUTH_COOKIE_SECRET` | assina o cache de sessão (≥ 32 caracteres) | **novo** valor aleatório, diferente do de development |

**Não** vão para a Vercel: `DATABASE_URL`, `DATABASE_URL_UNPOOLED` (conexão do dono), `NEON_BRANCH`, `RLS_TEST_*`, `APP_URL`.

## 5. Credenciais: administrativas × execução

| Credencial | Poder | Onde fica | Onde nunca fica |
| --- | --- | --- | --- |
| Conta Neon / CLI autenticada | tudo no projeto | só no seu computador | repositório, Vercel |
| Conexão do **dono** do banco | ignora o RLS, altera a estrutura | `.env.local` da pasta ligada à branch, só para migrações e backup | Vercel, repositório |
| `APP_DATABASE_URL` (`app_runtime`) | só o que os grants e o RLS permitem; sem BYPASSRLS | variável da Vercel (produção) e `.env.local` (development) | repositório |
| Usuário **admin** do app | cria e autoriza contas pelo Neon Auth | sua senha pessoal | scripts, arquivos |
| Segredo do cookie | assina o cache de sessão | variável da Vercel | repositório |

O app recusa iniciar o acesso a dados se a conexão configurada for de um papel com superusuário ou BYPASSRLS.

## 6. Autenticação, URLs e recuperação de acesso

Configuração atual em **development** (lida pela CLI em 03/10/2026):

- e-mail e senha habilitados; **cadastro público desligado**; nenhum login social;
- verificação de e-mail não exigida;
- remetente: provedor **compartilhado** do Neon (`auth@mail.myneon.app`, nome "Neon Auth");
- nenhuma origem confiável além de localhost.

**Recuperação por e-mail — situação real:**

- Em 28/09/2026 o e-mail do link de senha **não chegou** à sua caixa. Desde então **nenhum novo teste de entrega foi feito**.
- "Pedido aceito" pelo serviço ou token gerado **não** é prova de recebimento. A entrega continua **não comprovada**.
- A documentação oficial descreve o provedor compartilhado como limitado em volume e destinado a desenvolvimento e testes, e recomenda provedor próprio em produção.
- A senha inicial foi definida por um caminho de contingência (token lido do banco de development). Isso **não é** um procedimento de recuperação aceitável e não deve ser repetido em produção.

O que falta, em ordem:

1. **Sua ação:** dizer se autoriza um novo teste de envio para o seu endereço em development (`npm run auth:send-link -- <seu e-mail>`), e depois confirmar se chegou (inclusive no spam). Sem a sua confirmação a entrega permanece não comprovada.
2. **Sua ação, para produção:** escolher um provedor SMTP (host, porta, usuário, senha, remetente) — nenhum foi avaliado. Configurar com `neon neon-auth config email-provider update --branch production` (a senha do SMTP é digitada por você, nunca na conversa) e testar com `neon neon-auth config email-provider test --branch production`.
3. Enviar um link real em produção, abrir e trocar a senha. Só então a recuperação conta como validada.
4. Enquanto isso não existir, perder a senha em produção significa depender do console do Neon. **Não use dados reais antes de fechar este item.**

Não existe pedido público de "esqueci minha senha" na tela de login; o link é enviado por você, administrativamente.

**Controle de acesso (conferido em 04/10/2026, 16/16):** tentativa real de cadastro recusada pelo serviço e nenhuma conta criada; o app não expõe rota de cadastro; conta com papel `painel` entra; conta com senha correta mas sem papel permitido é recusada com mensagem genérica e sem cookies; sessão já aberta perde o acesso cerca de 70 s depois que o papel é removido (cache de sessão de 60 s do serviço).

**Limites conhecidos da autenticação:**

- SDK `@neondatabase/auth` 0.5.0-beta (ainda beta; é a versão mais recente publicada).
- Remover o papel de alguém não derruba a sessão aberta na hora: leva até cerca de 1 minuto. Sessão **encerrada** (logout, troca de senha) é recusada de imediato nas telas com dados de pacientes e em toda gravação.
- O serviço limita requisições: cinco suítes de teste seguidas provocaram respostas 429. No uso normal de uma pessoa isso não foi observado, e o limite exato não é documentado. O app agora trata 429 como "serviço indisponível, tente de novo" (antes levava ao login).
- Sem segundo fator (MFA).
- Login por código enviado por e-mail (OTP): não foi possível comprovar que respeita o bloqueio de cadastro; a barreira de papéis do app recusa essas contas de qualquer forma.

## 7. Usuário inicial em produção

1. `neon neon-auth user create --email <seu e-mail> --name "<seu nome>" --branch production`
2. `neon neon-auth user set-role <id exibido> --roles admin --branch production`
3. Definir a senha pelo link de e-mail (depende da seção 6). Mínimo de 12 caracteres.
4. Entrar, abrir **Minha conta** e conferir o nome.

As contas fictícias de teste **não** devem existir em produção depois das conferências.

## 8. Backup

Ver [backup.md](backup.md). Antes de dados reais em produção:

- rotina de `npm run db:backup` definida (frequência, local protegido, retenção);
- recuperação com identidades testada (ainda **pendente**);
- lembrar que o plano Free guarda só 6 horas de histórico.

## 9. Conferência depois do deploy (quando houver)

1. `/login` abre por HTTPS; visitante em `/` vai ao login.
2. Cookies de sessão `HttpOnly` e `Secure`.
3. Entrar com o usuário admin; Dashboard com estados vazios verdadeiros.
4. Criar e apagar um registro de teste em cada módulo.
5. Sair e confirmar que voltar no navegador não mostra dados.
6. Tentar cadastro público no serviço de produção: deve ser recusado.
7. Conferir nos registros da Vercel que não há erros nem valores sensíveis.
8. Fazer o primeiro `db:backup` de produção e guardar fora do repositório.

## 10. Se algo der errado

| Problema | Ação |
| --- | --- |
| Deploy com defeito | Na Vercel, promover o deploy anterior (rollback instantâneo). O banco não muda com isso |
| Migração com defeito | Não editar a migração aplicada: corrigir com uma nova. Se houver perda de dados, restauração do Neon dentro da janela de 6 h ou `db:restore` numa branch nova |
| Dados apagados por engano | Restauração instantânea do Neon (até 6 h) ou último `db:backup` |
| Senha esquecida | Link de redefinição por e-mail (seção 6) |
| Suspeita de vazamento da conexão do app | `npm run db:provision-runtime` na branch (troca a senha do `app_runtime`) e atualizar a variável na Vercel |
| Suspeita de vazamento do segredo do cookie | Trocar `NEON_AUTH_COOKIE_SECRET` na Vercel e reimplantar (encerra o cache de sessão) |
| Conta comprometida | Trocar a senha em Minha conta (encerra as outras sessões) ou remover o papel pela CLI |

## 11. Condições para cada marco

**Para publicar (uso próprio, dados fictícios ou não sensíveis):** avaliação manual concluída e ajustes feitos; repositório privado com commit; decisão sobre o plano da Vercel; Neon Auth e migrações em `production`; variáveis configuradas; usuário admin criado; conferência da seção 9.

**Para dados reais de pacientes, além do acima:** entrega de e-mail comprovada com provedor próprio; recuperação com identidades testada; rotina de backup em uso; decisão sobre o SDK beta e a ausência de MFA; decisão sobre LGPD (bases legais, contratos com os provedores, quem acessa); teste em aparelho real.
