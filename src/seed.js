// Dados iniciais importados das planilhas "Análise de Profissionais" (Janeiro e Março)
// e "Gráfico de resultados SVA" (metas). Os meses modelo (Prof. 1..8) não foram importados.
const { db, tx, getSetting } = require('./db');
const { daysInMonth, iso, round2, todayParts } = require('./metrics');

const YEAR = 2026;

const PRO_DATA = [
  { name: 'Gabriel', month: 1, faturamento_total: 22655.55, faturamento_assinatura: 9062.22, comissao: 9627.99, ticket_medio: 188.80, clientes_atendidos: 120, geracao_demanda: 0, servicos_realizados: 0, venda_produtos: 882, qtd_produtos: 11,
    extras: { SOBRANCELHA: 60, SELAGEM: 5, 'DEP. NARIZ': 7, 'DEP. ORELHA': 4, 'DEP. NARIZ E ORELHA': 5, ALISAMENTO: 57, 'HID. BARBA': 57, 'HID. CABELO': 57, LUZES: 57, 'SPA CAPILAR': 57, 'PIG. BARBA': 57 } },
  { name: 'Victor', month: 1, faturamento_total: 20000, faturamento_assinatura: 8000, comissao: 6000, ticket_medio: 116.28, clientes_atendidos: 172, geracao_demanda: 402, servicos_realizados: 755, venda_produtos: 6020, qtd_produtos: 1,
    extras: { SOBRANCELHA: 185, SELAGEM: 39, 'DEP. NARIZ': 61, 'DEP. ORELHA': 61, 'DEP. NARIZ E ORELHA': 61, 'LAVAGEM RELAXANTE': 61, ALISAMENTO: 61, 'HID. BARBA': 61, 'HID. CABELO': 61, LUZES: 61, 'SPA CAPILAR': 61, 'PIG. BARBA': 61 } },
  { name: 'Mauricio', month: 1, faturamento_total: 3600, faturamento_assinatura: 1440, comissao: 1080, ticket_medio: 22.50, clientes_atendidos: 160, geracao_demanda: 365, servicos_realizados: 690, venda_produtos: 5210, qtd_produtos: 1,
    extras: { SOBRANCELHA: 190, SELAGEM: 37, 'DEP. NARIZ': 49, 'DEP. ORELHA': 49, 'DEP. NARIZ E ORELHA': 49, 'LAVAGEM RELAXANTE': 49, ALISAMENTO: 49, 'HID. BARBA': 49, 'HID. CABELO': 49, LUZES: 49, 'SPA CAPILAR': 49, 'PIG. BARBA': 49 } },
  { name: 'Diogo', month: 1, faturamento_total: 12500, faturamento_assinatura: 5000, comissao: 3750, ticket_medio: 69.83, clientes_atendidos: 179, geracao_demanda: 415, servicos_realizados: 770, venda_produtos: 6430, qtd_produtos: 1,
    extras: { SOBRANCELHA: 225, SELAGEM: 48, 'DEP. NARIZ': 63, 'DEP. ORELHA': 63, 'DEP. NARIZ E ORELHA': 63, 'LAVAGEM RELAXANTE': 63, ALISAMENTO: 63, 'HID. BARBA': 63, 'HID. CABELO': 63, LUZES: 63, 'SPA CAPILAR': 63, 'PIG. BARBA': 63 } },
  { name: 'Gabriel', month: 3, faturamento_total: 22638.32, faturamento_assinatura: 11162.62, comissao: 9770.10, ticket_medio: 61, clientes_atendidos: 181, geracao_demanda: 14, servicos_realizados: 0, venda_produtos: 0, qtd_produtos: 0, extras: {} },
  { name: 'Victor', month: 3, faturamento_total: 21844, faturamento_assinatura: 5978.47, comissao: 8521.71, ticket_medio: 50, clientes_atendidos: 169, geracao_demanda: 19, servicos_realizados: 511, venda_produtos: 720, qtd_produtos: 9,
    extras: { SOBRANCELHA: 59, SELAGEM: 2, 'SPA CAPILAR': 4, BARBOTERAPIA: 5, 'HID. BARBA': 1, 'HID. CABELO': 1, 'DEP. ORELHA': 3, 'DEP. NARIZ': 0, 'PIG. BARBA': 1, 'PIG. CABELO': 1 } },
];
const EXTRA_PROS = ['Luryan'];

async function upsertPro(q, name) {
  await q.run('INSERT INTO professionals(name) VALUES(?) ON CONFLICT DO NOTHING', name);
  return (await q.get('SELECT id FROM professionals WHERE lower(name) = lower(?)', name)).id;
}

async function seedInitial() {
  if (await getSetting('seeded')) return;
  await tx(async (q) => {
    // marca primeiro: se outra instância já importou, a transação dela ganha e esta não duplica nada
    const mark = await q.run("INSERT INTO settings(key, value) VALUES('seeded', 'true') ON CONFLICT DO NOTHING");
    if (!mark.changes) return;
    for (const r of PRO_DATA) {
      const id = await upsertPro(q, r.name);
      await q.run(`INSERT INTO professional_monthly(professional_id, year, month, faturamento_total, faturamento_assinatura, comissao,
        ticket_medio, clientes_atendidos, geracao_demanda, servicos_realizados, venda_produtos, qtd_produtos, extras)
        VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
      id, YEAR, r.month, r.faturamento_total, r.faturamento_assinatura, r.comissao, r.ticket_medio, r.clientes_atendidos,
      r.geracao_demanda, r.servicos_realizados, r.venda_produtos, r.qtd_produtos, JSON.stringify(r.extras));
    }
    for (const n of EXTRA_PROS) await upsertPro(q, n);
    console.log('🌱 Dados iniciais das planilhas importados.');
  });
}

// Gera faturamento diário fictício (marcado como DEMO) para visualizar o dashboard antes da integração
async function seedDemo(y, m) {
  const closed = (await getSetting('dias_fechados')) || [0];
  const t = todayParts();
  const lastDay = t.y === y && t.m === m ? t.d : daysInMonth(y, m);
  let seed = y * 100 + m;
  const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  await tx(async (q) => {
    for (let d = 1; d <= daysInMonth(y, m); d++) {
      const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
      const date = iso(y, m, d);
      if (closed.includes(wd) || d > lastDay) {
        await q.run(`INSERT INTO daily_revenue(date, status) VALUES(?, 'PREVISTO')
          ON CONFLICT(date) DO UPDATE SET servicos = 0, produtos = 0, novas_assinaturas = 0, sva = 0, recorrencia = 0, status = 'PREVISTO'`, date);
        continue;
      }
      const boost = wd === 5 || wd === 6 ? 1.45 : 1;
      await q.run(`INSERT INTO daily_revenue(date, servicos, produtos, novas_assinaturas, sva, recorrencia, status)
        VALUES(?, ?, ?, ?, ?, ?, 'DEMO') ON CONFLICT(date) DO UPDATE SET servicos = excluded.servicos, produtos = excluded.produtos,
        novas_assinaturas = excluded.novas_assinaturas, sva = excluded.sva, recorrencia = excluded.recorrencia, status = 'DEMO'`, date,
      round2((520 + rand() * 380) * boost), round2((60 + rand() * 160) * boost),
      round2(rand() > 0.55 ? 99.9 * Math.ceil(rand() * 3) : 0), round2((900 + rand() * 900) * boost), round2(80 + rand() * 260));
    }
  });
}

async function clearDemo() {
  await db.run("DELETE FROM daily_revenue WHERE status = 'DEMO'");
}

module.exports = { seedInitial, seedDemo, clearDemo };
