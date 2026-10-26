# Painel de Resultados — Pátria Barbearia (v1)

Dashboard de **metas (mensal e quinzenal), faturamento diário e análise de profissionais**, montado a partir das planilhas
"Gráfico de resultados SVA" e "Análise de Profissionais". Inclui **login com senha, painel admin** e **webhook** para receber os dados do CashBarber automaticamente.

## Rodando

```bash
npm install
cp .env.example .env      # ajuste ADMIN_PASSWORD, SESSION_SECRET, PUBLIC_URL…
npm run build             # compila a página inicial (React + Tailwind) em public/bento
npm start                 # http://localhost:3000
```

Requer **Node.js 22.5+** (usa o SQLite nativo `node:sqlite`, sem dependências nativas). O banco fica em `data/dashboard.db`.
**Acesso:** o painel tem um único login, `barbeariapatria@gmail.com` (variável `ADMIN_USER`). A senha vem da variável
`ADMIN_PASSWORD` e nunca fica no código. Sem ela, uma senha temporária aparece no log do servidor. Se esquecer a senha,
defina a nova em `ADMIN_PASSWORD` com `RESET_ADMIN_PASSWORD=true` e reinicie. No primeiro start também são importados os dados
de Janeiro e Março das planilhas.

## Páginas

| Página | O que mostra |
|---|---|
| **Início** | Bento preto e dourado: saudação + faturamento do mês dia a dia, cartões da equipe, velocímetro da meta, acumulado vs ritmo da meta, composição, quinzena (SVA + assinaturas), ticket médio, SVA por dia e atividade do webhook |
| Painel de metas | Meta mensal e quinzenal, dias úteis restantes, restante por dia, média, maior/menor dia, projeção |
| Faturamento diário | Tabela do mês (serviços, produtos, novas assinaturas, SVA, recorrência, status) — admin edita direto na tabela; exporta CSV |
| Profissionais | Ranking, faturamento × assinatura, ticket médio vs média, evolução mensal, comparativo completo e mapa de SVA |
| Admin | Lançamentos mensais, equipe, metas/dias não úteis/feriados/catálogo de SVA, usuários (admin/visualizador), integração |

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

## Colocar no ar (site com login, banco e webhook funcionando)

O projeto já vem com `Dockerfile` e `render.yaml`. Caminho mais simples, o **Render** (≈ US$ 7/mês + disco de 1 GB):

1. Crie uma conta no GitHub e um repositório **privado**; envie esta pasta para ele (botão "Add file → Upload files" serve).
2. Crie uma conta em render.com → **New → Blueprint** → escolha o repositório. O `render.yaml` cria o serviço e o disco.
3. Quando pedir, preencha `ADMIN_PASSWORD` com a senha do login `barbeariapatria@gmail.com`.
4. Em ~5 minutos sai um endereço `https://patria-painel.onrender.com`. Para usar `painel.patriabarbearia.com.br`,
   adicione o domínio em *Settings → Custom Domains* e crie o CNAME no seu provedor de domínio.
5. Entre no painel → **Integração & Webhook** → copie a URL e o token e configure no CashBarber (ou no n8n/Make).

Alternativas: Railway (mesmo Dockerfile, adicione um Volume em `/data`) ou uma VPS com `docker build -t patria . &&
docker run -d -p 80:3000 -v patria-dados:/data -e ADMIN_PASSWORD=... patria`. Em qualquer opção: HTTPS
(`COOKIE_SECURE=true`) e a pasta `/data` em armazenamento persistente (é onde fica o banco).
