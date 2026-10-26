# Painel de Resultados — Pátria Barbearia (v1)

Dashboard de **metas (mensal e quinzenal), faturamento diário e análise de profissionais**, montado a partir das planilhas
"Gráfico de resultados SVA" e "Análise de Profissionais". Inclui **login com senha, painel admin** e **webhook** para receber os dados do CashBarber automaticamente.

## Rodando no computador

```bash
npm install
cp .env.example .env      # ajuste ADMIN_PASSWORD, SESSION_SECRET, PUBLIC_URL…
npm run build             # compila a página inicial (React + Tailwind) em public/bento
npm start                 # http://localhost:3000
```

Requer **Node.js 22.5+** (usa o SQLite nativo `node:sqlite`, sem dependências nativas). O banco fica em `data/dashboard.db`.
**Acesso:** o painel tem um único login, `barbeariapatria@gmail.com` (variável `ADMIN_USER`). A senha vem da variável
`ADMIN_PASSWORD` e nunca fica no código; ela é a senha oficial e vale a partir do próximo início do servidor. No primeiro start também são importados os dados
de Janeiro e Março das planilhas.

## Páginas

| Página | O que mostra |
|---|---|
| **Início** | Bento preto e dourado: saudação + faturamento do mês dia a dia, cartões da equipe, velocímetro da meta, acumulado vs ritmo da meta, composição, quinzena (SVA + assinaturas), ticket médio, SVA por dia e atividade do webhook |
| Painel de metas | Meta mensal e quinzenal, dias úteis restantes, restante por dia, média, maior/menor dia, projeção |
| Faturamento diário | Tabela do mês (serviços, produtos, novas assinaturas, SVA, recorrência, status) — admin edita direto na tabela; exporta CSV |
| Profissionais | Ranking, faturamento × assinatura, ticket médio vs média, evolução mensal, comparativo completo e mapa de SVA |
| Admin | Lançamentos mensais, equipe, metas/dias não úteis/feriados/catálogo de SVA, usuários (admin/visualizador), integração |

## Importar do CashBarber

Em **Admin → Importar CashBarber**, envie os CSVs exportados do mês (pode arrastar todos de uma vez):
**Comandas** (obrigatório), **Serviços realizados**, **Assinantes** e **Cancelamentos**. O painel mostra uma prévia
(faturamento, assinaturas novas x recorrência, SVA, produtos, profissionais, motivos de cancelamento) e, ao confirmar,
substitui o faturamento diário daquele mês e atualiza os profissionais. Os nomes completos do CashBarber são ligados
aos profissionais já cadastrados pelo primeiro nome.

## Webhook (CashBarber → Painel)

`POST /api/webhooks/cashbarber` com header `X-Webhook-Token: <token>` (ou `?token=`). O token, a URL, exemplos,
console de teste (simular sem gravar) e o histórico ficam em **Admin → Integração & Webhook**.

```json
{
  "event": "venda.finalizada",
  "id": "CB-000123",
  "data": "2026-10-26",
  "profissional": "Gabriel",
  "novo_cliente": true,
  "comissao": 45,
  "itens": [
    { "tipo": "servico", "nome": "Corte + Barba", "valor": 90 },
    { "tipo": "servico", "nome": "Sobrancelha", "valor": 25 },
    { "tipo": "produto", "nome": "Pomada", "valor": 59.9 }
  ]
}
```

- Eventos aceitos: venda/comanda (soma), `*.cancelada`/estorno (subtrai), `fechamento.dia` (valores absolutos do dia),
  `profissional.mensal` (indicadores absolutos do mês), `ping`. Também aceita um array ou `{ "eventos": [...] }`.
- Campos em português ou inglês, valores como `"R$ 1.234,56"`, datas `AAAA-MM-DD` ou `DD/MM/AAAA`.
- Itens cujo nome está no catálogo de SVA contam como SVA e somam por profissional; o `id` evita duplicidade.
- Profissionais desconhecidos são criados automaticamente.

**Webhook de saída:** configure uma URL (n8n, Make, Zapier…) e o painel envia um POST com o resumo atualizado
(faturamento, % da meta, meta batida, restante por dia) a cada evento — útil para avisos no WhatsApp.

> O formato exato do webhook do CashBarber não é público; se o payload deles vier diferente, ajuste o mapeamento em
> `src/webhook.js` (objeto `ALIASES`) ou use uma automação intermediária para converter.

## Front-end da página inicial (React + TypeScript + Tailwind + shadcn)

O resto do painel é JavaScript puro (`public/js/app.js`). A página inicial é um componente React em `web/`, na estrutura shadcn:

```
web/
  components.json            # config shadcn (aliases @/components, @/components/ui, @/lib/utils)
  src/components/ui/
    web3-bento.tsx           # componente original, sem alterações
    barber-bento.tsx         # versão da barbearia: preto e dourado, dados reais
  src/lib/utils.ts           # cn() do shadcn
  src/index.css              # Tailwind v4 (só tema + utilities) e tokens preto/dourado
  src/main.tsx               # expõe window.BarberBento.mount(el, props)
```

`npm run build` gera `public/bento/bento.js` e `bento.css`, que o painel carrega. Para adicionar componentes shadcn:
`cd web && npx shadcn@latest add <componente>`. Eles vão para `src/components/ui`, a pasta padrão onde o CLI e os imports
`@/components/ui/...` esperam encontrá-los.

## Estrutura

```
server.js            API, autenticação, webhook
src/db.js            SQLite + configurações
src/auth.js          senhas (scrypt), sessão por cookie assinado, limite de tentativas
src/metrics.js       cálculos das metas (dias úteis, quinzenas, projeção…)
src/webhook.js       interpretação dos eventos do CashBarber
src/seed.js          dados das planilhas + dados de demonstração
public/              painel (HTML/CSS/JS + Chart.js)
web/                 página inicial em React (ver acima)
```

## Colocar no ar na Vercel

A Vercel não guarda arquivos entre execuções, então o banco fica no **Turso** (SQLite na nuvem, plano gratuito).

1. **Banco:** na Vercel, abra o projeto → **Storage** → **Create Database** → **Turso** (ou crie em turso.tech).
   Isso cria as variáveis `TURSO_DATABASE_URL` e `TURSO_AUTH_TOKEN`. Se criar fora da Vercel, cadastre as duas à mão.
2. **Projeto:** **Add New → Project** → importe o repositório `barbeariapatria/patriabnarbearia`.
   O `vercel.json` já configura build, pasta pública e a API. Não mude nada nas opções de build.
3. **Variáveis de ambiente** (Settings → Environment Variables):

   | Nome | Valor |
   |---|---|
   | `ADMIN_USER` | `barbeariapatria@gmail.com` |
   | `ADMIN_PASSWORD` | a senha do painel |
   | `SESSION_SECRET` | um texto longo e aleatório (ex.: gere em 1password.com/password-generator) |
   | `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` | criadas no passo 1 |

4. **Deploy.** O primeiro acesso cria as tabelas, o login e importa os dados das planilhas.
5. Entre no painel → **Importar CashBarber** e envie os CSVs do mês.

**Acesso:** só entra quem usar `ADMIN_USER` + `ADMIN_PASSWORD`; qualquer outro login vê "Você não tem acesso".
Para trocar a senha, mude `ADMIN_PASSWORD` na Vercel e faça um novo deploy (Deployments → Redeploy).

## Outras hospedagens

O projeto também roda com Docker (`Dockerfile`) ou no Render (`render.yaml`): sem as variáveis do Turso, o banco
é um arquivo em `DATA_DIR`, que precisa ficar em disco persistente. Em uma VPS:
`docker build -t patria . && docker run -d -p 80:3000 -v patria-dados:/data -e ADMIN_PASSWORD=... patria`.

