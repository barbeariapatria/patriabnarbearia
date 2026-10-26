# Robô de sincronização com o CashBarber

O CashBarber não tem API nem webhook. O robô faz o que uma pessoa faria: entra no site com um usuário próprio,
exporta os relatórios do mês em CSV e envia para o painel, que importa como em **Admin → Importar CashBarber**.

## Situação

- [x] Entrada do robô no painel: `POST /api/robo/importar` com o header `X-Import-Token` (variável `IMPORT_TOKEN`
      na Vercel). Corpo: `{ "ano": 2026, "mes": 10, "files": [{ "name": "comandas.csv", "text": "..." }] }`.
- [ ] Mapear no CashBarber o login e a exportação de cada relatório (precisa de acesso ao site).
- [ ] Script do robô (Playwright) + agendamento diário no GitHub Actions.

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
- **GitHub → Settings → Secrets and variables → Actions:** `CASHBARBER_EMAIL`, `CASHBARBER_PASSWORD`,
  `PAINEL_URL` (ex.: https://patriabnarbearia.vercel.app) e `IMPORT_TOKEN` (o mesmo valor cadastrado na Vercel).
- **Vercel → Environment Variables:** `IMPORT_TOKEN` = um texto longo e aleatório.

Riscos: código por SMS/e-mail ou captcha no login do CashBarber podem bloquear o robô; mudanças no site do
CashBarber podem exigir ajuste no script. A importação manual de CSV continua disponível como alternativa.
