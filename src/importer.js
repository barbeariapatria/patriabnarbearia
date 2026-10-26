// Importação dos relatórios exportados do CashBarber (CSV).
// Relatórios reconhecidos pelo cabeçalho:
//   - Comandas:      "ID da comanda", "Profissional", "Cliente", "Tipo", "Valor comanda fechada / assinatura", "Data e hora"
//   - Serviços:      "Serviço", "Valor unitário", "Faturado", "Quantidade realizado"
//   - Assinantes:    "Cliente", "Plano", "Status", "Data de criação"
//   - Cancelamentos: "Plano", "Cliente", "Data assinatura", "Data de cancelamento", "Motivo"
// Os valores por dia vêm das comandas; a divisão entre serviços, SVA e produtos usa a proporção do relatório de serviços do mês.
const { db, tx, getSetting } = require('./db');
const { iso, round2, daysInMonth } = require('./metrics');
const { normalize } = require('./webhook');

function parseCSV(text) {
  const rows = [];
  let row = []; let field = ''; let quoted = false;
  const s = String(text).replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') { field += '"'; i++; } else if (c === '"') quoted = false; else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',' || c === ';') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((v) => v !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((v) => v !== '')) rows.push(row);
  const [header, ...data] = rows;
  const keys = header.map((h) => normalize(h));
  return data.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()])));
}

const money = (v) => {
  const s = String(v || '').replace(/[R$\s ]/g, '');
  if (!s) return 0;
  return Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s) || 0;
};
const brDate = (v) => { const m = String(v || '').match(/(\d{2})\/(\d{2})\/(\d{4})/); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };

function detect(rows) {
  const k = Object.keys(rows[0] || {});
  if (k.includes('ID DA COMANDA')) return 'comandas';
  if (k.includes('QUANTIDADE REALIZADO')) return 'servicos';
  if (k.includes('DATA DE CANCELAMENTO')) return 'cancelamentos';
  if (k.includes('DATA DE CRIACAO') && k.includes('PLANO')) return 'assinantes';
  return null;
}

// Serviços principais (corte/barba); os demais contam como SVA (serviço de valor agregado)
const CORE_SERVICES = ['CABELO', 'BARBA', 'CABELO E BARBA', 'PEZINHO', 'BIGODE', 'CORTE'];
const NOT_PROFESSIONAL = ['N/A', 'RECEPCAO', 'RECEPÇÃO', ''];
const NEW_CLIENT = /NOV[OA] CADASTRO|CADASTRO NOV[OA]|CLIENTE NOV[OA]/;

// Nomes do CashBarber x catálogo do painel (ex.: "Depilação de nariz" = "DEP. NARIZ")
const serviceKey = (n) => normalize(n).replace(/\bDEPILACAO( DE)?\b/g, 'DEP').replace(/\bHIDRATACAO( DE)?\b/g, 'HID')
  .replace(/\bPIGMENTACAO( DE)?\b/g, 'PIG').replace(/\s+/g, '');

// Liga o nome completo do CashBarber ao profissional já cadastrado (ex.: "Maurício Chagas da Silva" → "Mauricio")
function matchProfessional(fullName, pros) {
  const full = normalize(fullName);
  const first = full.split(' ')[0];
  return pros.find((p) => normalize(p.external_id) === full)
    || pros.find((p) => normalize(p.name) === full)
    || (pros.filter((p) => normalize(p.name).split(' ')[0] === first).length === 1
      ? pros.find((p) => normalize(p.name).split(' ')[0] === first) : null);
}

/** Analisa os arquivos e devolve o plano de importação (nada é gravado aqui). */
async function analyze(files) {
  const reports = {};
  const ignored = [];
  for (const f of files) {
    let rows;
    try { rows = parseCSV(f.text); } catch { ignored.push(f.name); continue; }
    const type = rows.length ? detect(rows) : null;
    if (!type) { ignored.push(f.name); continue; }
    reports[type] = rows;
  }
  if (!reports.comandas) throw new Error('Envie o relatório de comandas (colunas "ID da comanda", "Profissional", "Valor comanda fechada / assinatura", "Data e hora").');

  const comandas = reports.comandas.map((r) => ({
    pro: r.PROFISSIONAL, cliente: r.CLIENTE, tipo: normalize(r.TIPO), valor: money(r['VALOR COMANDA FECHADA / ASSINATURA']), date: brDate(r['DATA E HORA']),
  })).filter((c) => c.date);
  const months = [...new Set(comandas.map((c) => c.date.slice(0, 7)))].sort();
  if (months.length !== 1) throw new Error(`O relatório de comandas deve ser de um único mês (encontrados: ${months.join(', ')}).`);
  const [y, m] = months[0].split('-').map(Number);

  // Proporção de SVA e produtos dentro do valor das comandas (do relatório de serviços)
  const extrasCatalog = (await getSetting('extras_catalog')) || [];
  const comandaTotal = comandas.filter((c) => c.tipo !== 'ASSINATURA').reduce((s, c) => s + c.valor, 0);
  let svaShare = 0; let prodShare = 0; const servicos = []; let svaTotal = 0; let servTotal = 0;
  if (reports.servicos) {
    for (const r of reports.servicos) {
      const nome = r.SERVICO; if (!nome || normalize(nome) === 'TOTAL') continue;
      const item = { nome, quantidade: money(r['QUANTIDADE REALIZADO']), faturado: money(r.FATURADO), sva: !CORE_SERVICES.includes(normalize(nome)) };
      servicos.push(item);
      servTotal += item.faturado;
      if (item.sva) svaTotal += item.faturado;
    }
    if (comandaTotal > 0) {
      svaShare = Math.min(1, svaTotal / comandaTotal);
      prodShare = Math.max(0, Math.min(1 - svaShare, (comandaTotal - servTotal) / comandaTotal));
    }
  }

  // Assinaturas: nova quando a cobrança é no dia em que a assinatura foi criada; demais são recorrência
  const created = new Map();
  for (const r of reports.assinantes || []) {
    const d = brDate(r['DATA DE CRIACAO']);
    if (d && r.CLIENTE) created.set(normalize(r.CLIENTE), d);
  }
  for (const r of reports.cancelamentos || []) {
    const d = brDate(r['DATA ASSINATURA']);
    if (d && r.CLIENTE && !created.has(normalize(r.CLIENTE))) created.set(normalize(r.CLIENTE), d);
  }

  const days = {};
  for (let d = 1; d <= daysInMonth(y, m); d++) days[iso(y, m, d)] = { comandas: 0, novas_assinaturas: 0, recorrencia: 0 };
  let novas = 0; let recorrentes = 0;
  for (const c of comandas) {
    const day = days[c.date];
    if (c.tipo === 'ASSINATURA') {
      const isNew = reports.assinantes || reports.cancelamentos ? created.get(normalize(c.cliente)) === c.date : false;
      if (isNew) { day.novas_assinaturas += c.valor; novas++; } else { day.recorrencia += c.valor; recorrentes++; }
    } else day.comandas += c.valor;
  }
  const daily = Object.entries(days)
    .filter(([, v]) => v.comandas || v.novas_assinaturas || v.recorrencia)
    .map(([date, v]) => {
      const sva = round2(v.comandas * svaShare);
      const produtos = round2(v.comandas * prodShare);
      return { date, servicos: round2(v.comandas - sva - produtos), produtos, sva, novas_assinaturas: round2(v.novas_assinaturas), recorrencia: round2(v.recorrencia) };
    });

  // Profissionais (comandas; cobranças de assinatura não têm profissional no CashBarber)
  const existing = await db.all('SELECT * FROM professionals');
  const byPro = new Map();
  for (const c of comandas) {
    if (c.tipo === 'ASSINATURA' || NOT_PROFESSIONAL.includes(normalize(c.pro))) continue;
    const p = byPro.get(c.pro) || { nome_cashbarber: c.pro, faturamento_total: 0, atendimentos: 0, pagas: 0, clientes: new Set(), novos: new Set() };
    p.faturamento_total += c.valor; p.atendimentos++;
    if (c.valor > 0) p.pagas++;
    p.clientes.add(normalize(c.cliente));
    if (NEW_CLIENT.test(normalize(c.cliente))) p.novos.add(normalize(c.cliente));
    byPro.set(c.pro, p);
  }
  const profissionais = [...byPro.values()].map((p) => {
    const match = matchProfessional(p.nome_cashbarber, existing);
    return {
      nome_cashbarber: p.nome_cashbarber,
      nome: match ? match.name : p.nome_cashbarber.split(' ')[0],
      existente: !!match,
      id: match?.id ?? null,
      faturamento_total: round2(p.faturamento_total),
      clientes_atendidos: p.atendimentos,
      clientes_unicos: p.clientes.size,
      geracao_demanda: p.novos.size,
      ticket_medio: p.pagas ? round2(p.faturamento_total / p.pagas) : 0,
    };
  }).sort((a, b) => b.faturamento_total - a.faturamento_total);

  // Quantidades de SVA do mês (o relatório de serviços não separa por profissional)
  const extrasMes = {};
  for (const s of servicos.filter((x) => x.sva)) {
    const cat = extrasCatalog.find((n) => serviceKey(n) === serviceKey(s.nome));
    extrasMes[cat || s.nome.toUpperCase()] = s.quantidade;
  }

  const sum = (k) => round2(daily.reduce((s, d) => s + d[k], 0));
  return {
    ano: y, mes: m,
    relatorios: Object.keys(reports), ignorados: ignored,
    resumo: {
      dias_com_movimento: daily.length,
      comandas: comandas.filter((c) => c.tipo !== 'ASSINATURA').length,
      cobrancas_assinatura: novas + recorrentes,
      novas_assinaturas_qtd: novas,
      faturamento_total: round2(comandas.reduce((s, c) => s + c.valor, 0)),
      servicos: sum('servicos'), produtos: sum('produtos'), sva: sum('sva'),
      novas_assinaturas: sum('novas_assinaturas'), recorrencia: sum('recorrencia'),
      sva_proporcional: !!reports.servicos,
      assinantes_ativos: reports.assinantes ? reports.assinantes.filter((r) => normalize(r.STATUS) === 'EM DIA').length : null,
      assinantes_total: reports.assinantes ? reports.assinantes.filter((r) => r.CLIENTE).length : null,
      cancelamentos: reports.cancelamentos ? reports.cancelamentos.filter((r) => brDate(r['DATA DE CANCELAMENTO'])?.startsWith(months[0])).length : null,
      motivos_cancelamento: reports.cancelamentos
        ? Object.entries(reports.cancelamentos.reduce((a, r) => { const k = r.MOTIVO || 'Não informado'; a[k] = (a[k] || 0) + 1; return a; }, {})).sort((a, b) => b[1] - a[1])
        : null,
    },
    servicos_mes: servicos,
    extras_mes: extrasMes,
    diario: daily,
    profissionais,
  };
}

/** Grava o plano: substitui o faturamento diário do mês e atualiza os profissionais do relatório. */
async function apply(plan) {
  const { ano: y, mes: m } = plan;
  await tx(async (q) => {
    await q.run('DELETE FROM daily_revenue WHERE date >= ? AND date <= ?', iso(y, m, 1), iso(y, m, daysInMonth(y, m)));
    for (const d of plan.diario) {
      await q.run(`INSERT INTO daily_revenue(date, servicos, produtos, novas_assinaturas, sva, recorrencia, status, updated_at)
        VALUES(?, ?, ?, ?, ?, ?, 'REALIZADO', CURRENT_TIMESTAMP)`, d.date, d.servicos, d.produtos, d.novas_assinaturas, d.sva, d.recorrencia);
    }
    for (const p of plan.profissionais) {
      let id = p.id;
      if (!id) {
        await q.run('INSERT OR IGNORE INTO professionals(name, external_id) VALUES(?, ?)', p.nome, p.nome_cashbarber);
        id = (await q.get('SELECT id FROM professionals WHERE name = ?', p.nome)).id;
      } else {
        await q.run('UPDATE professionals SET external_id = ?, active = 1 WHERE id = ?', p.nome_cashbarber, id);
      }
      await q.run('INSERT OR IGNORE INTO professional_monthly(professional_id, year, month) VALUES(?, ?, ?)', id, y, m);
      await q.run(`UPDATE professional_monthly SET faturamento_total = ?, clientes_atendidos = ?, geracao_demanda = ?, ticket_medio = ?, updated_at = CURRENT_TIMESTAMP
        WHERE professional_id = ? AND year = ? AND month = ?`, p.faturamento_total, p.clientes_atendidos, p.geracao_demanda, p.ticket_medio, id, y, m);
    }
  });
  return { ok: true, ano: y, mes: m, dias: plan.diario.length, profissionais: plan.profissionais.length };
}

module.exports = { analyze, apply, parseCSV };
