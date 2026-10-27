# Planilhas Google atualizadas pelo painel

O robô do CashBarber preenche o painel às 20h. Este script (Apps Script) puxa os números do painel e preenche as
três planilhas. Ele nunca escreve em célula com fórmula e só mexe de setembro/2026 em diante.

## Instalar (uma vez)

1. Abra a planilha **Análise de Unidade** → **Extensões → Apps Script**.
2. Apague o que estiver no editor e cole todo o conteúdo de `atualizar-planilhas.gs`. Salve (ícone de disquete).
3. **Configurações do projeto** (engrenagem) → **Propriedades do script → Adicionar propriedade**:
   nome `IMPORT_TOKEN`, valor = o mesmo `IMPORT_TOKEN` da Vercel/GitHub. Salve.
4. Volte ao editor, escolha a função **atualizarDesdeInicio** e clique em **Executar**. Na primeira vez o Google pede
   autorização (acessar as planilhas e a internet): **Revisar permissões → sua conta → Avançado → Acessar → Permitir**.
5. Escolha a função **instalarAgendamento** e clique em **Executar**: liga a atualização todo dia entre 21h e 22h.

Depois disso, a planilha ganha o menu **Painel Pátria** (ao reabrir) para atualizar na hora.

## O que é preenchido

| Planilha | Onde | Colunas |
|---|---|---|
| Análise de Unidade | Indic. Barbearia, linha do mês | faturamento total, assinatura, avulso, produtos, ticket médio, assinantes, clientes avulsos, atendidos, serviços realizados, serviços extras, clientes novos |
| Análise de Unidade | Indic. Assinatura, linha do mês | faturamento, assinantes, novos assinantes, cancelamentos, frequência, ticket médio |
| Análise de Profissionais | Geral, bloco do mês | faturamento total, ticket médio, clientes atendidos, geração de demanda |
| Gráfico de resultados SVA | aba do mês, Faturamento por dia | serviços (avulsos + extras), produtos, novas assinaturas, recorrência, status REALIZADO |

Ficam como estão (o CashBarber ainda não manda pelo robô): taxa de retorno, cliente sem preferência, reativações,
e, por profissional, faturamento de assinatura, comissão, serviços realizados, produtos e serviços extras.
