# Robô de sincronização com o CashBarber

O CashBarber não tem API nem webhook. O robô faz o que uma pessoa faria: entra no site com um usuário próprio,
exporta os relatórios do mês em CSV e envia para o painel, que importa como em **Admin → Importar CashBarber**.

## Situação

- [x] Entrada do robô no painel: `POST /api/robo/importar` com o header `X-Import-Token` (variável `IMPORT_TOKEN`
      na Vercel). Corpo: `{ "ano": 2026, "mes": 10, "files": [{ "name": "comandas.csv", "text": "..." }] }`.
- [x] Script do robô (Playwright) em `robo/sync.mjs` + agendamento diário em `.github/workflows/robo-cashbarber.yml`.
      Testado contra um CashBarber simulado (login, menus, filtros de data, exportação CSV/Excel, leitura de tabela).
- [x] Primeira execução completa no CashBarber real (27/10/2026): Faturamento, Vendas, Histórico de agendamentos,
      Serviços, Quantidade de assinantes, Cancelados por período e Usuários — 1755 registros conferidos.

### Detalhes do CashBarber que o robô trata

- Filial: o usuário do robô só tem acesso à **Village Rio das Ostras**; com "Todas" o CashBarber recusa
  ("Você não possui acesso a todas as filiais"). O robô escolhe a Village no botão Filial e, se o pedido ainda sair
  com `id_filial` vazio, coloca o código dela (descoberto na tela; pode ser fixado com a variável `CASHBARBER_FILIAL_ID`).
- Faturamento (relatorio20) é a fonte das comandas. Movimentações **não** é usado (inclui operações de caixa).
- Trava no painel: o robô não troca o faturamento do mês por total zerado ou menor que 50% do atual, e guarda uma
  cópia do mês antes de gravar (`POST /api/admin/robo/desfazer` volta para ela).

## Como o robô trabalha

1. Entra no CashBarber (`CASHBARBER_URL`, padrão `https://painel.cashbarber.com.br`). Para com erro claro se a senha for
   recusada ou se aparecer captcha / código por SMS ou e-mail.
2. Acha a página de cada relatório: pela `url` fixada em `robo/relatorios.json` ou, se vazia, pelo nome nos menus e nas
   páginas `/relatorio/relatorioN`.
3. Preenche o período (campos de data, campo único "dd/mm/aaaa - dd/mm/aaaa" ou dois campos dd/mm/aaaa) e clica em
   Filtrar/Buscar, se existir.
4. Exporta (botão Exportar/CSV/Excel, inclusive em menu). Excel vira CSV. Sem botão de exportar, lê a tabela da tela.
5. Envia para `POST /api/robo/importar` o que conseguiu baixar e relata no log o que faltou (cada relatório só substitui a sua parte no painel).

Nunca clica em botões de excluir/cancelar e recusa qualquer diálogo de confirmação.

### Rodar na mão (GitHub → Actions → Robô CashBarber → Run workflow)

| Modo | O que faz |
|---|---|
| `mapear` | Só entra e levanta as páginas de relatório. O resumo (`mapa.json`) mostra que URL foi escolhida para cada relatório, os campos e botões de cada página — sem dados. Use na primeira vez e confira as escolhas. |
| `testar` | Faz tudo, menos enviar ao painel. O log mostra colunas e nº de linhas de cada relatório. |
| `sincronizar` | O mesmo que roda às 20h. Campo `mes` (AAAA-MM) reimporta um mês específico. |

**Privacidade:** o repositório é público, então logs e anexos da execução também são. O robô nunca imprime nem salva
dados de clientes (só nomes de relatórios, colunas e contagens). Os secrets do GitHub continuam privados.

## Horário

**Todo dia às 20h (horário de Brasília)** = 23h UTC → no GitHub Actions: `cron: "0 23 * * *"`.
O GitHub pode atrasar alguns minutos em horários de pico. O robô importa o mês corrente; no dia 1º, também
reimporta o mês anterior completo (para fechar o último dia).

## Relatórios a exportar (período: dia 1 ao último dia do mês)

| Relatório | Uso no painel |
|---|---|
| Comandas (fechamento) | faturamento por dia e por profissional, assinaturas cobradas |
| Agendamentos | agenda por profissional (finalizados, cancelados, faltas, app, clube) |
| Serviços realizados | SVA e produtos do mês |
| Assinantes | base do clube (em dia, pendentes) e novas assinaturas |
| Cancelamentos de assinatura | cancelamentos e motivos |
| Usuários (equipe) | IDs e nomes completos dos profissionais |
| Relatório 15 (`/relatorio/relatorio15`) | a definir quando o formato for conhecido |

## Configuração

- **Usuário do CashBarber:** "Robô Painel", só com permissão de ver relatórios.
- **GitHub → Settings → Secrets and variables → Actions → Secrets:** `CASHBARBER_EMAIL`, `CASHBARBER_PASSWORD`,
  `PAINEL_URL` (ex.: https://patriabnarbearia.vercel.app) e `IMPORT_TOKEN` (o mesmo valor cadastrado na Vercel).
  Se o endereço do CashBarber não for `https://painel.cashbarber.com.br`, crie a variável `CASHBARBER_URL` (aba Variables).
- **Vercel → Environment Variables:** `IMPORT_TOKEN` = um texto longo e aleatório.

O GitHub desliga agendamentos de repositórios públicos sem nenhum commit por 60 dias (ele avisa por e-mail); para
reativar, basta clicar em *Enable workflow* em Actions.

Riscos: código por SMS/e-mail ou captcha no login do CashBarber podem bloquear o robô; mudanças no site do
CashBarber podem exigir ajuste no script. A importação manual de CSV continua disponível como alternativa.
